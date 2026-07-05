import { NextRequest } from "next/server";
import { streamChat, chatSync } from "@/lib/llm";
import {
  formatDialogueForLLM,
  buildExtractionPrompt,
  buildArticlePrompt,
  buildArticlePromptWithBrief,
  buildThemePlannerPrompt,
  buildReviewerPrompt,
  WRITER_SYSTEM_PROMPT,
  type ExtractedInfo,
  type EditorialBrief,
} from "@/lib/interview-utils";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 从可能被 markdown 代码块包裹的文本中解析 JSON */
function parseJsonResponse(text: string): unknown {
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)\s*```/) ||
    text.match(/```\s*([\s\S]*?)\s*```/) ||
    [null, text];
  return JSON.parse(jsonMatch[1] || text);
}

/**
 * POST /api/interview/generate-article
 * 接收采访对话历史，通过四步 Agent 流水线生成杂志文章。
 *
 * 请求体：{ nickname: string, interviewer: InterviewerId, history: ChatMessage[] }
 * 响应：
 *   - 素材不足：application/json，{ sufficient: false }
 *   - 素材足够：text/event-stream（流式返回最终文章内容）
 *
 * 内部流程（四步 Agent 流水线）：
 *   Step 1: Material Editor —— 提取结构化素材（同步）
 *   Step 2: Theme Planner —— 制定编辑简报（同步）
 *   Step 3: Writer —— 根据简报撰写文章（同步，收集完整文本）
 *   Step 4: Reviewer —— 终审校验并做最小修正（同步）
 *   Step 5: 将最终文章流式输出给前端
 */
export async function POST(req: NextRequest) {
  let body: {
    nickname: string;
    interviewer: string;
    history: ChatMessage[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { nickname, history } = body;

  if (!nickname || !Array.isArray(history) || history.length === 0) {
    return new Response(
      JSON.stringify({ error: "缺少 nickname 或 history" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // ========== Step 1: Material Editor —— 提取素材 ==========
  const dialogueText = formatDialogueForLLM(history);
  const extractionPrompt = buildExtractionPrompt(dialogueText, nickname);

  let extractedInfo: ExtractedInfo;

  try {
    const extractionResponse = await chatSync({
      messages: [
        {
          role: "system",
          content:
            "你是一个信息提取助手，只返回 JSON 格式的数据，不要加任何解释或 markdown 代码块标记。",
        },
        { role: "user", content: extractionPrompt },
      ],
      temperature: 0.3,
    });
    extractedInfo = parseJsonResponse(extractionResponse) as ExtractedInfo;
  } catch (error) {
    console.error("[generate-article] Step 1 素材提取失败:", error);
    // 降级处理：用最小素材包继续生成
    extractedInfo = {
      profile: {
        summary: nickname,
        occupation: "",
        keyExperiences: [],
        personality: "",
      },
      theme: "",
      stories: [],
      scenes: [],
      quotes: [],
    };
  }

  // ========== 素材充分性检查 ==========
  const hasTheme =
    extractedInfo.theme && extractedInfo.theme.trim().length > 0;
  const hasStories =
    Array.isArray(extractedInfo.stories) && extractedInfo.stories.length > 0;
  const hasScenes =
    Array.isArray(extractedInfo.scenes) && extractedInfo.scenes.length > 0;
  const hasQuotes =
    Array.isArray(extractedInfo.quotes) && extractedInfo.quotes.length > 0;
  const hasMaterial = hasStories || hasScenes || hasQuotes;

  if (!hasTheme || !hasMaterial) {
    return new Response(JSON.stringify({ sufficient: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ========== Step 2: Theme Planner —— 制定编辑简报 ==========
  let brief: EditorialBrief | null = null;
  try {
    const plannerResponse = await chatSync({
      messages: [
        {
          role: "system",
          content:
            "你是一位资深杂志的主题策划编辑，只返回 JSON 格式的数据，不要加任何解释或 markdown 代码块标记。",
        },
        {
          role: "user",
          content: buildThemePlannerPrompt(extractedInfo, nickname),
        },
      ],
      temperature: 0.4,
    });
    brief = parseJsonResponse(plannerResponse) as EditorialBrief;
    console.log("[generate-article] Step 2 策划完成，角度:", brief.angle);
  } catch (error) {
    console.warn("[generate-article] Step 2 策划失败，降级为无简报写作:", error);
    // 降级：brief 为 null，Writer 使用原始素材
  }

  // ========== Step 3: Writer —— 撰写文章（同步收集完整文本）==========
  const writerPrompt =
    brief !== null
      ? buildArticlePromptWithBrief(extractedInfo, brief, nickname)
      : buildArticlePrompt(extractedInfo, nickname);

  let articleText: string;
  try {
    articleText = await chatSync({
      messages: [
        {
          role: "system",
          content: WRITER_SYSTEM_PROMPT,
        },
        { role: "user", content: writerPrompt },
      ],
      temperature: 0.7,
    });
    console.log("[generate-article] Step 3 写作完成，字数:", articleText.length);
  } catch (error) {
    console.error("[generate-article] Step 3 写作失败:", error);
    const errMsg = error instanceof Error ? error.message : "写作失败";
    return new Response(
      JSON.stringify({ error: `文章生成失败: ${errMsg}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ========== Step 4: Reviewer —— 终审校验 ==========
  let finalArticle = articleText;
  try {
    const reviewResponse = await chatSync({
      messages: [
        {
          role: "system",
          content:
            "你是一位资深杂志的终审编辑，审稿标准对标 GQ 报道风格的中文人物特稿。你只输出审阅后的最终文章正文，不加任何审阅意见或解释。",
        },
        {
          role: "user",
          content: buildReviewerPrompt(articleText, extractedInfo, nickname, dialogueText),
        },
      ],
      temperature: 0.3,
    });
    // Reviewer 可能偶尔加 markdown 代码块，清理一下
    const cleaned = reviewResponse.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    if (cleaned.trim().length > 0) {
      finalArticle = cleaned;
      console.log("[generate-article] Step 4 审校完成");
    }
  } catch (error) {
    console.warn("[generate-article] Step 4 审校失败，使用原始文章:", error);
    // 降级：使用 Writer 的原始输出
  }

  // ========== Step 5: 流式输出最终文章 ==========
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        // 将最终文章按 token 粒度流式发送，保持前端打字机效果
        const chunks = finalArticle.match(/[\s\S]{1,3}/g) || [];
        for (const chunk of chunks) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify("[ERROR]" + msg)}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
