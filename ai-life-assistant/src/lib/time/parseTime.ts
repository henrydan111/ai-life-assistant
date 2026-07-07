const weekdayIndex: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  周日: 0,
  周天: 0,
  星期日: 0,
  星期天: 0,
  周一: 1,
  星期一: 1,
  周二: 2,
  星期二: 2,
  周三: 3,
  星期三: 3,
  周四: 4,
  星期四: 4,
  周五: 5,
  星期五: 5,
  周六: 6,
  星期六: 6
};

const chineseWeekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const chineseWeekdayPattern = /周[一二三四五六日天]|星期[一二三四五六日天]/g;
const englishWeekdayPattern = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;

export const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function resolveTimezone(timezone?: string) {
  return timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatTime(iso?: string, timezone?: string) {
  if (!iso) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveTimezone(timezone),
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function formatShortDate(iso?: string, timezone?: string) {
  if (!iso) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolveTimezone(timezone),
    month: "short",
    day: "numeric"
  }).format(new Date(iso));
}

function localDateKey(date: Date, timezone?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function isSameLocalDay(a: Date, b: Date, timezone?: string) {
  return localDateKey(a, timezone) === localDateKey(b, timezone);
}

export function startOfLocalDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function nextWeekday(base: Date, target: number) {
  const current = base.getDay();
  let delta = target - current;
  if (delta <= 0) delta += 7;
  return addDays(base, delta);
}

export function parseDueDate(text: string, baseDate = new Date()) {
  const lower = text.toLowerCase();
  const due = new Date(baseDate);

  if (/tomorrow|明天/.test(lower)) {
    due.setDate(due.getDate() + 1);
  }

  const weekdayEntry = Object.entries(weekdayIndex).find(([label]) => lower.includes(label));
  if (weekdayEntry) {
    const [, target] = weekdayEntry;
    const next = nextWeekday(baseDate, target);
    due.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
  }

  const englishTime = lower.match(/\b(?:by\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const chineseTime = text.match(/(上午|早上|下午|晚上|今晚)?\s*(\d{1,2})\s*[点:：]\s*(\d{1,2})?/);
  const looseBy = lower.match(/\bby\s+(\d{1,2})\b/);

  if (/(睡觉|睡|上床|休息)/.test(text) && /(12|十二|0|零)\s*[点:：]\s*前/.test(text)) {
    due.setHours(23, 59, 0, 0);
    return due.toISOString();
  }

  if (englishTime) {
    let hour = Number(englishTime[1]);
    const minute = englishTime[2] ? Number(englishTime[2]) : 0;
    const meridiem = englishTime[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    due.setHours(hour, minute, 0, 0);
    return due.toISOString();
  }

  if (chineseTime) {
    const period = chineseTime[1] ?? "";
    let hour = Number(chineseTime[2]);
    const minute = chineseTime[3] ? Number(chineseTime[3]) : 0;
    if ((period.includes("下午") || period.includes("晚上") || period.includes("今晚")) && hour < 12) {
      hour += 12;
    }
    due.setHours(hour, minute, 0, 0);
    return due.toISOString();
  }

  if (looseBy) {
    let hour = Number(looseBy[1]);
    if (hour > 0 && hour < 8) hour += 12;
    due.setHours(hour, 0, 0, 0);
    return due.toISOString();
  }

  if (/tonight|今晚|晚上/.test(lower)) {
    due.setHours(20, 0, 0, 0);
    return due.toISOString();
  }

  if (/today|今天/.test(lower)) {
    due.setHours(17, 0, 0, 0);
    return due.toISOString();
  }

  if (/tomorrow|明天/.test(lower) || weekdayEntry) {
    due.setHours(9, 0, 0, 0);
    return due.toISOString();
  }

  return undefined;
}

function weekdayTargets(text: string) {
  const lower = text.toLowerCase();
  const labels = [...text.matchAll(chineseWeekdayPattern)].map((match) => match[0]);
  const englishLabels = [...lower.matchAll(englishWeekdayPattern)].map((match) => match[0]);
  const targets = [...labels, ...englishLabels]
    .map((label) => weekdayIndex[label])
    .filter((item): item is number => typeof item === "number");
  return Array.from(new Set(targets));
}

export function parseDueDates(text: string, baseDate = new Date()) {
  const targets = weekdayTargets(text);
  if (targets.length <= 1) {
    const dueAt = parseDueDate(text, baseDate);
    return dueAt ? [dueAt] : [];
  }

  const withoutWeekdays = text.replace(chineseWeekdayPattern, "").replace(englishWeekdayPattern, "");
  return targets
    .map((target) => parseDueDate(`${chineseWeekdayLabels[target]} ${withoutWeekdays}`, baseDate))
    .filter((item): item is string => Boolean(item));
}

export function dayBeforeAt(iso: string, hour: number) {
  const date = new Date(iso);
  date.setDate(date.getDate() - 1);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}
