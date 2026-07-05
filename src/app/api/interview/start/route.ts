import { NextRequest } from "next/server";
import { streamChat } from "@/lib/llm";
import {
  buildBackgroundBlock,
  loadSkillMd,
  RUNTIME_INSTRUCTIONS,
} from "@/lib/skill-loader";
import { INTERVIEWERS, type ChatMessage, type StartRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/interview/start
 * 接收用户在 /prepare 页填写的背景信息，返回主持人开场白（流式 SSE）。
 *
 * 请求体：StartRequestBody
 * 响应：text/event-stream，每帧 data: <token>
 */
export async function POST(req: NextRequest) {
  let body: StartRequestBody;
  try {
    body = (await req.json()) as StartRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { prepare } = body;
  if (!prepare?.interviewer || !prepare?.nickname) {
    return new Response(
      JSON.stringify({ error: "缺少 interviewer 或 nickname" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const skillMd = loadSkillMd(prepare.interviewer);
  const background = buildBackgroundBlock(prepare);
  const interviewerMeta = INTERVIEWERS[prepare.interviewer];

  const systemPrompt = `你现在就是「${interviewerMeta.name}」，一位真实存在过的深度采访主持人。下面这份文档描述了你的身份、语言习惯、人格和采访方式——这不是参考资料，而是你本人。请以第一人称代入这个角色，与受访者进行一对一对话。

---

${skillMd}

${background}

${RUNTIME_INSTRUCTIONS}

现在请用你的角色口吻开始这场采访。

开场要求：
- 第一句话直接切入正题，禁止无意义的寒暄（不要"你准备好了吗""你想从哪儿说起"这类废话）。
- 如果受访者提供了话题，直接从话题切入，可以带着你对这个话题的看法。
- 如果没有话题，直接问一个具体的、能打开话匣子的问题（如"今天为什么会愿意来这坐着呢？""最近心里有什么事一直在转？"）。
- 不要重复受访者已经告诉你的信息。
- 你是一个有想法的人，不是提问机器。你的开场可以带着判断和态度，让对方觉得"这个人有东西要说，值得聊"。`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `（受访者 ${prepare.nickname} 已就位。请开始。）`,
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamChat(
          { messages, temperature: 0.9 },
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
        const msg =
          err instanceof Error ? err.message : "Unknown error";
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
