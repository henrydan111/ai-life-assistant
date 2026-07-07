export type SleepTimeResolution = {
  targetTime?: string;
  targetTimeRelation?: "before" | "at" | "after";
  ambiguity: "none" | "ampm" | "missing_time";
  evidence: "explicit_midnight" | "explicit_noon" | "numeric_only" | "none";
  sourceQuote?: string;
  question?: string;
};

const recurrencePattern = /(每天|每日|天天|每晚|daily|every day|every night)/i;
const sleepPattern = /(睡觉|睡|上床|休息)/;
const twelvePattern = /(12|十二)\s*点/;
const beforePattern = /前/;
const explicitMidnightPattern =
  /(半夜|午夜|零点|零时|0点|0\s*:\s*00|24点|二十四点|晚上\s*(12|十二)\s*点|夜里\s*(12|十二)\s*点|凌晨\s*(12|十二)\s*点|今晚\s*(12|十二)\s*点|每晚\s*(12|十二)\s*点)/;
const explicitNoonPattern =
  /((中午|正午|午间)\s*(12|十二)\s*点|(12|十二)\s*点\s*(中午|正午|午间))/;

export function rawHasRecurringSleepGoal(rawText: string) {
  return recurrencePattern.test(rawText) && sleepPattern.test(rawText);
}

function parseChineseHour(value: string) {
  if (value === "十二") return 12;
  if (value === "十一") return 11;
  if (value === "十") return 10;
  if (value === "二十四") return 24;
  if (value.startsWith("二十")) {
    return 20 + (value.endsWith("一") ? 1 : value.endsWith("二") ? 2 : value.endsWith("三") ? 3 : 0);
  }
  return Number(value);
}

function hourText(rawText: string) {
  return rawText.match(/(\d{1,2}|十[一二]?|十二|二十[一二三]?|二十四)\s*点\s*前/)?.[1];
}

export function resolveRecurringSleepTarget(rawText: string): SleepTimeResolution {
  const hasBefore = beforePattern.test(rawText);

  if (explicitMidnightPattern.test(rawText)) {
    return {
      targetTime: "00:00",
      targetTimeRelation: hasBefore ? "before" : undefined,
      ambiguity: "none",
      evidence: "explicit_midnight",
      sourceQuote: rawText
    };
  }

  if (explicitNoonPattern.test(rawText)) {
    return {
      targetTime: "12:00",
      targetTimeRelation: hasBefore ? "before" : undefined,
      ambiguity: "none",
      evidence: "explicit_noon",
      sourceQuote: rawText
    };
  }

  const rawHour = hourText(rawText);
  if (!rawHour) {
    return {
      ambiguity: "missing_time",
      evidence: "none",
      sourceQuote: rawText
    };
  }

  if (twelvePattern.test(rawText)) {
    return {
      ambiguity: "ampm",
      evidence: "numeric_only",
      sourceQuote: rawText,
      question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？"
    };
  }

  const hour = parseChineseHour(rawHour);
  if (!Number.isFinite(hour)) {
    return {
      ambiguity: "missing_time",
      evidence: "none",
      sourceQuote: rawText
    };
  }

  return {
    targetTime: `${String(hour % 24).padStart(2, "0")}:00`,
    targetTimeRelation: hasBefore ? "before" : undefined,
    ambiguity: "none",
    evidence: "numeric_only",
    sourceQuote: rawText
  };
}

