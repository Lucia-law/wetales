import { NextRequest } from "next/server";
import { streamChat } from "@/lib/llm";
import {
  formatDialogueForLLM,
  buildExtractionPrompt,
  buildArticlePrompt,
  type ExtractedInfo,
} from "@/lib/interview-utils";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/interview/generate-article
 * 接收采访对话历史，先生成素材，再流式返回文章内容
 *
 * 请求体：{ nickname: string, interviewer: InterviewerId, history: ChatMessage[] }
 * 响应：
 *   - 素材不足：application/json，{ sufficient: false }
 *   - 素材足够：text/event-stream（流式返回文章内容）
 *
 * 内部流程：
 *   Step 1: 调用 LLM 提取结构化素材（同步，~3秒）
 *   Step 2: 检查素材是否足够（profile.summary 和 theme 有内容）
 *   Step 3: 用素材流式生成文章（SSE）
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

  // ========== Step 1: 提取素材 ==========
  const dialogueText = formatDialogueForLLM(history);
  const extractionPrompt = buildExtractionPrompt(dialogueText, nickname);

  let extractedInfo: ExtractedInfo;

  try {
    const extractionResponse = await new Promise<string>((resolve, reject) => {
      let result = "";
      streamChat(
        {
          messages: [
            {
              role: "system",
              content:
                "你是一个信息提取助手，只返回 JSON 格式的数据，不要加任何解释或 markdown 代码块标记。",
            },
            { role: "user", content: extractionPrompt },
          ],
          temperature: 0.3,
        },
        {
          onToken: (token) => {
            result += token;
          },
          onDone: () => resolve(result),
          onError: (err) => reject(err),
        }
      ).catch(reject);
    });

    // 解析 JSON（可能被 markdown 代码块包裹）
    const jsonMatch =
      extractionResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
      extractionResponse.match(/```\s*([\s\S]*?)\s*```/) ||
      [null, extractionResponse];
    extractedInfo = JSON.parse(jsonMatch[1] || extractionResponse);
  } catch (error) {
    console.error("[generate-article] 信息提取失败:", error);
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

  // ========== Step 2: 检查素材是否足够 ==========
  // 必须有主题，且 stories/scenes/quotes 至少有一个不为空（有写作素材）
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
    // 素材不足，返回 JSON
    return new Response(JSON.stringify({ sufficient: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ========== Step 3: 流式生成文章 ==========
  const articlePrompt = buildArticlePrompt(extractedInfo, nickname);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamChat(
          {
            messages: [
              {
                role: "system",
                content:
                  "你是一位资深杂志编辑，擅长撰写人物专访。你的文章风格：第三人称叙述、故事化、画面感、克制表达。",
              },
              { role: "user", content: articlePrompt },
            ],
            temperature: 0.7,
          },
          {
            onToken: (token) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(token)}\n\n`)
              );
            },
            onDone: () => {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
            onError: (err) => {
              const msg =
                err instanceof Error ? err.message : "Unknown stream error";
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify("[ERROR]" + msg)}\n\n`)
              );
              controller.close();
            },
          }
        );
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
