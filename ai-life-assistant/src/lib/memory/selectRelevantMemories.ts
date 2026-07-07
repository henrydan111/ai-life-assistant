import type { AssistantState, MemoryContext, MemoryItem } from "@/types/domain";

const LIMITS = {
  maxItems: 8,
  maxCharsPerItem: 80,
  maxTotalChars: 600
};

const intentHints = [
  { pattern: /牛奶|购物|买|采购|下单|送到|快递/, tags: ["购物", "牛奶", "recurring", "重复", "购买"] },
  { pattern: /去|出差|旅行|出游|车票|机票|高铁|火车|行李|苏州|上海|杭州/, tags: ["出行", "票务", "行李", "高铁", "短途"] },
  { pattern: /孩子|兴趣班|课程|接送|上课|放学/, tags: ["孩子", "家庭", "兴趣班", "接送"] },
  { pattern: /天气|下雨|雨|伞|降温|高温|周末/, tags: ["天气", "雨", "出门", "风险"] },
  { pattern: /提醒|主动|记得|以后|每周|定期/, tags: ["提醒", "主动", "偏好", "recurring"] },
  { pattern: /请假|老板|报备|沟通/, tags: ["工作", "请假", "老板", "提醒"] }
];

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function includesAny(text: string, items: string[]) {
  return items.some((item) => item && text.includes(normalize(item)));
}

function relatedTags(rawText: string) {
  return intentHints.flatMap((hint) => (hint.pattern.test(rawText) ? hint.tags : []));
}

function memoryScore(memory: MemoryItem, rawText: string, tags: string[]) {
  const text = normalize(rawText);
  const summary = normalize(memory.summary);
  let score = 0;

  if (memory.status === "active") score += 2;
  if (memory.status === "suggested") score += 1.2;
  if (memory.sensitivity === "high" && !includesAny(text, memory.tags) && !includesAny(text, memory.entities)) return -1;
  if (includesAny(text, memory.entities)) score += 4;
  if (includesAny(text, memory.tags)) score += 3;
  if (tags.some((tag) => memory.tags.includes(tag))) score += 2;
  if (tags.some((tag) => summary.includes(normalize(tag)))) score += 1;

  score += Math.min(1.5, Math.max(0, memory.confidence) * 1.5);
  score += Math.min(1, memory.useCount * 0.1);

  const updatedAt = new Date(memory.updatedAt).getTime();
  if (Number.isFinite(updatedAt)) {
    const ageDays = Math.max(0, (Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
    score += Math.max(0, 1 - ageDays / 90);
  }

  return score;
}

function clip(text: string) {
  const trimmed = text.trim();
  return trimmed.length > LIMITS.maxCharsPerItem ? `${trimmed.slice(0, LIMITS.maxCharsPerItem - 1)}…` : trimmed;
}

function pushLimited(target: string[], item: string, total: { chars: number }) {
  const text = clip(item);
  if (!text) return;
  if (total.chars + text.length > LIMITS.maxTotalChars) return;
  target.push(text);
  total.chars += text.length;
}

export function selectRelevantMemoryItems(rawText: string, state: AssistantState) {
  const tags = relatedTags(rawText);
  return (state.memoryItems ?? [])
    .filter((memory) => memory.status === "active" || memory.status === "suggested")
    .map((memory) => ({ memory, score: memoryScore(memory, rawText, tags) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, LIMITS.maxItems)
    .map((item) => item.memory);
}

export function selectRelevantMemories(rawText: string, state: AssistantState): MemoryContext {
  const selected = selectRelevantMemoryItems(rawText, state);
  const total = { chars: 0 };
  const context: MemoryContext = {
    stableFacts: [],
    activePatterns: [],
    openLoops: [],
    assistantPreferences: []
  };

  selected.forEach((memory) => {
    if (memory.type === "open_loop") {
      pushLimited(context.openLoops, memory.summary, total);
      return;
    }

    if (memory.type === "assistant_behavior" || memory.type === "preference" || memory.type === "weather_preference") {
      pushLimited(context.assistantPreferences, memory.summary, total);
      return;
    }

    if (memory.type === "recurring_pattern" || memory.type === "travel_habit") {
      pushLimited(context.activePatterns, memory.summary, total);
      return;
    }

    pushLimited(context.stableFacts, memory.summary, total);
  });

  if (total.chars < LIMITS.maxTotalChars) {
    pushLimited(context.assistantPreferences, "重要长期提醒和 recurring 设置需要先询问用户确认。", total);
  }

  return context;
}
