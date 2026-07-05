"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ChatMessage } from "@/lib/types";

// 页面状态
type PageStatus = "preparing" | "insufficient" | "streaming" | "done" | "error";

function GenerateArticleContent() {
  const router = useRouter();
  const [status, setStatus] = useState<PageStatus>("preparing");
  const [article, setArticle] = useState("");
  const [sessionDate, setSessionDate] = useState("");

  // 从 sessionStorage 读取对话历史并生成文章
  useEffect(() => {
    const loadData = async () => {
      const t = new Date();
      setSessionDate(
        `${String(t.getFullYear()).slice(2)}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`
      );

      try {
        const raw = sessionStorage.getItem("wetales:interview-history");
        if (!raw) {
          setStatus("error");
          return;
        }

        const historyData = JSON.parse(raw) as ChatMessage[];
        const nicknameData =
          sessionStorage.getItem("wetales:nickname") || "Subject";

        // 读取采访者（magazine 生成需要）
        const prepareRaw = sessionStorage.getItem("wetales:prepare");
        const interviewer = prepareRaw
          ? (JSON.parse(prepareRaw) as { interviewer?: string }).interviewer ||
            "resonator"
          : "resonator";

        await generateArticle(nicknameData, interviewer, historyData);
      } catch (err) {
        setStatus("error");
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 生成文章（流式）
  const generateArticle = async (
    nickname: string,
    interviewer: string,
    history: ChatMessage[]
  ) => {
    setStatus("streaming");

    try {
      const resp = await fetch("/api/interview/generate-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, interviewer, history }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      // 检查返回类型：JSON 表示素材不足，SSE 表示文章流
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const result = await resp.json();
        if (result.sufficient === false) {
          setStatus("insufficient");
          return;
        }
        throw new Error("Unexpected JSON response");
      }

      // 流式读取
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) throw new Error("No response body");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;

          const raw = line.slice(5).trim();
          if (raw === "[DONE]") {
            setStatus("done");
            return;
          }

          try {
            const token = JSON.parse(raw) as string;
            if (token.startsWith("[ERROR]")) {
              throw new Error(token.slice(7));
            }
            setArticle((prev) => prev + token);
          } catch (e) {
            if (e instanceof SyntaxError) {
              setArticle((prev) => prev + raw);
            } else {
              throw e;
            }
          }
        }
      }

      setStatus("done");
    } catch (err) {
      setStatus("error");
    }
  };

  // 解析文章结构：标题 + 正文上半 + 金句 + 正文下半
  // 金句（> 开头）将正文分成上下两半，各放入一个 column-text 容器实现双列排版
  const parseArticle = (text: string) => {
    const lines = text.split("\n");
    let title = "";
    let body = text;

    // 提取标题（第一行 # 开头）
    if (lines[0]?.startsWith("# ")) {
      title = lines[0].slice(2).trim();
      body = lines.slice(1).join("\n").trim();
    }

    // 按空行分割段落
    const allParagraphs = body
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // 找到金句段落的位置（只取第一个 > 开头的，忽略后续重复的）
    const quoteIdx = allParagraphs.findIndex((p) => p.startsWith("> "));
    const quote =
      quoteIdx >= 0 ? allParagraphs[quoteIdx].slice(2).trim() : "";

    // 正文上半：金句之前的段落
    // 正文下半：金句之后的段落（过滤掉额外的 > 段落，防止重复）
    const beforeQuote =
      quoteIdx >= 0 ? allParagraphs.slice(0, quoteIdx) : allParagraphs;
    const afterQuote =
      quoteIdx >= 0
        ? allParagraphs
            .slice(quoteIdx + 1)
            .filter((p) => !p.startsWith("> "))
        : [];

    return { title, quote, beforeQuote, afterQuote };
  };

  const { title, quote, beforeQuote, afterQuote } = parseArticle(article);

  // 是否显示 loading（preparing 状态，或 streaming 但还没有内容）
  const isLoading = status === "preparing" || (status === "streaming" && !article);

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Main Content */}
      <main className="flex-grow pt-4 pb-32 px-6 md:px-16 max-w-[1600px] mx-auto w-full relative">
        {/* Brand Masthead */}
        <div className="w-full flex flex-col items-center justify-center mb-12 md:mb-16 border-b border-outline-variant/30 py-8">
          <span className="font-display text-2xl md:text-3xl text-primary tracking-wider">
            <span className="not-italic">We Tales</span>
            <span className="mx-2 text-outline-variant">·</span>
            <span className="italic text-secondary">Portrait</span>
          </span>
        </div>

        {/* Article Content */}
        <div className="max-w-5xl mx-auto">
          {isLoading ? (
            // 准备中 / 提取素材阶段（还没有文章内容）
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
              <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-secondary font-display">
                Preparing your portrait...
              </p>
            </div>
          ) : status === "insufficient" ? (
            // 信息量不够
            <>
              <header className="mb-20 md:mb-32 relative z-10 max-w-5xl mx-auto text-center px-4">
                <div className="mb-8 inline-block px-5 py-1.5 rounded-full bg-surface-bright text-secondary border border-outline-variant/40 text-xs tracking-widest uppercase font-medium">
                  Portrait / Vol. {sessionDate}
                </div>
                <h1 className="font-display text-4xl md:text-6xl lg:text-7xl text-primary mb-8 tracking-tight leading-tight">
                  Your Story Is Still Unfolding
                </h1>
              </header>

              <div className="text-center">
                <p className="font-display text-base text-on-surface-variant leading-[1.8]">
                  This portrait is missing a few defining strokes.
                </p>
              </div>

              <div className="max-w-5xl mx-auto mt-24 flex justify-between">
                <button
                  onClick={() => {
                    sessionStorage.setItem("wetales:resume-interview", "true");
                    router.push("/interview");
                  }}
                  className="text-sm text-secondary hover:text-primary transition-colors font-semibold"
                >
                  Resume Interview
                </button>
                <Link
                  href="/"
                  className="text-sm text-secondary hover:text-primary transition-colors font-semibold"
                >
                  Back to Home
                </Link>
              </div>
            </>
          ) : status === "error" ? (
            // 错误状态
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
              <div className="text-center">
                <p className="text-primary font-display text-lg mb-2">
                  Something went wrong
                </p>
                <p className="text-sm text-secondary">Please try again</p>
              </div>
              <Link
                href="/"
                className="text-sm text-secondary hover:text-primary transition-colors font-semibold"
              >
                Back to Home
              </Link>
            </div>
          ) : (
            // 文章内容
            <>
              {/* Article Header */}
              {title && (
                <header className="mb-20 md:mb-32 relative z-10 max-w-5xl mx-auto text-center px-4">
                  <div className="mb-8 inline-block px-5 py-1.5 rounded-full bg-surface-bright text-secondary border border-outline-variant/40 text-xs tracking-widest uppercase font-medium">
                    Portrait / Vol. {sessionDate}
                  </div>
                  <h1 className="font-display text-4xl md:text-6xl lg:text-7xl text-primary mb-8 tracking-tight leading-tight">
                    {title}
                  </h1>
                </header>
              )}

              {/* Article Content */}
              <div className="max-w-5xl mx-auto">
                {/* 正文上半 - 双列排版 */}
                {beforeQuote.length > 0 && (
                  <div className="column-text">
                    {beforeQuote.map((paragraph, idx) => (
                      <p
                        key={idx}
                        className={`font-serif-sc text-base text-on-surface-variant leading-[1.8] mb-8 text-justify ${
                          idx === 0 ? "drop-cap" : ""
                        }`}
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                )}

                {/* 大字金句 - 单独全宽展示，打断双列 */}
                {quote && (
                  <div className="my-24 md:my-32 pl-8 md:pl-16 relative">
                    <div className="pull-quote-mark relative z-10">
                      <p className="font-serif-sc text-3xl md:text-5xl text-primary font-bold leading-tight tracking-tight max-w-4xl">
                        {quote}
                      </p>
                    </div>
                  </div>
                )}

                {/* 正文下半 - 双列排版 */}
                {afterQuote.length > 0 && (
                  <div className="column-text">
                    {afterQuote.map((paragraph, idx) => (
                      <p
                        key={idx}
                        className="font-serif-sc text-base text-on-surface-variant leading-[1.8] mb-8 text-justify"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                )}

                {status === "streaming" && <span className="typewriter-cursor" />}
              </div>

              {/* Bottom Actions */}
              {status === "done" && (
                <div className="max-w-5xl mx-auto mt-24 text-center">
                  <Link
                    href="/"
                    className="text-sm text-secondary hover:text-primary transition-colors font-semibold"
                  >
                    Back to Home
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function GenerateArticlePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <GenerateArticleContent />
    </Suspense>
  );
}
