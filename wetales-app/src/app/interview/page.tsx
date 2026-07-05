"use client";

import { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  INTERVIEWERS,
  type InterviewerId,
  type PrepareForm,
  type ChatMessage,
} from "@/lib/types";

// ---------- UI 消息模型 ----------
interface UiMessage {
  id: string;
  role: "interviewer" | "subject";
  content: string;
  tag?: string;
  isEnd?: boolean;
  streaming?: boolean;
  error?: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  开场: "Opening",
  追问: "Probing",
  敏感: "Sensitive",
  冲突: "Conflict",
  收尾: "Closing",
};

// Composing 旋转词：贴合采访/演播厅场景
const COMPOSING_WORDS = [
  "Composing",
  "Listening",
  "Reflecting",
  "Gathering",
  "Considering",
  "Pausing",
  "Holding space",
  "Breathing",
  "Thinking",
  "Feeling",
  "Waiting",
  "Tuning in",
];

let idCounter = 0;
const nextId = () => `m${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function parseRaw(raw: string): {
  content: string;
  tag?: string;
  isEnd?: boolean;
} {
  let content = raw;
  let tag: string | undefined;
  let isEnd: boolean | undefined;

  const tagMatch = content.match(/^\s*\[(开场|追问|敏感|冲突|收尾)\]\s*/);
  if (tagMatch) {
    tag = tagMatch[1];
    content = content.slice(tagMatch[0].length);
  }

  if (/\[END\]\s*$/.test(content)) {
    isEnd = true;
    content = content.replace(/\[END\]\s*$/, "");
  }

  return { content, tag, isEnd };
}

async function readSSE(
  response: Response,
  onToken: (t: string) => void
): Promise<void> {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") return;
      try {
        const token = JSON.parse(raw) as string;
        if (token.startsWith("[ERROR]")) {
          throw new Error(token.slice(7));
        }
        onToken(token);
      } catch (err) {
        if (err instanceof SyntaxError) {
          onToken(raw);
        } else {
          throw err;
        }
      }
    }
  }
}

function ComposingWords() {
  const [idx, setIdx] = useState(() =>
    Math.floor(Math.random() * COMPOSING_WORDS.length)
  );
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const wordTimer = setInterval(() => {
      setIdx((prev) => {
        let next = prev;
        while (next === prev) {
          next = Math.floor(Math.random() * COMPOSING_WORDS.length);
        }
        return next;
      });
    }, 1800);

    const dotsTimer = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 400);

    return () => {
      clearInterval(wordTimer);
      clearInterval(dotsTimer);
    };
  }, []);

  return (
    <span className="text-secondary/60 italic text-base font-display inline-flex items-center gap-2">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-secondary/40 animate-pulse flex-shrink-0" />
      <span>{COMPOSING_WORDS[idx]}</span>
      <span className="tracking-wider">{".".repeat(dots)}</span>
    </span>
  );
}

// ---------- 主组件 ----------
function InterviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const interviewerParam = (searchParams.get("interviewer") ||
    "resonator") as InterviewerId;
  const interviewer =
    INTERVIEWERS[interviewerParam] || INTERVIEWERS.resonator;

  // 全部在 useEffect 中初始化，避免 SSR/客户端 hydration 不匹配
  const [prepare, setPrepare] = useState<PrepareForm | null>(null);
  const [sessionNum, setSessionNum] = useState("");
  const [mounted, setMounted] = useState(false);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ASR 录音
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 输入框（一直存在）
  const [textInput, setTextInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  // 客户端挂载后读取 sessionStorage 和日期（避免 hydration 不匹配）
  useEffect(() => {
    setMounted(true);
    const t = new Date();
    setSessionNum(
      `${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`
    );
    try {
      const raw = sessionStorage.getItem("wetales:prepare");
      if (!raw) return;
      const parsed = JSON.parse(raw) as PrepareForm;
      if (!parsed?.nickname || !parsed.topicCategory) return;
      setPrepare(parsed);

      // 检查是否需要恢复聊天记录
      const shouldResume = sessionStorage.getItem("wetales:resume-interview");
      if (shouldResume === "true") {
        // 清除恢复标记
        sessionStorage.removeItem("wetales:resume-interview");

        // 读取之前的聊天记录
        const historyRaw = sessionStorage.getItem("wetales:interview-history");
        if (historyRaw) {
          const historyData = JSON.parse(historyRaw) as ChatMessage[];
          // 转换为 UiMessage 格式
          const restoredMessages: UiMessage[] = historyData.map((msg, idx) => ({
            id: `restored-${idx}`,
            role: msg.role === "assistant" ? "interviewer" : "subject",
            content: msg.content,
            streaming: false,
          }));
          setMessages(restoredMessages);
          // 标记已启动，跳过开场白请求
          startedRef.current = true;
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (mounted && !prepare) {
      router.replace("/");
    }
  }, [mounted, prepare, router]);

  // 请求开场白
  useEffect(() => {
    if (!prepare || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const placeholderId = nextId();

    (async () => {
      setMessages([
        {
          id: placeholderId,
          role: "interviewer",
          content: "",
          streaming: true,
        },
      ]);
      setIsResponding(true);

      try {
        const resp = await fetch("/api/interview/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prepare }),
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`开场白请求失败 ${resp.status}: ${txt.slice(0, 200)}`);
        }
        let raw = "";
        await readSSE(resp, (token) => {
          if (cancelled) return;
          raw += token;
          const parsed = parseRaw(raw);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === placeholderId
                ? {
                    ...m,
                    content: parsed.content,
                    tag: parsed.tag,
                    isEnd: parsed.isEnd,
                    streaming: true,
                  }
                : m
            )
          );
        });
        if (cancelled) return;
        const parsed = parseRaw(raw);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? {
                  ...m,
                  content: parsed.content,
                  tag: parsed.tag,
                  isEnd: parsed.isEnd,
                  streaming: false,
                }
              : m
          )
        );
        // AI 结束标记已移除，现在通过结束按钮直接跳转
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setErrorMsg(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? {
                  ...m,
                  content: `（开场白生成失败：${msg}）`,
                  streaming: false,
                  error: true,
                }
              : m
          )
        );
      } finally {
        if (!cancelled) setIsResponding(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [prepare]);

  // 自动滚动到底部（当消息数量变化时）
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length]);

  // 发送消息
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isResponding || !prepare) return;

      const userMsg: UiMessage = {
        id: nextId(),
        role: "subject",
        content: trimmed,
      };
      const aiId = nextId();
      const aiPlaceholder: UiMessage = {
        id: aiId,
        role: "interviewer",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsResponding(true);
      setErrorMsg(null);

      const history: ChatMessage[] = [
        ...messages
          .filter((m) => !m.streaming && !m.error)
          .map((m) => ({
            role: (m.role === "interviewer" ? "assistant" : "user") as
              | "user"
              | "assistant",
            content: m.tag
              ? `[${m.tag}]${m.content}${m.isEnd ? "[END]" : ""}`
              : `${m.content}${m.isEnd ? "[END]" : ""}`,
          })),
        { role: "user", content: trimmed },
      ];

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // 延迟添加主持人 placeholder，让用户消息在底部短暂停留后再飘上去
      await new Promise((r) => setTimeout(r, 600));
      setMessages((prev) => [...prev, aiPlaceholder]);

      try {
        const resp = await fetch("/api/interview/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interviewer: prepare.interviewer,
            prepare,
            history,
          }),
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`回复请求失败 ${resp.status}: ${txt.slice(0, 200)}`);
        }
        let raw = "";
        await readSSE(resp, (token) => {
          raw += token;
          const parsed = parseRaw(raw);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId
                ? {
                    ...m,
                    content: parsed.content,
                    tag: parsed.tag,
                    isEnd: parsed.isEnd,
                    streaming: true,
                  }
                : m
            )
          );
        });
        const parsed = parseRaw(raw);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? {
                  ...m,
                  content: parsed.content,
                  tag: parsed.tag,
                  isEnd: parsed.isEnd,
                  streaming: false,
                }
              : m
          )
        );

      } catch (err) {
        if (ctrl.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setErrorMsg(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? {
                  ...m,
                  content: `（回复失败：${msg}）`,
                  streaming: false,
                  error: true,
                }
              : m
          )
        );
      } finally {
        setIsResponding(false);
      }
    },
    [isResponding, messages, prepare]
  );

  // ASR 录音：点击话筒开始/停止，停止后文字落入输入框
  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      recorderRef.current?.stop();
    } else if (!isTranscribing && !isResponding) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          setIsRecording(false);
          setIsTranscribing(true);
          streamRef.current?.getTracks().forEach((t) => t.stop());

          try {
            const blob = new Blob(chunksRef.current, {
              type: "audio/webm",
            });
            const formData = new FormData();
            formData.append("file", blob, "audio.webm");

            const resp = await fetch("/api/asr", {
              method: "POST",
              body: formData,
            });

            if (!resp.ok) {
              const err = await resp.json().catch(() => ({}));
              throw new Error(
                err.error || `ASR 请求失败 ${resp.status}`
              );
            }

            const data = await resp.json();
            const text = (data.text || "").trim();
            if (text) {
              // 文字落入输入框，不自动发送
              setTextInput((prev) => (prev ? prev + " " + text : text));
            }
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "ASR 异常";
            setErrorMsg(msg);
          } finally {
            setIsTranscribing(false);
          }
        };

        recorder.start();
        recorderRef.current = recorder;
        setIsRecording(true);
        setErrorMsg(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "麦克风访问失败";
        setErrorMsg(msg);
      }
    }
  }, [isRecording, isTranscribing, isResponding]);

  // 结束会话
  const handleHangup = useCallback(() => {
    // 停止录音
    if (isRecording) {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    }

    // 保存对话历史到 sessionStorage
    const history: ChatMessage[] = messages
      .filter((m) => !m.streaming && !m.error)
      .map((m) => ({
        role: (m.role === "interviewer" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      }));
    sessionStorage.setItem("wetales:interview-history", JSON.stringify(history));

    // 保存昵称
    if (prepare?.nickname) {
      sessionStorage.setItem("wetales:nickname", prepare.nickname);
    }

    // 跳转到杂志页面
    router.push("/magazine/generate");
  }, [isRecording, messages, prepare, router]);

  // 发送输入框内容
  const handleSend = useCallback(() => {
    const text = textInput.trim();
    if (!text || isResponding) return;
    setTextInput("");
    sendMessage(text);
  }, [textInput, isResponding, sendMessage]);

  if (!mounted || !prepare) {
    return (
      <div className="min-h-screen flex items-center justify-center text-secondary font-display text-xl">
        Loading...
      </div>
    );
  }

  // 计算每条历史消息的透明度（越旧越淡）
  const getHistoryOpacity = (distanceFromLatest: number) => {
    if (distanceFromLatest <= 0) return 1;
    return Math.max(0.15, 0.55 - (distanceFromLatest - 1) * 0.12);
  };

  return (
    <div className="h-screen w-screen overflow-hidden relative studio-gradient">
      {/* 背景层 */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,_#ffffff_0%,_#f3f3f3_35%,_#dadada_100%)]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_50%_0%,_rgba(255,255,255,0.8)_0%,_transparent_60%)] opacity-60" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[60%] h-[60%] rounded-full bg-white/40 blur-[120px]" />
        <div className="absolute top-[10%] left-[-5%] w-[40%] h-[40%] rounded-full bg-surface-variant/20 blur-[150px]" />
      </div>

      {/* Header */}
      <header className="absolute top-8 left-0 right-0 z-20 flex justify-between items-center px-6 md:px-16">
        <div className="flex items-center gap-3 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/50 shadow-sm">
          <div className="w-2 h-2 bg-coral rounded-full animate-pulse" />
          <span className="text-xs font-semibold text-coral tracking-widest">
            {isRecording
              ? "RECORDING"
              : isTranscribing
              ? "TRANSCRIBING"
              : "LIVE RECORDING"}
          </span>
        </div>
        <div className="text-xs text-secondary tracking-[0.2em] opacity-60 font-semibold">
          SESSION #{sessionNum}
        </div>
      </header>

      {/* Main 消息区：垂直堆叠，最新消息在底部，可自然滑动查看历史 */}
      <main
        ref={scrollRef}
        className="relative z-10 h-screen overflow-y-auto px-6 md:px-16 pt-24 pb-44 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative w-full max-w-4xl mx-auto flex flex-col items-center gap-6 md:gap-8 min-h-[calc(100vh-272px)] justify-end">
          {messages.map((msg, idx) => {
            const isLatest = idx === messages.length - 1;
            const distance = messages.length - 1 - idx;

            if (isLatest) {
              // 最新消息：大白色玻璃框 + 左上角大引号（出框）
              return (
                <div
                  key={msg.id}
                  className="w-full bg-white/60 backdrop-blur-3xl rounded-xl p-8 md:p-14 border border-white/80 shadow-xl relative transition-all duration-700 ease-out"
                >
                  <span className="absolute -top-12 -left-4 md:-left-8 text-[140px] md:text-[180px] font-serif text-primary/15 select-none pointer-events-none z-0 leading-none">
                    &ldquo;
                  </span>
                  <MessageBody
                    msg={msg}
                    interviewer={interviewer}
                    isInterviewer={msg.role === "interviewer"}
                    nickname={prepare.nickname}
                  />
                </div>
              );
            }

            // 历史消息：统一宽度，淡淡背景（避免框闪），渐进透明度
            const opacity = getHistoryOpacity(distance);

            return (
              <div
                key={msg.id}
                style={{ opacity }}
                className="w-[92%] bg-white/20 backdrop-blur-sm rounded-xl px-6 py-4 border border-white/30 transition-all duration-700 ease-out"
              >
                <MessageBody
                  msg={msg}
                  interviewer={interviewer}
                  isInterviewer={msg.role === "interviewer"}
                  nickname={prepare.nickname}
                  compact
                />
              </div>
            );
          })}

          {messages.length === 0 && (
            <div className="text-center text-secondary italic font-display text-2xl mt-32">
              Ready to begin...
            </div>
          )}
        </div>
      </main>

      {/* 底部胶囊：话筒 + 输入框 + 发送 + 红色结束按钮 */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-6">
        {errorMsg && (
          <div className="mb-3 px-4 py-2 bg-coral/10 border border-coral/30 rounded-lg text-coral text-xs text-center">
            {errorMsg}
          </div>
        )}

        <div className="bg-white/40 backdrop-blur-xl rounded-full px-4 py-3 flex items-center gap-3 shadow-xl border border-white/40">
            {/* 话筒按钮 */}
            <button
              onClick={handleMicClick}
              disabled={isResponding || isTranscribing}
              title={isRecording ? "Stop recording" : "Start recording"}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 ${
                isRecording
                  ? "bg-coral text-white animate-pulse scale-110"
                  : isTranscribing
                  ? "bg-primary/60 text-white"
                  : "bg-white/80 backdrop-blur-md text-secondary border border-white/80 hover:bg-white hover:text-primary hover:shadow-lg"
              }`}
            >
              {isTranscribing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="6" cy="12" r="2" className="animate-bounce" style={{ animationDelay: "0ms" }} />
                  <circle cx="12" cy="12" r="2" className="animate-bounce" style={{ animationDelay: "150ms" }} />
                  <circle cx="18" cy="12" r="2" className="animate-bounce" style={{ animationDelay: "300ms" }} />
                </svg>
              ) : isRecording ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>

            {/* 输入框 */}
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isRecording
                  ? "Recording..."
                  : isTranscribing
                  ? "Transcribing..."
                  : isResponding
                  ? "Composing..."
                  : "Type or speak..."
              }
              disabled={isResponding || isRecording || isTranscribing}
              className="flex-1 bg-transparent border-none outline-none text-primary placeholder:text-secondary/50 font-body text-base disabled:opacity-60 min-w-0"
            />

            {/* 发送键 */}
            <button
              onClick={handleSend}
              disabled={!textInput.trim() || isResponding}
              title="Send"
              aria-label="Send"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                textInput.trim() && !isResponding
                  ? "bg-primary text-white hover:bg-primary/85 hover:shadow-lg"
                  : "bg-white/60 text-secondary cursor-not-allowed"
              }`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>

            {/* 分隔线 */}
            <div className="w-px h-8 bg-outline-variant/30 mx-1 flex-shrink-0" />

            {/* 红色结束按钮 */}
            <button
              onClick={handleHangup}
              disabled={isResponding}
              title="End Session"
              aria-label="End Session"
              className="w-12 h-12 rounded-full bg-coral hover:bg-coral/90 text-white transition-all duration-300 flex items-center justify-center shadow-md hover:shadow-xl hover:-translate-y-0.5 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          </div>
      </div>
    </div>
  );
}

// ---------- 消息体子组件 ----------
function MessageBody({
  msg,
  interviewer,
  isInterviewer,
  nickname,
  compact,
}: {
  msg: UiMessage;
  interviewer: (typeof INTERVIEWERS)[InterviewerId];
  isInterviewer: boolean;
  nickname: string;
  compact?: boolean;
}) {
  const name = isInterviewer ? interviewer.englishName : nickname;
  const roleLabel = isInterviewer ? "Interviewer" : "Subject";

  return (
    <div
      className={`flex flex-col items-start ${
        compact ? "gap-3" : "gap-5"
      } relative z-10`}
    >
      {/* 头像 + 角色 + 名字 */}
      <div className="flex items-center gap-3">
        {isInterviewer ? (
          <div
            className={`${
              compact ? "w-8 h-8" : "w-12 h-12"
            } rounded-full overflow-hidden border border-outline-variant/30 shadow-sm flex-shrink-0 relative`}
          >
            <Image
              src={interviewer.avatar}
              alt={interviewer.name}
              fill
              className="object-cover"
              sizes={compact ? "32px" : "48px"}
            />
          </div>
        ) : (
          <div
            className={`${
              compact ? "w-8 h-8" : "w-12 h-12"
            } rounded-full border border-outline-variant/30 flex items-center justify-center bg-surface-bright shadow-sm flex-shrink-0`}
          >
            <span
              className={`${
                compact ? "text-xs" : "text-sm"
              } font-semibold text-primary`}
            >
              {nickname.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex flex-col">
          <span
            className={`${
              compact ? "text-[9px]" : "text-[10px]"
            } uppercase tracking-[0.3em] text-secondary font-semibold`}
          >
            {roleLabel}
          </span>
          <h3
            className={`text-sm text-primary tracking-wide font-semibold ${
              compact ? "" : "font-display text-base"
            }`}
          >
            {name}
          </h3>
        </div>
      </div>

      {/* 消息正文 */}
      <div
        className={
          compact
            ? "font-display text-base md:text-lg text-primary/80 leading-relaxed tracking-wide"
            : "font-display text-lg md:text-xl text-primary leading-relaxed tracking-[0.02em] text-primary/90 pt-1 pb-1"
        }
      >
        {msg.content ? (
          <>
            &ldquo;{msg.content}&rdquo;
            {msg.streaming && <span className="typewriter-cursor" />}
          </>
        ) : msg.streaming ? (
          <ComposingWords />
        ) : null}
      </div>
    </div>
  );
}

export default function InterviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-secondary font-display text-xl">
          Loading...
        </div>
      }
    >
      <InterviewContent />
    </Suspense>
  );
}
