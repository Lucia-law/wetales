/**
 * Director Agent —— 采访者的自我监督意识
 *
 * 职责：模拟优秀采访者脑子里的后台意识——识别未展开线索、判断对话状态、判断素材充分性。
 * 关键原则：advisory（建议而非指令）。Director 给的是"可参考的状态与信号"，不教 Persona 怎么说话。
 * Persona 看到"未展开线索"和"信号"自己会去追——怎么追由 SKILL.md 定义，不由 Director 定义。
 *
 * 判断维度来源：13 个真实鲁豫采访视频分析（对话型 / 慢谈型 / 多元对话型三组）。
 * 核心发现：鲁豫最强能力不是"问什么"，而是"抓信号选工具"——
 * 追问几乎都由受访者的无意识信号触发（修正用词、模糊化、回避感受），工具选择取决于防御度。
 */

import { chatSync } from "./llm";
import { TOPIC_CATEGORIES, type ChatMessage, type InterviewerId, type PrepareForm } from "./types";
import { loadSkillMd } from "./skill-loader";

// ========== 类型定义 ==========

export type ConversationPhase = "开场" | "深入" | "敏感话题" | "收尾";
export type MaterialSufficiency = "不足" | "勉强" | "充分";

/**
 * 对话健康度——4 个状态，每个有明确的定义和触发信号。
 * 取代原来的"流畅/需要干预/停滞"（太模糊，Persona 不知道该干什么）。
 */
export type ConversationHealth =
  | "留白健康"   // 对话在自然推进（包括主动留白、有价值的叙述流）
  | "单向独白"   // 受访者在长篇叙述但停在事实层，缺少追问介入点
  | "回答变短"   // 受访者连续回答很短，可能在回避或失去兴趣
  | "冷场太久";  // 上一轮之后沉默或重复，需要救场

/**
 * 受访者信号——捕捉对方回答里的无意识信号，是抓词追问/感官化提问的触发点。
 * 来源：视频组 1（对话型）分析——papi酱把"四两拨千斤"修正成"四两拨四两"，
 * 鲁豫立刻抓住反问"为什么"，挖出对短视频媒介的自我认知。
 */
export type IntervieweeSignal =
  | "无"              // 没有明显信号
  | "word_correction" // 受访者修正自己的用词（如把"四两拨千斤"改成"四两拨四两"）——抓词追问触发点
  | "hedging"         // 受访者用模糊词（"还行吧""蛮多的""没有太多收获"）——感官化提问触发点
  | "deflection";     // 受访者在转移话题或回避感受——需要退一步或共情前置

/**
 * 信号——上一轮受访者回答里的关键信号，触发立即介入（不等 3 轮）。
 *
 * 与 IntervieweeSignal 的关系：IntervieweeSignal 是 DirectorNote 里嵌入的"附带上报字段"，
 * 颗粒度较粗（无/word_correction/hedging/deflection）；Signal 是独立每轮跑的轻量检测，
 * 颗粒度更细——额外覆盖 emotional_pause / repetition_loop / significant_detail 三类需要
 * "不等 3 轮立刻介入"的信号。
 *
 * 来源：3 份视频分析笔记——鲁豫按信号介入，不按定时介入。
 * - word_correction：papi酱"四两拨四两"——抓词追问
 * - hedging："还行吧""蛮多的""没有太多收获"——感官化提问
 * - deflection：李诞绕"怕失望"不直说——共情前置或退一步
 * - emotional_pause：戴锦华讲到"被宣告濒死"时停顿——主动沉默让出舞台
 * - repetition_loop：连续重复同一段叙述——立刻换方向
 * - significant_detail：突然提到具体人名/事件/矛盾——立刻深入
 */
export type Signal =
  | "word_correction"    // 改口——抓词追问触发点
  | "hedging"            // 模糊化——感官化提问触发点
  | "deflection"         // 回避感受——共情前置触发点
  | "emotional_pause"    // 情绪停顿——主动沉默触发点
  | "repetition_loop"    // 车轱辘话——换方向触发点
  | "significant_detail" // 重要细节——立刻深入触发点
  | null;                // 无信号

/**
 * 防御度——决定 Persona 该用直接好奇还是共情前置。
 * 来源：视频组 1 分析——papi酱聊母校不认可、刘震云聊创作不足，都是"需要共情前置"的时刻。
 * open：可直接好奇追问；guarded：需自我暴露式共情；defensive：需退一步或换话题。
 */
export type Defensiveness = "open" | "guarded" | "defensive";

/**
 * 情绪深度——当前对话触及的情绪层次，决定继续沉默还是接住。
 * 来源：视频组 2（慢谈型）分析——戴锦华讲到"被宣告濒死"时，信息已足够但情绪还在走，
 * 鲁豫选择继续沉默。现有 materialSufficiency 只衡量信息量，不衡量情绪深度。
 */
export type EmotionDepth = "事实层" | "感受层" | "意义层";

/**
 * 素材笔记——每轮对话后的素材增量。
 *
 * 设计动机：用户反馈"每一轮上下文进入之后，按照某种模式把它整理好，算是一种精简上下文的方式，
 * 然后把它写在一个地方。这样之后判断文章题材够不够丰富的人，就可以直接读这个上下文。"
 *
 * Director 不再读完整 history 判断 materialSufficiency，而是累积这些笔记作为"精简后的上下文"。
 * Writer/Reviewer 也可读这些笔记（而非完整对话历史）来判断素材是否够写文章。
 *
 * 来源对齐：字段对应 12 篇真实杂志特稿分析（articles-group1-4）提炼的 6 维度——
 * events（场景密度）、quotes（引语嵌套）、sensoryDetails（感官颗粒度）、
 * conflicts（矛盾张力）、emotionDepth（节奏呼吸 + 收尾意象的素材前置）。
 */
export interface MaterialNote {
  /** 第几轮（从 1 开始计数） */
  round: number;
  /** 这一轮出现的事件（具体事件，不是判断——人名/时间/地点/动作） */
  events: string[];
  /** 这一轮出现的引语（受访者原话，相对完整有独立意义） */
  quotes: string[];
  /** 这一轮出现的感官细节（触觉/视觉/听觉，必须是受访者原话提到的） */
  sensoryDetails: string[];
  /** 这一轮出现的矛盾点（言行不一/内外张力/价值冲突） */
  conflicts: string[];
  /** 这一轮触及的情绪深度 */
  emotionDepth: EmotionDepth;
}

/** 导演笔记：注入 Persona Agent system prompt 的元信息 */
export interface DirectorNote {
  /** 当前对话阶段 */
  phase: ConversationPhase;
  /** 已触及的主题 */
  coveredThemes: string[];
  /** 受访者提及但未展开的线索——具体到人名/事件/情感/矛盾，不要泛泛说"可以深入探索" */
  unexploredLeads: string[];
  /** 素材是否足够生成一篇好文章 */
  materialSufficiency: MaterialSufficiency;
  /** 对话健康度 */
  conversationHealth: ConversationHealth;
  /** 受访者回答里的无意识信号（advisory——Persona 可据此选择抓词追问/感官化提问等工具） */
  intervieweeSignal: IntervieweeSignal;
  /** 受访者当前的防御度（advisory——open 可直接好奇，guarded/defensive 需共情前置） */
  defensiveness: Defensiveness;
  /** 当前对话触及的情绪深度（advisory——感受层/意义层时可主动留白，事实层时可继续追问） */
  emotionDepth: EmotionDepth;
  /** 综合观察：把信任水位/互惠度/沉默状态等次要信号打包成一句话，避免字段爆炸 */
  observation: string;
  /** advisory 建议（非指令）：Persona 可参考但不强制执行。语气必须是"可考虑…""值得…""若…则…" */
  recommendedAction: string;
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

// ========== 信号触发机制（每轮跑，不等 3 轮） ==========

/**
 * 检测上一轮受访者回答里的关键信号。
 * 不做完整 DirectorNote 分析——只检测是否需要立即介入。
 * 比 shouldRunDirector 轻量，每轮都跑。
 * 失败时返回 null，不影响主流程。
 *
 * 实现方式：用一次极简 LLM 调用（temperature 低、输出极简），只看上一轮用户消息。
 */
export async function detectSignal(lastUserMessage: string): Promise<Signal> {
  // 极短消息直接跳过——空内容/单字/纯标点没必要调 LLM
  if (!lastUserMessage || lastUserMessage.trim().length < 4) {
    return null;
  }

  try {
    const prompt = `你在观察一场采访。受访者刚刚说了下面这段话：

${lastUserMessage}

请判断这段话里是否出现以下关键信号之一（参考鲁豫真实采访的介入节奏——她按信号介入，不按定时介入）：

- word_correction：受访者修正自己的用词（如把"四两拨千斤"改成"四两拨四两"），是抓词追问的触发点
- hedging：受访者用模糊词（"还行吧""蛮多的""没有太多收获"），是感官化提问的触发点
- deflection：受访者在转移话题或回避感受（如绕着"怕失望"不直说），是共情前置的触发点
- emotional_pause：受访者讲到哽咽/停顿/沉默处（如讲到"被宣告濒死"时），是主动沉默的触发点
- repetition_loop：受访者连续车轱辘话（重复同一段叙述/绕圈子），是换方向的触发点
- significant_detail：受访者突然提到一个具体的、重要的细节（具体人名/事件/矛盾），是立刻深入的触发点
- null：没有明显信号

只返回一个标识符（如 word_correction 或 null），不要加任何解释或 markdown 代码块标记。`;

    const response = await chatSync({
      messages: [
        {
          role: "system",
          content:
            "你是一个采访信号检测器，只返回一个标识符（word_correction / hedging / deflection / emotional_pause / repetition_loop / significant_detail / null），不加任何解释。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    });

    const cleaned = response.trim().toLowerCase();
    const validSignals: Exclude<Signal, null>[] = [
      "word_correction",
      "hedging",
      "deflection",
      "emotional_pause",
      "repetition_loop",
      "significant_detail",
    ];
    for (const s of validSignals) {
      if (cleaned.includes(s)) {
        return s;
      }
    }
    // 包含 "null" / "无" / 空内容均视为无信号
    return null;
  } catch (err) {
    console.warn("[director] detectSignal 失败，跳过信号检测:", err);
    return null;
  }
}

/**
 * 把 Signal 翻译成可注入 Persona system prompt 的 advisory 提示。
 * 强调"参考而非指令"——Persona 可据此选择工具，但不强制执行。
 * 内部辅助函数，供 route.ts 使用。
 */
export function formatSignalHint(signal: Signal): string {
  if (!signal) return "";

  const hints: Record<Exclude<Signal, null>, string> = {
    word_correction:
      "上一轮受访者修正了自己的用词——可考虑抓词追问，把修正后的词原样抛回，问其背后的差异。",
    hedging:
      "上一轮受访者用了模糊词——可考虑感官化提问，要一个具体例子或画面，把抽象拉回具体。",
    deflection:
      "上一轮受访者在回避感受或转移话题——可考虑退一步，或用自我暴露式共情拉近距离，不要硬戳。",
    emotional_pause:
      "上一轮受访者讲到情绪停顿处——可考虑主动沉默让出舞台，等对方自己把情绪走完，不要急着接话。",
    repetition_loop:
      "上一轮受访者在车轱辘话——可考虑换方向，抛一个新的角度或框架词，不要在原地打转。",
    significant_detail:
      "上一轮受访者提到了一个具体的重要细节——可考虑立刻深入，围绕这个人名/事件/矛盾展开追问。",
  };

  return `
---

# 信号提示（advisory 参考，不是说话方式指令）

${hints[signal]}

这是给你参考的——追不追、怎么追，由你自己判断。`;
}

// ========== 素材笔记累积机制（每轮跑，比 runDirector 轻量） ==========

/**
 * 从一轮对话中提取素材笔记。
 * 每轮都跑，比 runDirector 轻量。
 * 失败时返回 null。
 *
 * 设计动机：用户反馈"每一轮上下文进入之后，按照某种模式把它整理好"。
 * 累积这些笔记后，Director 判断 materialSufficiency 时读笔记而非全部历史，
 * Writer/Reviewer 也可读笔记判断素材是否够写文章。
 */
export async function extractMaterialNote(
  lastUserMessage: string,
  lastAssistantMessage: string,
  round: number
): Promise<MaterialNote | null> {
  // 没有受访者消息则跳过
  if (!lastUserMessage || lastUserMessage.trim().length === 0) {
    return null;
  }

  try {
    const prompt = `你在整理一场采访的第 ${round} 轮对话。你的任务是从这一轮里提取可写文章的素材增量——只整理这一轮新出现的素材，不要总结，不要判断。

【采访者（上一轮）】
${lastAssistantMessage || "（无）"}

【受访者（这一轮）】
${lastUserMessage}

请只提取这一轮新出现的素材，返回 JSON：

{
  "round": ${round},
  "events": ["这一轮出现的具体事件（人名/时间/地点/动作，不是判断）"],
  "quotes": ["这一轮出现的引语（受访者原话，相对完整有独立意义的句子）"],
  "sensoryDetails": ["这一轮出现的感官细节（触觉/视觉/听觉，必须是受访者原话提到的具体画面）"],
  "conflicts": ["这一轮出现的矛盾点（言行不一/内外张力/价值冲突）"],
  "emotionDepth": "事实层 | 感受层 | 意义层"
}

emotionDepth 判断标准：
- "事实层"：只讲事件/数据/表面信息
- "感受层"：讲到情绪/体感（如"心里有一个黑洞""双手发抖"）
- "意义层"：讲到对自我/人生的重新理解（如"我太孤独了"作为自我认知）

原则：
1. 只整理这一轮实际出现的素材，不要编造、推测、补充
2. 如果某类素材没出现，对应字段返回空数组
3. quotes 只收受访者（不是采访者）说过的话，且是相对完整、有独立意义的句子，不要收碎片化的短语
4. sensoryDetails 必须是受访者原话提到的具体感官细节（如"背古琴在站台弹琴"），不要抽象感受
5. conflicts 必须是明确出现的矛盾，不要硬找
6. 只返回 JSON，不要加任何解释或 markdown 代码块标记。`;

    const response = await chatSync({
      messages: [
        {
          role: "system",
          content:
            "你是一个采访素材整理助手，只返回 JSON 格式的数据，不加任何解释或 markdown 代码块标记。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    });

    // 解析 JSON（可能被 markdown 代码块包裹）
    const jsonMatch =
      response.match(/```json\s*([\s\S]*?)\s*```/) ||
      response.match(/```\s*([\s\S]*?)\s*```/) ||
      [null, response];
    const parsed = JSON.parse(jsonMatch[1] || response) as Partial<MaterialNote>;

    // 兜底字段——LLM 偶尔会漏字段或返回 null
    const note: MaterialNote = {
      round,
      events: Array.isArray(parsed.events) ? parsed.events.filter((e) => typeof e === "string") : [],
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes.filter((e) => typeof e === "string") : [],
      sensoryDetails: Array.isArray(parsed.sensoryDetails)
        ? parsed.sensoryDetails.filter((e) => typeof e === "string")
        : [],
      conflicts: Array.isArray(parsed.conflicts)
        ? parsed.conflicts.filter((e) => typeof e === "string")
        : [],
      emotionDepth:
        parsed.emotionDepth === "事实层" ||
        parsed.emotionDepth === "感受层" ||
        parsed.emotionDepth === "意义层"
          ? parsed.emotionDepth
          : "事实层",
    };
    return note;
  } catch (err) {
    console.warn("[director] extractMaterialNote 失败，跳过素材笔记:", err);
    return null;
  }
}

/**
 * 把累积的素材笔记格式化为文本，供 Director 判断时参考。
 * 输出包含：每轮的素材增量 + 累积量化统计。
 *
 * 量化统计的阈值标准来自 12 篇真实杂志特稿分析（articles-group1-4）：
 * - 核心事件 ≥1 个，支撑事件 ≥2-3 个
 * - 引语 ≥3-5 句有场景的引语
 * - 感官细节 ≥3-5 个具体感官细节
 * - 矛盾点 ≥1 个明确的矛盾张力
 */
export function formatMaterialNotes(notes: MaterialNote[]): string {
  if (!notes || notes.length === 0) {
    return "（暂无素材笔记——可能是首轮对话或素材提取失败）";
  }

  // 按 round 排序，避免乱序
  const sorted = [...notes].sort((a, b) => a.round - b.round);

  const lines: string[] = ["# 累积素材笔记（每轮增量，由 extractMaterialNote 整理）"];

  for (const note of sorted) {
    lines.push(`\n## 第 ${note.round} 轮（情绪深度：${note.emotionDepth}）`);
    if (note.events.length > 0) {
      lines.push(`- 事件：${note.events.join("；")}`);
    } else {
      lines.push(`- 事件：（无）`);
    }
    if (note.quotes.length > 0) {
      lines.push(`- 引语：${note.quotes.map((q) => `「${q}」`).join("；")}`);
    } else {
      lines.push(`- 引语：（无）`);
    }
    if (note.sensoryDetails.length > 0) {
      lines.push(`- 感官细节：${note.sensoryDetails.join("；")}`);
    } else {
      lines.push(`- 感官细节：（无）`);
    }
    if (note.conflicts.length > 0) {
      lines.push(`- 矛盾点：${note.conflicts.join("；")}`);
    } else {
      lines.push(`- 矛盾点：（无）`);
    }
  }

  // 累积量化统计——Director 据此判断 materialSufficiency
  const totalEvents = sorted.reduce((sum, n) => sum + n.events.length, 0);
  const totalQuotes = sorted.reduce((sum, n) => sum + n.quotes.length, 0);
  const totalSensory = sorted.reduce((sum, n) => sum + n.sensoryDetails.length, 0);
  const totalConflicts = sorted.reduce((sum, n) => sum + n.conflicts.length, 0);
  const reachedFeelingLayer = sorted.some(
    (n) => n.emotionDepth === "感受层" || n.emotionDepth === "意义层"
  );
  const reachedMeaningLayer = sorted.some((n) => n.emotionDepth === "意义层");

  lines.push(`\n## 素材量化统计（Director 据此判断 materialSufficiency）`);
  lines.push(`- 总事件数：${totalEvents}（核心事件标准：≥1 个；支撑事件标准：≥2-3 个）`);
  lines.push(`- 总引语数：${totalQuotes}（标准：≥3-5 句有场景的引语）`);
  lines.push(`- 总感官细节数：${totalSensory}（标准：≥3-5 个具体感官细节）`);
  lines.push(`- 总矛盾点数：${totalConflicts}（标准：≥1 个明确的矛盾张力）`);
  lines.push(`- 触及感受层/意义层：${reachedFeelingLayer ? "是" : "否"}`);
  lines.push(`- 触及意义层：${reachedMeaningLayer ? "是" : "否"}`);

  return lines.join("\n");
}

/**
 * 提取 SKILL.md 的核心方法论摘要（作为 Director 的分析背景）。
 * Director 读取这个背景是为了更准确地判断"哪些线索值得展开"——
 * 但输出里仍然不含策略指令。
 */
function extractSkillSummary(interviewer: InterviewerId): string {
  const skillMd = loadSkillMd(interviewer);
  // 提取核心原则和行动模式部分（前 4000 字作为背景）
  // 注意：这是分析背景，不是让 Director 执行这些策略
  const summary = skillMd.length > 4000 ? skillMd.substring(0, 4000) + "\n...（已截断）" : skillMd;
  return summary;
}

/**
 * 构建 Director 的分析 prompt。
 *
 * 调整说明：不再传入完整 history，改为传入累积的 MaterialNote 列表。
 * 设计动机：用户反馈"判断文章题材够不够丰富的人，可以直接读这个上下文（素材笔记）"。
 * Director 基于精简后的素材笔记判断 materialSufficiency，更准确，也避免读完整对话带来的 token 浪费。
 */
function buildDirectorPrompt(
  materialNotes: MaterialNote[],
  prepare: PrepareForm,
  interviewer: InterviewerId
): string {
  const notesText = formatMaterialNotes(materialNotes);
  const topicLabel = TOPIC_CATEGORIES[prepare.topicCategory].label;
  const skillSummary = extractSkillSummary(interviewer);

  return `你是一个采访者的自我监督意识。你在观察一场正在进行的采访，识别对话状态、受访者的无意识信号、未展开的线索。

你不是导演，不指挥采访者怎么说话。你只做四件事：
1. 识别未展开的线索（受访者提及但没展开的人名/事件/情感/矛盾）
2. 判断对话状态（留白健康/单向独白/回答变短/冷场太久）
3. 识别受访者的无意识信号（修正用词/模糊化/回避感受）和防御度（open/guarded/defensive）
4. 判断情绪深度（事实层/感受层/意义层）和素材充分性

以下是采访者的人格方法论背景（供你理解采访结构，不是让你指挥采访者）：
${skillSummary}

受访者昵称：${prepare.nickname}
话题方向：${topicLabel}
${prepare.topic ? `补充说明：${prepare.topic}` : ""}

以下是累积的素材笔记（每轮由 extractMaterialNote 整理的素材增量 + 量化统计）——这是你判断 materialSufficiency 的主要依据：
${notesText}

请基于素材笔记分析并返回 JSON：

{
  "phase": "开场 | 深入 | 敏感话题 | 收尾",
  "coveredThemes": ["已触及的主题"],
  "unexploredLeads": ["受访者提及但未展开的线索"],
  "materialSufficiency": "不足 | 勉强 | 充分",
  "conversationHealth": "留白健康 | 单向独白 | 回答变短 | 冷场太久",
  "intervieweeSignal": "无 | word_correction | hedging | deflection",
  "defensiveness": "open | guarded | defensive",
  "emotionDepth": "事实层 | 感受层 | 意义层",
  "observation": "一句话综合观察，可包含信任水位/互惠度/沉默状态等次要信号",
  "recommendedAction": "advisory 建议，语气必须是'可考虑…''值得…''若…则…'，不是指令"
}

各字段判断标准：

materialSufficiency（基于素材笔记的量化统计判断——这是本次强化的核心）：
- "不足"：缺核心事件（总事件数 < 1）或缺支撑事件（总事件数 < 2）。即使有引语和感官细节，事件不够也算不足。
- "勉强"：事件够（总事件数 ≥ 2）但引语/感官/矛盾有缺——具体标准：总引语 < 3 句，或总感官细节 < 3 个，或总矛盾点 < 1 个。素材够撑起一篇简讯但不够能写出有张力的特稿。
- "充分"：所有维度都满足——总事件 ≥ 3（含至少 1 个核心事件 + 2 个支撑事件）、总引语 ≥ 3 句（有场景的引语）、总感官细节 ≥ 3 个、总矛盾点 ≥ 1 个明确的矛盾张力。建议同时触及过感受层或意义层。

conversationHealth（基于最近 1-3 轮素材笔记的趋势判断）：
- "留白健康"：对话在自然推进（最近轮有 events/quotes 增量，emotionDepth 在感受层/意义层）。这是有价值的叙述流，不是冷场。
- "单向独白"：最近轮 events 多但 emotionDepth=事实层，缺少追问介入点（区别于有价值的叙述流）。
- "回答变短"：最近 1-2 轮 events/quotes/sensoryDetails 都很少或为空，受访者可能在回避或失去兴趣。
- "冷场太久"：最近轮的 MaterialNote 几乎全空（events/quotes/sensoryDetails/conflicts 都为空），连续无实质内容交换。

intervieweeSignal（来源：鲁豫真实采访分析——她的追问几乎都由受访者的无意识信号触发）：
- "无"：没有明显信号
- "word_correction"：受访者修正自己的用词（如 papi酱把"四两拨千斤"改成"四两拨四两"）——抓词追问触发点
- "hedging"：受访者用模糊词（"还行吧""蛮多的""没有太多收获"）——感官化提问触发点
- "deflection"：受访者在转移话题或回避感受（如李诞绕着"怕失望"不直说）——需要退一步或共情前置
  注意：intervieweeSignal 主要从最近一轮的 quotes/events 里推断。如果最近轮没有 quotes，则很难判断信号，标"无"。

defensiveness（决定 Persona 该用直接好奇还是共情前置）：
- "open"：受访者主动展开，events/quotes 丰富，可直接好奇追问
- "guarded"：受访者回答克制，events 少或 emotionDepth 停在事实层，需自我暴露式共情拉近距离
- "defensive"：受访者明显回避或抵触——conflicts 出现但 emotionDepth 仍在事实层，或最近轮笔记几乎全空但有 conflicts，需退一步或换话题

emotionDepth（慢谈型核心——情绪到位才能停）：
- "事实层"：累积笔记里没有触及感受层/意义层，全部停在事件/数据/表面信息
- "感受层"：累积笔记里至少有一轮触及感受层（讲到情绪/体感）
- "意义层"：累积笔记里至少有一轮触及意义层（讲到对自我/人生的重新理解）。意义层是情绪深度的最高级。

observation：把信任水位/互惠度/沉默状态等次要信号打包成一句话。例如"受访者开始主动抛话题，互惠度上升"或"信任水位在试探层，敏感话题需暂缓"。

recommendedAction（advisory 原则——建议而非指令）：
- 必须是"可考虑…""值得…""若…则…"这种语气
- 不要说"你应该…""下一步问…""必须…"
- 例子："若受访者修正用词，可考虑抓词追问""情绪刚到感受层，值得主动留白让它走完""防御度上升，可考虑用自我暴露式共情拉近距离"

注意：
1. unexploredLeads 要具体——不是"可以深入探索"，而是"受访者提到了母亲但没展开"。从素材笔记的 events 里找具体人名/事件
2. observation 是一句话，不是列表
3. recommendedAction 是一条建议，不是多条
4. 只返回 JSON，不要加任何解释或 markdown 代码块标记。`;
}

/**
 * 运行 Director Agent，返回导演笔记。
 *
 * 调整说明：不再传入完整 history，改为传入累积的 MaterialNote 列表。
 * Director 基于素材笔记判断 materialSufficiency，更准确，也避免 token 浪费。
 * 失败时返回 null（不影响 Persona Agent 正常工作）。
 */
export async function runDirector(
  materialNotes: MaterialNote[],
  prepare: PrepareForm,
  interviewer: InterviewerId
): Promise<DirectorNote | null> {
  try {
    const prompt = buildDirectorPrompt(materialNotes, prepare, interviewer);
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
 * 明确标注为"对话状态参考"，强调 Persona 的创作自主权。
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

# 对话状态（元信息——advisory 参考，不是说话方式指令）

- 阶段：${note.phase}
- 状态：${note.conversationHealth || "未知"}
- 已触及：${covered}
- 未展开线索：${leads}
- 素材充分性：${note.materialSufficiency}
- 受访者信号：${note.intervieweeSignal || "无"}
- 防御度：${note.defensiveness || "未知"}
- 情绪深度：${note.emotionDepth || "未知"}
- 观察：${note.observation || "无"}
- 可参考建议：${note.recommendedAction || "无"}

线索、信号、建议都是给你参考的——追不追、怎么追，由你自己判断。`;
}
