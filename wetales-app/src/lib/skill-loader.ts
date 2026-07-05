import fs from "node:fs";
import path from "node:path";
import { INTERVIEWERS, TOPIC_CATEGORIES, type InterviewerId, type PrepareForm } from "./types";

/**
 * 服务端读取 SKILL.md 内容作为主持人风格定义。
 * 路径：wetales-app/../skills/<skillDir>/SKILL.md
 */
export function loadSkillMd(interviewer: InterviewerId): string {
  const meta = INTERVIEWERS[interviewer];
  const skillPath = path.join(
    process.cwd(),
    "..",
    "skills",
    meta.skillDir,
    "SKILL.md"
  );

  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch (err) {
    console.warn(`[skill-loader] 读取 ${skillPath} 失败:`, err);
    // 兜底 prompt：保证 API 不挂
    const fallback =
      interviewer === "resonator"
        ? "你是「共鸣者」采访者。风格：极简追问、主动倾听、自我暴露式共情、不评判、安全空间工程化。一次只问一个三五个字的短问句，用'嗯'/'对'等极简回应给嘉宾留白。"
        : "你是「解构者」采访者。风格：经济还原论拆解利益结构、反讽辩证打破预设、反同情而非煽情、事实层面追问立场层面保留。一次只问一个问题，保持若即若离的观察距离。";
    return fallback;
  }
}

/**
 * 把受访者提交的背景信息组装成 system prompt 的「背景」段落。
 * 只传运行时数据，不加任何采访指令——角色风格由 SKILL.md 自己定义。
 */
export function buildBackgroundBlock(prepare: PrepareForm): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push("# 本次采访背景");
  lines.push("");
  lines.push(`- 受访者昵称：${prepare.nickname}`);
  lines.push(`- 话题方向：${TOPIC_CATEGORIES[prepare.topicCategory].label}`);
  const topic = prepare.topic?.trim();
  lines.push(`- 补充说明：${topic || "（未提供）"}`);
  return lines.join("\n");
}

/**
 * 运行时约束：仅输出格式约定（前端解析依赖），不涉及采访方法论。
 * 采访风格、语言 DNA、流程策略全部由 SKILL.md 自己定义。
 */
export const RUNTIME_INSTRUCTIONS = `

---

# 输出格式约定

1. **每次只发一句**：要么是一个问题，要么是一段极简回应。绝不一次性输出多个问题。
2. **纯对话**：只输出要说的话，不要用括号写动作、表情、心理活动。例如写"你当时怎么想的？"而不是"（看着你）你当时怎么想的？"
`;
