/**
 * Director Agent —— 采访导演
 *
 * 职责：在采访进行中作为后台观察者，分析对话进度并为 Persona Agent 提供非指令性建议。
 * 关键原则：advisory, not directive（建议而非指挥）。
 * Director 不写台词、不决定问什么问题，只提供元信息（对话阶段、覆盖度、素材充分性）。
 */

import { chatSync } from "./llm";
import { formatDialogueForLLM } from "./interview-utils";
import { TOPIC_CATEGORIES, type ChatMessage, type PrepareForm } from "./types";

// ========== 类型定义 ==========

export type ConversationPhase = "开场" | "深入" | "敏感话题" | "收尾";
export type MaterialSufficiency = "不足" | "勉强" | "充分";
export type ConversationHealth = "流畅" | "需要干预" | "停滞";

/** 导演笔记：注入 Persona Agent system prompt 的元信息 */
export interface DirectorNote {
  /** 当前对话阶段 */
  phase: ConversationPhase;
  /** 已触及的主题 */
  coveredThemes: string[];
  /** 受访者提及但未展开的线索 */
  unexploredLeads: string[];
  /** 素材是否足够生成一篇好文章 */
  materialSufficiency: MaterialSufficiency;
  /** 对话健康度 */
  conversationHealth: ConversationHealth;
  /** 具体策略建议——直接引用行动模式中的策略名 */
  recommendedAction: string;
  /** 一条观察 */
  observation: string;
}

// ========== 核心函数 ==========

/**
 * 判断是否应该运行 Director。
 * 触发条件：history 中 assistant 消息数 >= 3 且为 3 的倍数（即每完成 3 轮触发一次）。
 */
export function shouldRunDirector(history: ChatMessage[]): boolean {
  const assistantCount = history.filter((m) => m.role === "assistant").length;
  return assistantCount >= 3 && assistantCount % 3 === 0;
}

/**
 * 构建 Director 的分析 prompt。
 */
function buildDirectorPrompt(
  history: ChatMessage[],
  prepare: PrepareForm
): string {
  const dialogue = formatDialogueForLLM(history);
  const topicLabel = TOPIC_CATEGORIES[prepare.topicCategory].label;

  return `你是一位采访导演，负责观察对话进度并给出具体策略建议。你不是采访者——你不写台词。你分析对话状态，然后告诉采访者应该用什么策略。

受访者昵称：${prepare.nickname}
话题方向：${topicLabel}
${prepare.topic ? `补充说明：${prepare.topic}` : ""}

以下是当前的采访对话：
${dialogue}

请分析对话并返回 JSON：

{
  "phase": "开场 | 深入 | 敏感话题 | 收尾",
  "coveredThemes": ["已触及的主题"],
  "unexploredLeads": ["受访者提及但未展开的线索"],
  "materialSufficiency": "不足 | 勉强 | 充分",
  "conversationHealth": "流畅 | 需要干预 | 停滞",
  "recommendedAction": "具体策略建议",
  "observation": "一句话观察"
}

conversationHealth 判断标准：
- "流畅"：受访者回答有实质内容，对话在自然推进
- "需要干预"：受访者连续回答较短或开始回避，对话质量在下降
- "停滞"：对话冷场、重复、或受访者明显不知道说什么

recommendedAction 必须是以下策略之一（直接写策略名和一句话说明）：
- 如果对方回答流畅 → "继续当前节奏"或"抓词追问（抓住哪个词）"
- 如果对方连续回答很短 → "升级到 Level 2 具象化提问，给一个具体入口（时间/地点/日常动作）"
- 如果对方在说大事但太平淡 → "用 Level 3 感官化提问（问视觉/听觉/触觉）"
- 如果对方提到了线索但跳过 → "用 Level 4 引用原话+好奇"
- 如果对话停滞 → "抛钩子：暴露自己/抛假设性反问/直接表达好奇"
- 如果对话已经足够深入 → "可以准备收尾，或换一个新方向"
- 如果素材已经充分 → "素材充分，可以建议结束采访"

注意：
1. recommendedAction 要具体，不要泛泛说"可以深入探索"。
2. observation 是你对对话状态的一句话判断，如"对方在回避具体细节，可能需要更安全的入口"。
3. 只返回 JSON，不要加任何解释或 markdown 代码块标记。`;
}

/**
 * 运行 Director Agent，返回导演笔记。
 * 失败时返回 null（不影响 Persona Agent 正常工作）。
 */
export async function runDirector(
  history: ChatMessage[],
  prepare: PrepareForm
): Promise<DirectorNote | null> {
  try {
    const prompt = buildDirectorPrompt(history, prepare);
    const response = await chatSync({
      messages: [
        {
          role: "system",
          content:
            "你是一个采访分析助手，只返回 JSON 格式的数据，不要加任何解释或 markdown 代码块标记。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    // 解析 JSON（可能被 markdown 代码块包裹）
    const jsonMatch =
      response.match(/```json\s*([\s\S]*?)\s*```/) ||
      response.match(/```\s*([\s\S]*?)\s*```/) ||
      [null, response];
    const note = JSON.parse(jsonMatch[1] || response) as DirectorNote;

    return note;
  } catch (err) {
    console.warn("[director] 分析失败，跳过导演笔记:", err);
    return null;
  }
}

/**
 * 将导演笔记格式化为可注入 system prompt 的文本段落。
 * 明确标注为"仅供参考"，强调 Persona Agent 的创作自主权。
 */
export function formatDirectorNote(note: DirectorNote): string {
  const covered =
    note.coveredThemes && note.coveredThemes.length > 0
      ? note.coveredThemes.join("、")
      : "无";
  const leads =
    note.unexploredLeads && note.unexploredLeads.length > 0
      ? note.unexploredLeads.join("、")
      : "无";

  return `
---

# 导演笔记（策略参考——最终判断由你做）

- 对话状态：${note.phase} / ${note.conversationHealth || "未知"}
- 已触及：${covered}
- 未展开线索：${leads}
- 素材充分性：${note.materialSufficiency}
- 观察：${note.observation || "无"}
- 建议策略：${note.recommendedAction || "无"}

如果建议策略与你当下的直觉冲突，请忽略它——你才是对话的主人。`;
}
