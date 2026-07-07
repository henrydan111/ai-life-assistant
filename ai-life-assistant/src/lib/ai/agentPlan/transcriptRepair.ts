import { DEFAULT_TIMEZONE } from "@/lib/time/parseTime";
import type { TranscriptRepair } from "@/types/domain";
import { canUseAgentPlan, resolveAgentPlanLanguageModel, runtimeTimezone } from "./provider";
import { requestValidatedAgentPlanJson } from "./validatedJson";

const TRANSCRIPT_REPAIR_PROMPT = `
你是中文语音转写校准器，只负责把 ASR 原始转写修正成适合展示给用户和后续理解的文本。

重要规则：
- 你不是待办解析器，不要生成待办、日程或提醒。
- 只修正高概率语音识别错误、断句、重复、错序和标点；不要新增用户没说过的事实。
- 必须保留原文中的每个生活意图，不要为了通顺删掉半句话。
- 不要替用户消除真实语义歧义。例如“今天12点前睡觉”不能改成“今晚24:00前睡觉”，除非原始转写明确有“今晚/24点/零点”等信息。
- 如果修正后仍有关键歧义，transcript 放最佳修正版，needsUserConfirmation 设为 true，并给出一句用户能直接回答的问题。
- 如果只是时间语义本身需要产品追问，不代表转写失败。比如“今天12点前睡觉”本身可以 confidence 较高，但后续规划阶段仍会追问中午还是今晚。
- 如果 payload.validation.errors 存在，说明上一轮 JSON 没有通过本地完整性校验；必须修正 errors 指出的缺失，并重新输出完整 JSON。
- 输出必须是 JSON，不要 Markdown，不要解释。

输出 JSON：
{
  "transcript": "修正后的正式用户消息",
  "confidence": 0.0,
  "needsUserConfirmation": false,
  "question": "可选，只有关键内容不确定时填写",
  "repairs": [
    { "from": "原片段", "to": "修正片段", "reason": "简短原因" }
  ]
}
`.trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rawArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function localNowText(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "medium"
  }).format(new Date());
}

function normalizeTranscriptRepair(value: unknown, rawTranscript: string): TranscriptRepair | null {
  if (!isRecord(value)) return null;

  const transcript = optionalString(value.transcript);
  const confidenceValue = optionalNumber(value.confidence);
  if (!transcript || confidenceValue === undefined) return null;
  const needsUserConfirmation =
    typeof value.needsUserConfirmation === "boolean"
      ? value.needsUserConfirmation
      : typeof value.needs_user_confirmation === "boolean"
        ? value.needs_user_confirmation
        : undefined;
  if (needsUserConfirmation === undefined || !Array.isArray(value.repairs)) return null;

  const confidence = Math.max(0, Math.min(1, confidenceValue));
  const repairs = rawArray(value.repairs)
    .filter(isRecord)
    .map((repair) => ({
      from: optionalString(repair.from),
      to: optionalString(repair.to),
      reason: optionalString(repair.reason) ?? "语音转写校准"
    }))
    .slice(0, 12);

  return {
    rawTranscript,
    transcript,
    confidence,
    needsUserConfirmation,
    question: optionalString(value.question),
    repairs
  };
}

function validateTranscriptRepair(rawTranscript: string, repair: TranscriptRepair) {
  const errors: string[] = [];
  if (!repair.transcript.trim()) {
    errors.push("transcript 不能为空。");
  }
  if (repair.confidence < 0 || repair.confidence > 1) {
    errors.push("confidence 必须在 0 到 1 之间。");
  }
  if (repair.needsUserConfirmation && !repair.question?.trim()) {
    errors.push("needsUserConfirmation 为 true 时必须提供 question。");
  }
  if (rawTranscript.length >= 8 && repair.transcript.length < Math.max(4, rawTranscript.length * 0.35)) {
    errors.push("transcript 相比原始转写过短，可能丢失了用户意图。");
  }
  return errors;
}

export async function repairTranscriptWithAgentPlan({
  rawTranscript,
  model
}: {
  rawTranscript: string;
  model?: string;
}): Promise<TranscriptRepair> {
  if (!canUseAgentPlan()) {
    throw new Error("Agent Plan transcript repair runtime is not configured.");
  }

  const trimmed = rawTranscript.trim();
  if (!trimmed) {
    return {
      rawTranscript,
      transcript: "",
      confidence: 0,
      needsUserConfirmation: true,
      question: "我没有听清刚才的内容，可以再说一遍吗？",
      repairs: []
    };
  }

  return requestValidatedAgentPlanJson({
    model: resolveAgentPlanLanguageModel(model),
    systemPrompt: TRANSCRIPT_REPAIR_PROMPT,
    payload: {
      now: new Date().toISOString(),
      localNow: localNowText(runtimeTimezone()),
      timezone: runtimeTimezone(),
      rawTranscript: trimmed
    },
    temperature: 0,
    stageName: "Agent Plan transcript repair",
    normalize: (value) => normalizeTranscriptRepair(value, trimmed),
    validate: (repair) => validateTranscriptRepair(trimmed, repair)
  });
}
