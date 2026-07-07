export type SleepTimeResolution = {
  targetTime?: string;
  targetTimeRelation?: "before" | "at" | "after";
  ambiguity: "none" | "ampm" | "missing_time";
  evidence: "explicit_midnight" | "explicit_noon" | "explicit_evening" | "explicit_early_morning" | "numeric_only" | "none";
  sourceQuote?: string;
  question?: string;
};

const recurrencePattern = /(每天|每日|天天|每晚|daily|every day|every night)/i;
const sleepPattern = /(睡觉|睡|上床|休息)/;
const twelvePattern = /(12|十二)\s*点/;
const beforePattern = /前/;
const explicitEveningPattern = /(晚上|晚间|今晚|每晚)/;
const explicitEarlyMorningPattern = /(凌晨|清晨|夜里)/;
const explicitMorningPattern = /(上午|早上|早晨)/;
const explicitMidnightPattern =
  /(半夜|午夜|零点|零时|0点|0\s*:\s*00|24点|二十四点|晚上\s*(12|十二)\s*点|夜里\s*(12|十二)\s*点|晚间\s*(12|十二)\s*点|凌晨\s*(12|十二)\s*点|今晚\s*(12|十二)\s*点|每晚\s*(12|十二)\s*点)/;
const explicitNoonPattern =
  /((中午|正午|午间)\s*(12|十二)\s*点|(12|十二)\s*点\s*(中午|正午|午间))/;
const chineseDigits: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

export function rawHasRecurringSleepGoal(rawText: string) {
  return recurrencePattern.test(rawText) && sleepPattern.test(rawText);
}

function parseChineseHour(value: string) {
  if (value in chineseDigits) return chineseDigits[value];
  if (value === "十二") return 12;
  if (value === "十一") return 11;
  if (value === "十") return 10;
  if (value === "二十四") return 24;
  if (value.startsWith("十")) {
    return 10 + (chineseDigits[value.slice(1)] ?? 0);
  }
  if (value.startsWith("二十")) {
    return 20 + (value.endsWith("一") ? 1 : value.endsWith("二") ? 2 : value.endsWith("三") ? 3 : 0);
  }
  return Number(value);
}

function timeParts(rawText: string) {
  const colonMatch = rawText.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*前/);
  if (colonMatch) {
    return { rawHour: colonMatch[1], minute: Number(colonMatch[2]) };
  }

  const chineseMatch = rawText.match(/(\d{1,2}|[一二两三四五六七八九]?十[一二两三四五六七八九]?|[一二两三四五六七八九]|二十[一二三]?|二十四|十二)\s*点\s*(半|\d{1,2})?\s*前/);
  if (!chineseMatch) return undefined;
  const minute = chineseMatch[2] === "半" ? 30 : chineseMatch[2] ? Number(chineseMatch[2]) : 0;
  return { rawHour: chineseMatch[1], minute };
}

function timeString(hour: number, minute: number) {
  return `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function ambiguity(rawText: string, question: string): SleepTimeResolution {
  return {
    ambiguity: "ampm",
    evidence: "numeric_only",
    sourceQuote: rawText,
    question
  };
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

  const parsed = timeParts(rawText);
  if (!parsed) {
    return {
      ambiguity: "missing_time",
      evidence: "none",
      sourceQuote: rawText
    };
  }

  if (twelvePattern.test(rawText)) {
    return ambiguity(rawText, "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？");
  }

  const hour = parseChineseHour(parsed.rawHour);
  const minute = parsed.minute;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return {
      ambiguity: "missing_time",
      evidence: "none",
      sourceQuote: rawText
    };
  }

  if (explicitEarlyMorningPattern.test(rawText) && hour >= 0 && hour <= 11) {
    return {
      targetTime: timeString(hour, minute),
      targetTimeRelation: hasBefore ? "before" : undefined,
      ambiguity: "none",
      evidence: "explicit_early_morning",
      sourceQuote: rawText
    };
  }

  if (explicitEveningPattern.test(rawText) && hour >= 6 && hour <= 11) {
    return {
      targetTime: timeString(hour + 12, minute),
      targetTimeRelation: hasBefore ? "before" : undefined,
      ambiguity: "none",
      evidence: "explicit_evening",
      sourceQuote: rawText
    };
  }

  if (explicitEveningPattern.test(rawText) && hour >= 1 && hour <= 5) {
    return ambiguity(rawText, "你说的晚上这个时间，是指当天晚上，还是凌晨后的时间？");
  }

  if (explicitMorningPattern.test(rawText) && hour >= 1 && hour <= 11) {
    return {
      targetTime: timeString(hour, minute),
      targetTimeRelation: hasBefore ? "before" : undefined,
      ambiguity: "none",
      evidence: "numeric_only",
      sourceQuote: rawText
    };
  }

  if (sleepPattern.test(rawText) && hour >= 1 && hour <= 11) {
    return ambiguity(rawText, "你说的这个睡觉时间，是上午还是晚上？");
  }

  return {
    targetTime: timeString(hour, minute),
    targetTimeRelation: hasBefore ? "before" : undefined,
    ambiguity: "none",
    evidence: "numeric_only",
    sourceQuote: rawText
  };
}
