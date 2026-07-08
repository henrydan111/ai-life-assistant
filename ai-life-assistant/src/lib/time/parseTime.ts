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

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(date: Date, timezone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function calendarDateParts(parts: ZonedDateTimeParts, dayDelta = 0) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayDelta));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function nextWeekdayParts(parts: ZonedDateTimeParts, target: number) {
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  let delta = target - current;
  if (delta <= 0) delta += 7;
  return calendarDateParts(parts, delta);
}

function zonedWallTimeToIso(
  dateParts: Pick<ZonedDateTimeParts, "year" | "month" | "day">,
  hour: number,
  minute: number,
  timezone: string
) {
  const targetUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, 0);
  let guess = targetUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(new Date(guess), timezone);
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const delta = targetUtc - observedUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

function parseDueDateInTimezone(text: string, baseDate: Date, timezone: string) {
  const lower = text.toLowerCase();
  const baseParts = zonedParts(baseDate, timezone);
  let dateParts = calendarDateParts(baseParts);

  if (/tomorrow|明天/.test(lower)) {
    dateParts = calendarDateParts(baseParts, 1);
  }

  const weekdayEntry = Object.entries(weekdayIndex).find(([label]) => lower.includes(label));
  if (weekdayEntry) {
    const [, target] = weekdayEntry;
    dateParts = nextWeekdayParts(baseParts, target);
  }

  const englishTime = lower.match(/\b(?:by\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const chineseTime = text.match(/(上午|早上|下午|晚上|今晚)?\s*(\d{1,2})\s*[点:：]\s*(\d{1,2})?/);
  const looseBy = lower.match(/\bby\s+(\d{1,2})\b/);
  const asIso = (hour: number, minute = 0) => zonedWallTimeToIso(dateParts, hour, minute, timezone);

  if (/(睡觉|睡|上床|休息)/.test(text) && /(12|十二|0|零)\s*[点:：]\s*前/.test(text)) {
    return asIso(23, 59);
  }

  if (englishTime) {
    let hour = Number(englishTime[1]);
    const minute = englishTime[2] ? Number(englishTime[2]) : 0;
    const meridiem = englishTime[3];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return asIso(hour, minute);
  }

  if (chineseTime) {
    const period = chineseTime[1] ?? "";
    let hour = Number(chineseTime[2]);
    const minute = chineseTime[3] ? Number(chineseTime[3]) : 0;
    if ((period.includes("下午") || period.includes("晚上") || period.includes("今晚")) && hour < 12) {
      hour += 12;
    }
    return asIso(hour, minute);
  }

  if (looseBy) {
    let hour = Number(looseBy[1]);
    if (hour > 0 && hour < 8) hour += 12;
    return asIso(hour);
  }

  if (/tonight|今晚|晚上/.test(lower)) {
    return asIso(20);
  }

  if (/today|今天/.test(lower)) {
    return asIso(17);
  }

  if (/tomorrow|明天/.test(lower) || weekdayEntry) {
    return asIso(9);
  }

  return undefined;
}

export function parseDueDate(text: string, baseDate = new Date(), timezone = DEFAULT_TIMEZONE) {
  return parseDueDateInTimezone(text, baseDate, timezone);
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

export function parseDueDates(text: string, baseDate = new Date(), timezone = DEFAULT_TIMEZONE) {
  const targets = weekdayTargets(text);
  if (targets.length <= 1) {
    const dueAt = parseDueDate(text, baseDate, timezone);
    return dueAt ? [dueAt] : [];
  }

  const withoutWeekdays = text.replace(chineseWeekdayPattern, "").replace(englishWeekdayPattern, "");
  return targets
    .map((target) => parseDueDate(`${chineseWeekdayLabels[target]} ${withoutWeekdays}`, baseDate, timezone))
    .filter((item): item is string => Boolean(item));
}

export function dayBeforeAt(iso: string, hour: number) {
  const date = new Date(iso);
  date.setDate(date.getDate() - 1);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}
