import { createId } from "@/lib/id";
import { nowIso } from "@/lib/time/parseTime";
import type { AssistantCheckIn, AssistantState, MemoryItem, MemoryWrite } from "@/types/domain";

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[，。,.!?！？]/g, " ");
}

function unique(items: string[] = []) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function similarMemory(left: MemoryItem, write: MemoryWrite) {
  if (left.type !== write.type) return false;
  const leftText = normalize([left.summary, ...left.tags, ...left.entities].join(" "));
  const rightText = normalize([write.summary, ...(write.tags ?? []), ...(write.entities ?? [])].join(" "));
  if (!leftText || !rightText) return false;
  if (leftText.includes(rightText) || rightText.includes(leftText)) return true;
  return unique(write.entities).some((entity) => left.entities.some((item) => normalize(item) === normalize(entity)));
}

function needsConfirmation(write: MemoryWrite) {
  if (write.requiresConfirmation) return true;
  return write.type === "recurring_pattern" || write.type === "travel_habit" || write.type === "weather_preference" || write.type === "assistant_behavior";
}

function initialStatus(write: MemoryWrite): MemoryItem["status"] {
  if (needsConfirmation(write)) return "suggested";
  if (write.sensitivity === "high") return "suggested";
  return clampConfidence(write.confidence) >= 0.85 ? "active" : "suggested";
}

function createConfirmation(memory: MemoryItem): AssistantCheckIn {
  const now = nowIso();
  return {
    id: createId("check"),
    title: "确认长期记忆",
    question: `要不要让我记住：${memory.summary}`,
    relatedType: "project",
    relatedId: memory.id,
    askAt: now,
    status: "pending",
    createdAt: now
  };
}

export function normalizeMemoryItems(items: MemoryItem[]) {
  const merged: MemoryItem[] = [];

  items.forEach((item) => {
    const cleaned: MemoryItem = {
      ...item,
      summary: item.summary.trim().slice(0, 100),
      tags: unique(item.tags),
      entities: unique(item.entities),
      confidence: clampConfidence(item.confidence),
      evidence: item.evidence.slice(0, 5),
      useCount: Math.max(0, item.useCount)
    };
    const existingIndex = merged.findIndex((memory) => similarMemory(memory, {
      type: cleaned.type,
      summary: cleaned.summary,
      tags: cleaned.tags,
      entities: cleaned.entities,
      confidence: cleaned.confidence,
      sensitivity: cleaned.sensitivity,
      evidence: cleaned.evidence[0]?.text ?? cleaned.summary
    }));

    if (existingIndex === -1) {
      merged.push(cleaned);
      return;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      summary: existing.summary.length >= cleaned.summary.length ? existing.summary : cleaned.summary,
      tags: unique([...existing.tags, ...cleaned.tags]),
      entities: unique([...existing.entities, ...cleaned.entities]),
      confidence: Math.max(existing.confidence, cleaned.confidence),
      status: existing.status === "active" || cleaned.status === "active" ? "active" : existing.status,
      evidence: [...cleaned.evidence, ...existing.evidence].slice(0, 5),
      updatedAt: cleaned.updatedAt > existing.updatedAt ? cleaned.updatedAt : existing.updatedAt
    };
  });

  return merged;
}

export function applyMemoryWrites(state: AssistantState, writes: MemoryWrite[] = [], sourceInputId?: string) {
  if (!writes.length) return { ...state, memoryItems: normalizeMemoryItems(state.memoryItems ?? []) };
  const now = nowIso();
  let memoryItems = [...(state.memoryItems ?? [])];
  const checkIns = [...state.checkIns];

  writes.forEach((write) => {
    const summary = write.summary.trim();
    const evidenceText = write.evidence.trim() || summary;
    if (!summary || !evidenceText) return;

    const rejected = memoryItems.some((memory) => memory.status === "rejected" && similarMemory(memory, write));
    if (rejected) return;

    const existingIndex = memoryItems.findIndex((memory) => memory.status !== "archived" && similarMemory(memory, write));
    if (existingIndex >= 0) {
      const existing = memoryItems[existingIndex];
      memoryItems[existingIndex] = {
        ...existing,
        summary: existing.summary.length >= summary.length ? existing.summary : summary,
        tags: unique([...existing.tags, ...(write.tags ?? [])]),
        entities: unique([...existing.entities, ...(write.entities ?? [])]),
        confidence: Math.max(existing.confidence, clampConfidence(write.confidence)),
        sensitivity: write.sensitivity ?? existing.sensitivity,
        status: existing.status === "active" ? "active" : initialStatus(write),
        evidence: [
          { text: evidenceText, inputId: sourceInputId, createdAt: now },
          ...existing.evidence
        ].slice(0, 5),
        updatedAt: now
      };
      const updated = memoryItems[existingIndex];
      const shouldAsk = updated.status === "suggested" && !checkIns.some((checkIn) => checkIn.relatedId === updated.id && checkIn.status === "pending");
      if (shouldAsk) checkIns.unshift(createConfirmation(updated));
      return;
    }

    const memory: MemoryItem = {
      id: createId("mem"),
      type: write.type,
      summary,
      tags: unique(write.tags ?? []),
      entities: unique(write.entities ?? []),
      confidence: clampConfidence(write.confidence),
      status: initialStatus(write),
      sensitivity: write.sensitivity ?? "low",
      evidence: [{ text: evidenceText, inputId: sourceInputId, createdAt: now }],
      useCount: 0,
      createdAt: now,
      updatedAt: now
    };

    memoryItems.unshift(memory);
    if (memory.status === "suggested") checkIns.unshift(createConfirmation(memory));
  });

  return {
    ...state,
    memoryItems: normalizeMemoryItems(memoryItems),
    checkIns
  };
}
