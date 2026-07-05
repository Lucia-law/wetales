import { NextRequest } from "next/server";
import { streamChat } from "@/lib/llm";
import {
  buildBackgroundBlock,
  loadSkillMd,
  RUNTIME_INSTRUCTIONS,
} from "@/lib/skill-loader";
import { INTERVIEWERS, type ChatMessage, type ChatRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/interview/chat
 * 接收对话历史 + 用户新消息，流式返回主持人下一条回复。
 *
 * 请求体：ChatRequestBody
 * 响应：text/event-stream
 */
export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { interviewer, prepare, history } = body;
  if (!interviewer || !Array.isArray(history)) {
    return new Response(
      JSON.stringify({ error: "缺少 interviewer 或 history" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const skillMd = loadSkillMd(interviewer);
  const background = buildBackgroundBlock(prepare);
  const interviewerMeta = INTERVIEWERS[interviewer];

  const systemPrompt = `你现在就是「${interviewerMeta.name}」，一位真实存在过的深度采访主持人。下面这份文档描述了你的身份、语言习惯、人格和采访方式——这不是参考资料，而是你本人。请以第一人称代入这个角色，与受访者进行一对一对话。

---

${skillMd}

${background}

${RUNTIME_INSTRUCTIONS}

采访正在进行中。请根据下方对话历史，用你的角色口吻给出下一条回复（一个问题或一段极简回应）。一次只发一句。`;

  // 拼装最终消息：system + history
  // history 中 user=受访者、assistant=主持人
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamChat(
          { messages, temperature: 0.85 },
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
