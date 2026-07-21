import { NextRequest } from "next/server";
import { streamChat } from "@/lib/llm";
import {
  buildBackgroundBlock,
  loadSkillMd,
  RUNTIME_INSTRUCTIONS,
} from "@/lib/skill-loader";
import { INTERVIEWERS, type ChatMessage, type ChatRequestBody } from "@/lib/types";
import {
  shouldRunDirector,
  runDirector,
  formatDirectorNote,
  detectSignal,
  extractMaterialNote,
  formatSignalHint,
  type MaterialNote,
} from "@/lib/director";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/interview/chat
 * 接收对话历史 + 用户新消息，流式返回主持人下一条回复。
 *
 * 请求体：ChatRequestBody（可附带可选的 materialNotes 字段累积素材笔记）
 * 响应：text/event-stream
 * 响应 header：X-Material-Notes（最新累积的素材笔记 JSON，由客户端持久化并回传）
 */
export async function POST(req: NextRequest) {
  let body: ChatRequestBody & { materialNotes?: MaterialNote[] };
  try {
    body = (await req.json()) as ChatRequestBody & { materialNotes?: MaterialNote[] };
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

  // ========== 累积素材笔记（从客户端回传，可选） ==========
  // 客户端若持久化了上一轮的 X-Material-Notes header，下次请求带回来即可累积。
  // 若客户端未实现，这里至少保留当前轮的素材笔记——runDirector 仍能基于单轮笔记工作。
  const incomingNotes: MaterialNote[] = Array.isArray(body.materialNotes)
    ? body.materialNotes.filter(
        (n) =>
          n &&
          typeof n.round === "number" &&
          Array.isArray(n.events) &&
          Array.isArray(n.quotes) &&
          Array.isArray(n.sensoryDetails) &&
          Array.isArray(n.conflicts) &&
          typeof n.emotionDepth === "string"
      )
    : [];

  // ========== 取最后一对消息（用于信号检测 + 素材笔记提取） ==========
  // history 最后一条 user 消息 = 这一轮受访者刚说的话
  // history 最后一条 assistant 消息 = 上一轮主持人的回复
  const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
  const lastAssistantMsg = [...history].reverse().find((m) => m.role === "assistant");

  // 当前轮次 = 已完成的 assistant 消息数 + 1（即将生成的这一轮）
  // 但素材笔记是关于"刚刚发生的一轮"——即上一轮已完成对话，用 lastRound 标记
  const completedRounds = history.filter((m) => m.role === "assistant").length;
  const lastRound = completedRounds; // 刚完成的最后一轮的轮次号

  // ========== 信号检测：每轮跑，失败时 null（不影响主流程） ==========
  let signalHint = "";
  if (lastUserMsg) {
    try {
      const signal = await detectSignal(lastUserMsg.content);
      if (signal) {
        signalHint = formatSignalHint(signal);
        console.log(`[chat] 检测到信号：${signal}（第 ${lastRound} 轮）`);
      }
    } catch (err) {
      console.warn("[chat] detectSignal 异常，跳过信号提示:", err);
    }
  }

  // ========== 素材笔记累积：每轮跑，失败时 null（不影响主流程） ==========
  let updatedNotes = [...incomingNotes];
  if (lastUserMsg && lastAssistantMsg && lastRound > 0) {
    try {
      const newNote = await extractMaterialNote(
        lastUserMsg.content,
        lastAssistantMsg.content,
        lastRound
      );
      if (newNote) {
        // 替换同轮的旧笔记（若客户端重复发了同 round 的笔记）
        updatedNotes = [
          ...updatedNotes.filter((n) => n.round !== lastRound),
          newNote,
        ];
        console.log(
          `[chat] 素材笔记已累积（第 ${lastRound} 轮，events: ${newNote.events.length}, quotes: ${newNote.quotes.length}）`
        );
      }
    } catch (err) {
      console.warn("[chat] extractMaterialNote 异常，跳过素材笔记累积:", err);
    }
  }

  // ========== Director Agent：每 3 轮运行一次，基于累积的 MaterialNote 列表 ==========
  let directorNoteSection = "";
  if (shouldRunDirector(history)) {
    try {
      const note = await runDirector(updatedNotes, prepare, interviewer);
      if (note) {
        directorNoteSection = formatDirectorNote(note);
        console.log(
          `[chat] Director 笔记已注入（阶段: ${note.phase}, 素材: ${note.materialSufficiency}）`
        );
      }
    } catch (err) {
      console.warn("[chat] runDirector 异常，跳过导演笔记:", err);
    }
  }

  const systemPrompt = `你现在就是「${interviewerMeta.name}」，一位真实存在过的深度采访主持人。下面这份文档描述了你的身份、语言习惯、人格和采访方式——这不是参考资料，而是你本人。请以第一人称代入这个角色，与受访者进行一对一对话。

---

${skillMd}

${background}

${RUNTIME_INSTRUCTIONS}
${directorNoteSection}
${signalHint}

采访正在进行中。请根据下方对话历史，用你的角色口吻给出下一条回复。你的回复可以是一个问题、或者你对这件事的判断和看法——不要每轮都在问。如果你已经连续几轮都在提问，这一轮试着说出你对对方说的话的看法，像一个有思想的人在对话，而不是一个提问机器。一次只发一段。`;

  // 拼装最终消息：system + history
  // history 中 user=受访者、assistant=主持人
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const encoder = new TextEncoder();
  // 把累积的 materialNotes 通过响应 header 返回，客户端可持久化并回传
  const materialNotesHeader = encodeURIComponent(JSON.stringify(updatedNotes));

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
      // 累积的素材笔记——客户端持久化后下次请求带回，实现"每轮素材笔记累积"机制
      "X-Material-Notes": materialNotesHeader,
    },
  });
}
