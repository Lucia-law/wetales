"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { type TopicCategory, TOPIC_CATEGORIES } from "@/lib/types";

const interviewers = [
  {
    id: "resonator",
    name: "Resonator",
    description: "Gentle, patient, deep.",
    avatar: "/avatars/Resonator.jpg",
    href: "/interview?interviewer=resonator",
  },
  {
    id: "deconstructor",
    name: "Deconstructor",
    description: "Sharp, ironic, unhurried.",
    avatar: "/avatars/Deconstructor.jpg",
    href: "/interview?interviewer=deconstructor",
  },
];

const phrases = [
  { quote: "Find your voice while you can.", author: "Dead Poets Society" },
  { quote: "The universe is made of stories.", author: "Muriel Rukeyser" },
  { quote: "To be a person is to have a story to tell.", author: "Isak Dinesen" },
  { quote: "We build ourselves out of our story.", author: "Patrick Rothfuss" },
  { quote: "Perhaps everyone has a story that could break your heart.", author: "Nick Flynn" },
  { quote: "Every voice matters; let yours be heard.", author: "Gloria Steinem" },
];

function TypewriterText() {
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const [quoteText, setQuoteText] = useState("");
  const [authorText, setAuthorText] = useState("");
  const [phase, setPhase] = useState<"typing-quote" | "typing-author" | "waiting" | "deleting-author" | "deleting-quote">("typing-quote");

  useEffect(() => {
    const phrase = phrases[currentPhraseIndex];

    if (phase === "typing-quote") {
      if (quoteText === phrase.quote) {
        setPhase("typing-author");
        return;
      }
      const timer = setTimeout(() => {
        setQuoteText(phrase.quote.substring(0, quoteText.length + 1));
      }, 50);
      return () => clearTimeout(timer);
    }

    if (phase === "typing-author") {
      const fullAuthor = `— ${phrase.author}`;
      if (authorText === fullAuthor) {
        setPhase("waiting");
        return;
      }
      const timer = setTimeout(() => {
        setAuthorText(fullAuthor.substring(0, authorText.length + 1));
      }, 40);
      return () => clearTimeout(timer);
    }

    if (phase === "waiting") {
      const timer = setTimeout(() => {
        setPhase("deleting-author");
      }, 2000);
      return () => clearTimeout(timer);
    }

    if (phase === "deleting-author") {
      if (authorText === "") {
        setPhase("deleting-quote");
        return;
      }
      const timer = setTimeout(() => {
        setAuthorText(authorText.substring(0, authorText.length - 1));
      }, 20);
      return () => clearTimeout(timer);
    }

    if (phase === "deleting-quote") {
      if (quoteText === "") {
        setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length);
        setPhase("typing-quote");
        return;
      }
      const timer = setTimeout(() => {
        setQuoteText(quoteText.substring(0, quoteText.length - 1));
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [quoteText, authorText, phase, currentPhraseIndex]);

  const showCursor = phase === "typing-quote" || phase === "deleting-quote";

  return (
    <div>
      <span className="text-on-surface-variant">
        {quoteText}
        {showCursor && <span className="typewriter-cursor" />}
      </span>
      <div className="mt-2 min-h-[1.5em] ml-8 md:ml-16">
        <span className="text-sm text-secondary">
          {authorText}
          {phase === "typing-author" && <span className="typewriter-cursor" />}
        </span>
      </div>
    </div>
  );
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
}

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);

  const createParticle = useCallback((x: number, y: number): Particle => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.5 + 0.1;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3 + 1,
      opacity: Math.random() * 0.4 + 0.1,
      life: 0,
      maxLife: Math.random() * 200 + 100,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Seed initial particles
    for (let i = 0; i < 60; i++) {
      particlesRef.current.push(
        createParticle(
          Math.random() * canvas.width,
          Math.random() * canvas.height
        )
      );
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      // Spawn particles near mouse
      for (let i = 0; i < 2; i++) {
        particlesRef.current.push(
          createParticle(
            e.clientX + (Math.random() - 0.5) * 40,
            e.clientY + (Math.random() - 0.5) * 40
          )
        );
      }
    };
    window.addEventListener("mousemove", handleMouseMove);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const mouse = mouseRef.current;
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        // Mouse interaction - gentle attraction
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200 && dist > 0) {
          const force = (200 - dist) / 200 * 0.02;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        // Apply velocity with damping
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.vy *= 0.99;

        // Fade based on life
        const lifeRatio = p.life / p.maxLife;
        const fadeOpacity = lifeRatio < 0.1
          ? lifeRatio * 10
          : lifeRatio > 0.8
          ? (1 - lifeRatio) * 5
          : 1;

        const alpha = p.opacity * fadeOpacity;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(3, 22, 50, ${alpha})`;
        ctx.fill();

        // Draw connections to nearby particles
        for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
          const p2 = particles[j];
          const ddx = p.x - p2.x;
          const ddy = p.y - p2.y;
          const dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < 100) {
            const lineAlpha = (1 - dd / 100) * alpha * 0.3;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(3, 22, 50, ${lineAlpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        // Remove dead particles
        if (p.life >= p.maxLife || p.x < -50 || p.x > canvas.width + 50 || p.y < -50 || p.y > canvas.height + 50) {
          particles.splice(i, 1);
        }
      }

      // Maintain minimum particle count
      while (particles.length < 40) {
        particles.push(
          createParticle(
            Math.random() * canvas.width,
            Math.random() * canvas.height
          )
        );
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationRef.current);
    };
  }, [createParticle]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
    />
  );
}

function EnterStudioCard({
  interviewer,
  onClose,
  onSubmit,
}: {
  interviewer: typeof interviewers[0] | null;
  onClose: () => void;
  onSubmit: (nickname: string, topicCategory: TopicCategory, topic: string) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [topicCategory, setTopicCategory] = useState<TopicCategory | null>(null);
  const [topic, setTopic] = useState("");
  const [sessionDate] = useState(() => {
    const today = new Date();
    return `${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
  });

  if (!interviewer) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !topicCategory) return;
    onSubmit(nickname.trim(), topicCategory, topic.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-white/70 backdrop-blur-2xl border border-white/80 rounded-2xl shadow-2xl p-8 md:p-10"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-error rounded-full animate-pulse" />
            <span className="text-xs uppercase tracking-[0.2em] text-error font-semibold">
              Session {sessionDate} · Live
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col items-center mb-6">
          <div className="relative w-24 h-24 rounded-full overflow-hidden mb-4">
            <Image
              src={interviewer.avatar}
              alt={interviewer.name}
              fill
              className="object-cover"
              sizes="96px"
            />
          </div>
          <span className="text-[10px] uppercase tracking-[0.3em] text-secondary font-semibold mb-1">
            Your host
          </span>
          <h2 className="font-display text-3xl text-primary">
            {interviewer.name}
          </h2>
        </div>

        <div className="h-px bg-outline-variant/30 my-6" />

        <p className="font-display italic text-lg text-primary/80 text-center mb-8">
          Lights on. The floor is yours.
        </p>

        <div className="flex flex-col gap-5">
          {/* 昵称 */}
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-secondary font-semibold mb-2">
              Your name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="How you'd like to be called."
              required
              className="w-full px-4 py-3 bg-white/60 border border-outline-variant/50 rounded-lg text-primary placeholder:text-secondary/50 focus:outline-none focus:border-primary focus:bg-white/80 transition-all"
            />
          </div>
          {/* 话题类别选择 */}
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-secondary font-semibold mb-2">
              What's on your mind today? <span className="text-error">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(TOPIC_CATEGORIES) as TopicCategory[]).map((key) => {
                const cat = TOPIC_CATEGORIES[key];
                const selected = topicCategory === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTopicCategory(key)}
                    className={`text-left px-4 py-3 rounded-lg border transition-all ${
                      selected
                        ? "bg-primary text-white border-primary shadow-md"
                        : "bg-white/60 border-outline-variant/50 text-primary hover:border-primary hover:bg-white/80"
                    }`}
                  >
                    <div className="text-sm font-semibold tracking-wide">
                      {cat.label}
                    </div>
                    <div className={`text-[11px] mt-0.5 leading-snug ${selected ? "text-white/70" : "text-secondary"}`}>
                      {cat.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          {/* 补充说明（选了话题之后才填） */}
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-secondary font-semibold mb-2">
              More to share? <span className="text-secondary/40 text-[10px] normal-case tracking-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="A thought, a moment, a story."
              className="w-full px-4 py-3 bg-white/60 border border-outline-variant/50 rounded-lg text-primary placeholder:text-secondary/50 focus:outline-none focus:border-primary focus:bg-white/80 transition-all"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!nickname.trim() || !topicCategory}
          className="w-full mt-8 py-3.5 bg-primary text-white font-medium tracking-wide rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Enter studio →
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [hoveredInterviewer, setHoveredInterviewer] = useState<string | null>(
    null
  );
  const [activeInterviewer, setActiveInterviewer] = useState<
    typeof interviewers[0] | null
  >(null);

  const handleSubmit = (nickname: string, topicCategory: TopicCategory, topic: string) => {
    if (!activeInterviewer) return;
    sessionStorage.setItem(
      "wetales:prepare",
      JSON.stringify({
        interviewer: activeInterviewer.id,
        nickname,
        topicCategory,
        topic,
      })
    );
    router.push(`/interview?interviewer=${activeInterviewer.id}`);
  };

  return (
    <>
      <ParticleCanvas />
      <main className="flex-grow flex items-center w-full max-w-7xl mx-auto px-6 md:px-16 py-12 md:py-20 min-h-screen relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 md:gap-24 items-center w-full">
          {/* Left: Brand + Typewriter */}
          <div className="relative">
            {/* Decorative line */}
            <div className="absolute -left-8 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-outline-variant/50 to-transparent" />

            {/* Brand name - takes up space, won't move */}
            <h1 className="font-display text-7xl md:text-8xl lg:text-[120px] text-primary tracking-tight leading-[0.85]">
              <span className="block">We</span>
              <span className="block ml-8 md:ml-16 italic text-secondary">
                Tales
              </span>
            </h1>

            {/* Typewriter - fixed height, won't push brand */}
            <div className="mt-16 h-24 font-display text-lg md:text-xl leading-relaxed">
              <TypewriterText />
            </div>
          </div>

          {/* Right: Interviewers side by side */}
          <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-xs text-secondary uppercase tracking-[0.2em] font-semibold">
                Choose your interlocutor
              </span>
              <div className="flex-1 h-px bg-outline-variant/30" />
            </div>

            <div className="grid grid-cols-2 gap-8">
              {interviewers.map((interviewer) => (
                <button
                  key={interviewer.id}
                  type="button"
                  onClick={() => setActiveInterviewer(interviewer)}
                  className="group flex flex-col items-center text-center"
                  onMouseEnter={() => setHoveredInterviewer(interviewer.id)}
                  onMouseLeave={() => setHoveredInterviewer(null)}
                >
                  <div
                    className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden mb-6 transition-all duration-500 ${
                      hoveredInterviewer === interviewer.id
                        ? "scale-105"
                        : hoveredInterviewer !== null
                        ? "scale-95 opacity-70"
                        : ""
                    }`}
                  >
                    <Image
                      src={interviewer.avatar}
                      alt={interviewer.name}
                      fill
                      className="object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                      sizes="(max-width: 768px) 128px, 160px"
                    />
                  </div>
                  <h3 className="font-display text-2xl md:text-3xl text-primary mb-3 transition-transform duration-300 group-hover:-translate-y-1">
                    {interviewer.name}
                  </h3>
                  <p className="text-sm text-on-surface-variant leading-relaxed max-w-[220px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 -translate-y-2 group-hover:translate-y-0">
                    {interviewer.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
      <EnterStudioCard
        interviewer={activeInterviewer}
        onClose={() => setActiveInterviewer(null)}
        onSubmit={handleSubmit}
      />
    </>
  );
}
