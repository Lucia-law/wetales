import type { ChatMessage } from "./types";

/**
 * 调用 OpenAI 兼容接口的 LLM，流式返回。
 * 走 fetch + ReadableStream，避免引入额外 SDK 依赖。
 */
export interface StreamChatParams {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (err: unknown) => void;
}

export function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.MODEL_NAME || "gpt-4o";
  return { apiKey, baseUrl, model };
}

/**
 * 流式调用 LLM，把 token 透传给 onToken 回调。
 * 返回完整文本（用于服务端日志/调试）。
 */
export async function streamChat(
  params: StreamChatParams,
  cb: StreamCallbacks
): Promise<string> {
  const { messages, model, temperature = 0.85, signal } = params;
  const { apiKey, baseUrl, model: defaultModel } = getLlmConfig();

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY 未配置。请在 wetales-app/.env.local 中设置。"
    );
  }

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || defaultModel,
      messages,
      temperature,
      stream: true,
    }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLM 请求失败 ${resp.status}: ${text.slice(0, 500)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以 \n\n 分隔
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        const lines = frame.split("\n").filter((l) => l.startsWith("data:"));
        for (const line of lines) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            cb.onDone();
            return full;
          }
          try {
            const json = JSON.parse(data);
            const token = json?.choices?.[0]?.delta?.content;
            if (typeof token === "string" && token) {
              full += token;
              cb.onToken(token);
            }
          } catch {
            // 跳过非 JSON 帧（如 keepalive 注释）
          }
        }
      }
    }
    cb.onDone();
  } catch (err) {
    cb.onError(err);
    throw err;
  }

  return full;
}
