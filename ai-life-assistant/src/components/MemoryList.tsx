"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import type { MemoryItem } from "@/types/domain";

function statusText(memory: MemoryItem) {
  if (memory.status === "suggested") return "待确认";
  if (memory.status === "active") return "已记住";
  if (memory.status === "rejected") return "不再记";
  return "已归档";
}

function typeText(memory: MemoryItem) {
  const labels: Record<MemoryItem["type"], string> = {
    household: "家庭",
    preference: "偏好",
    recurring_pattern: "重复事项",
    travel_habit: "出行",
    weather_preference: "天气",
    assistant_behavior: "助手偏好",
    open_loop: "待跟进"
  };
  return labels[memory.type];
}

export function MemoryList({
  memories,
  emptyText,
  compact,
  onConfirmMemory,
  onForgetMemory,
  onUpdateMemorySummary
}: {
  memories: MemoryItem[];
  emptyText: string;
  compact?: boolean;
  onConfirmMemory: (memoryId: string) => void;
  onForgetMemory: (memoryId: string) => void;
  onUpdateMemorySummary: (memoryId: string, summary: string) => void;
}) {
  function editMemory(memory: MemoryItem) {
    const next = window.prompt("修改这条记忆", memory.summary);
    if (next?.trim()) onUpdateMemorySummary(memory.id, next);
  }

  if (!memories.length) return <p className="state-line">{emptyText}</p>;

  return (
    <ul className={compact ? "memory-list compact" : "memory-list"}>
      {memories.map((memory) => (
        <li className="memory-item" key={memory.id}>
          <div className="memory-main">
            <p>{memory.summary}</p>
            <small>
              {typeText(memory)} · {statusText(memory)}
              {memory.confidence ? ` · ${Math.round(memory.confidence * 100)}%` : ""}
            </small>
          </div>
          <div className="memory-actions">
            {memory.status === "suggested" ? (
              <button className="icon-button primary compact" type="button" onClick={() => onConfirmMemory(memory.id)} title="确认记住" aria-label={`确认记住：${memory.summary}`}>
                <Check size={15} aria-hidden="true" />
              </button>
            ) : null}
            <button className="icon-button compact" type="button" onClick={() => editMemory(memory)} title="修改记忆" aria-label={`修改记忆：${memory.summary}`}>
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button className="icon-button compact" type="button" onClick={() => onForgetMemory(memory.id)} title="不要记住" aria-label={`不要记住：${memory.summary}`}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

