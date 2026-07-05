/**
 * 采访对话处理工具
 * 负责对话格式化、信息提取 prompt、文章生成 prompt
 */

import type { ChatMessage } from "./types";

// ========== 类型定义 ==========

/** 从对话中提取的写作素材包 */
export interface ExtractedInfo {
  /** 人物画像：这个人是谁 */
  profile: {
    summary: string;
    occupation: string;
    keyExperiences: string[];
    personality: string;
  };
  /** 核心主题：这篇报道要讲他的什么（一个角度） */
  theme: string;
  /** 故事片段：发生过的具体事、经历 */
  stories: {
    summary: string;
    details: string[];
    turningPoint: string;
  }[];
  /** 细节场景：有画面感的片段 */
  scenes: {
    description: string;
    sensoryDetails: string[];
    atmosphere: string;
  }[];
  /** 人物原话：受访者说过的、可能有引用价值的话 */
  quotes: {
    text: string;
    context: string;
  }[];
}

// ========== 核心函数 ==========

/**
 * 将对话历史转换为 LLM 可读的文本格式
 */
export function formatDialogueForLLM(history: ChatMessage[]): string {
  return history
    .map((msg) => {
      const speaker = msg.role === "assistant" ? "采访者" : "受访者";
      return `[${speaker}]：${msg.content}`;
    })
    .join("\n\n");
}

/**
 * 生成信息提取的 prompt
 * 从对话中整理写作素材，供后续撰写人物专访使用
 */
export function buildExtractionPrompt(
  dialogue: string,
  nickname: string
): string {
  return `你是一位资深杂志编辑的助手。你的任务是从一段采访对话中整理出写作素材，供后续撰写人物专访使用。

受访者：${nickname}

下面是采访对话：
${dialogue}

请从对话中整理以下素材，用 JSON 格式返回：

{
  "profile": {
    "summary": "一句话描述这个人是谁",
    "occupation": "职业或身份（对话中未提及则留空字符串）",
    "keyExperiences": ["关键经历1", "关键经历2"],
    "personality": "性格特质（对话中未体现则留空字符串）"
  },
  "theme": "这篇报道要讲他的什么（一句话，提炼一个角度，不是话题复述）",
  "stories": [
    {
      "summary": "故事概要",
      "details": ["具体细节：时间/地点/人物/事件"],
      "turningPoint": "转折点（没有则留空字符串）"
    }
  ],
  "scenes": [
    {
      "description": "场景描述",
      "sensoryDetails": ["感官细节：视觉/听觉/触觉等"],
      "atmosphere": "氛围"
    }
  ],
  "quotes": [
    {
      "text": "受访者原话",
      "context": "说这句话的上下文"
    }
  ]
}

整理原则：
1. 只整理对话中实际出现的信息，不要编造、不要推测、不要补充。
2. profile 和 theme 是必有项；stories / scenes / quotes 有就整理，没有就返回空数组，不要硬凑。
3. stories 的数量不限，有几个整理几个；scenes 和 quotes 同理。
4. quotes 只收受访者（不是采访者）说过的话，且是相对完整、有独立意义的句子，不要收碎片化的短语。
5. theme 要是一个角度，不是话题本身。例如话题是"工作"，theme 应该是"他从大厂离开后重新找到节奏"这样的提炼。
6. 只返回 JSON，不要加任何解释。
7. 关键：如果对话内容太少、没有实质信息（比如只有一两句闲聊、表情、语气词），stories / scenes / quotes 都返回空数组，profile.summary 和 theme 也留空字符串。不要为了填满字段而编造内容。`;
}

/**
 * 生成文章的 prompt
 * 第三人称叙述体，记者隐身，800-1200 字
 */
export function buildArticlePrompt(
  extracted: ExtractedInfo,
  nickname: string
): string {
  return `你是一位资深杂志编辑，擅长撰写人物专访。现在请根据以下采访素材，为受访者撰写一篇杂志人物文章。

受访者：${nickname}

采访素材：
${JSON.stringify(extracted, null, 2)}

写作要求：

【体裁】
第三人称叙述体。你是一个隐身的叙述者，用"他"或"她"来讲述这个人的故事。不要出现"记者""采访者""我问了"这类痕迹，让读者感觉在读一篇关于这个人的报道，而不是一段对话的整理。

【篇幅】
800-1200 字（不含标题和金句）。这是硬性限制，绝对不能超过 1200 字。素材少就写精炼些，不要为凑字数而注水。

【结构】
不限定结构，由你根据素材自行组织。但必须有标题，标题在 12 字以内。正文分成上半和下半两部分，中间用一句金句隔开。

【素材使用】
1. 用 stories 里的故事作为文章主体，用 scenes 里的场景让叙述有画面感。
2. 如果 quotes 里有有力、完整的原话，可以在正文中引用，用中文引号「」或""标注，作为正文的一部分正常排版。
3. 文章中间放一句大字金句，用 > 引用块格式（新起一行写 > 金句内容），单独成段，前后用空行与正文隔开。这句话由你根据整篇报道的主旨提炼，是这篇文章最想留给读者的一句话。要基于本次采访的内容，不要凭空编造与采访无关的句子。这句话会以醒目大字展示，所以要值得被这样对待。全文只能出现一次金句，绝对不要重复。
4. theme 是这篇文章的主线，围绕它来组织素材。但不要在文章里直接写出 theme 这句话——让读者读完自然感受到。
5. profile 提供人物底色，自然融入叙述，不要像填表一样罗列"他是XX，做过XX"。

【底线】
1. 只用素材里有的信息。可以合理补充场景氛围（如"午后的阳光照进来"），但不能编造事实：不能编造受访者没说过的经历、没去过的地方、没表达过的观点。
2. 不要抒情泛滥，不要强行升华结尾。让故事自己说话。
3. 不要出现"AI""采访""对话"等暴露生成痕迹的词。

【输出格式】
第一行是标题，格式：# 标题
然后空一行，接着是正文。

结构如下（严格遵守）：
1. # 标题
2. 空行
3. 正文上半部分（若干段落，段落之间用空行分隔）
4. 空行
5. > 金句内容（只出现一次，用 > 开头，单独成行）
6. 空行
7. 正文下半部分（若干段落，段落之间用空行分隔）

注意：全文只能有一个 > 开头的金句行。正文中的原话引用用中文引号「」或""标注，不要用 > 格式。

请开始写作。`;
}
