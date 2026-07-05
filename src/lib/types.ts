// 采访功能共享类型定义

export type InterviewerId = "resonator" | "deconstructor";

export interface InterviewerMeta {
  id: InterviewerId;
  name: string; // 中文展示名（内部标识）
  englishName: string; // 英文展示名（UI 用）
  tagline: string;
  description: string;
  avatar: string;
  skillDir: string;
}

export const INTERVIEWERS: Record<InterviewerId, InterviewerMeta> = {
  resonator: {
    id: "resonator",
    name: "共鸣者",
    englishName: "Resonator",
    tagline: "轻问重答的主动倾听者",
    description: "温暖、共情、用极简追问撬动深层表达",
    avatar: "/avatars/Resonator.jpg",
    skillDir: "resonator",
  },
  deconstructor: {
    id: "deconstructor",
    name: "解构者",
    englishName: "Deconstructor",
    tagline: "计算是底色，疯狂是策略",
    description: "犀利、解构、用反讽与还原论拆解议题",
    avatar: "/avatars/Deconstructor.jpg",
    skillDir: "deconstructor",
  },
};

export type TopicCategory = "work" | "relationships" | "self" | "moment";

export const TOPIC_CATEGORIES: Record<
  TopicCategory,
  { label: string; description: string }
> = {
  work: {
    label: "Work",
    description: "Your craft, your career, how you get things done.",
  },
  relationships: {
    label: "Relationships",
    description: "The people who shape you — and how you shape them back.",
  },
  self: {
    label: "Self",
    description: "Who you're becoming, what you stand for, what's shifting.",
  },
  moment: {
    label: "Moment",
    description: "A single moment that stuck — recent or from the past.",
  },
};

export interface PrepareForm {
  interviewer: InterviewerId;
  nickname: string; // 必填
  topicCategory: TopicCategory; // 必填
  topic?: string; // 选填（补充说明）
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StartRequestBody {
  prepare: PrepareForm;
}

export interface ChatRequestBody {
  interviewer: InterviewerId;
  prepare: PrepareForm;
  history: ChatMessage[];
}
