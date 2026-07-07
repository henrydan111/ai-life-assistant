"use client";

import { Check, Mic, Trash2 } from "lucide-react";
import type { AssistantItemRef } from "@/types/domain";

export function ItemActionButtons({
  target,
  onComplete,
  onDelete,
  onDiscuss,
  className
}: {
  target: AssistantItemRef;
  onComplete: (target: AssistantItemRef) => void;
  onDelete: (target: AssistantItemRef) => void;
  onDiscuss: (target: AssistantItemRef) => void;
  className?: string;
}) {
  const classNames = ["item-action-group", className].filter(Boolean).join(" ");

  return (
    <div className={classNames}>
      <button
        className="item-action-button complete"
        type="button"
        onClick={() => onComplete(target)}
        title="标记完成"
        aria-label={`标记完成：${target.title}`}
      >
        <Check size={17} aria-hidden="true" />
      </button>
      <button
        className="item-action-button delete"
        type="button"
        onClick={() => onDelete(target)}
        title="删除事项"
        aria-label={`删除事项：${target.title}`}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      <button
        className="item-action-button voice"
        type="button"
        onClick={() => onDiscuss(target)}
        title="语音更新"
        aria-label={`通过对话更新：${target.title}`}
      >
        <Mic size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
