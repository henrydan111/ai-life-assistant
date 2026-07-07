"use client";

import { Check, Mic, RotateCcw, Trash2 } from "lucide-react";
import type { AssistantItemRef } from "@/types/domain";

export function ItemActionButtons({
  target,
  onComplete,
  onDelete,
  onDiscuss,
  onRevert,
  className,
  showComplete = true,
  showRevert = false,
  showDiscuss = true
}: {
  target: AssistantItemRef;
  onComplete: (target: AssistantItemRef) => void;
  onDelete: (target: AssistantItemRef) => void;
  onDiscuss: (target: AssistantItemRef) => void;
  onRevert?: (target: AssistantItemRef) => void;
  className?: string;
  showComplete?: boolean;
  showRevert?: boolean;
  showDiscuss?: boolean;
}) {
  const classNames = ["item-action-group", className].filter(Boolean).join(" ");

  return (
    <div className={classNames}>
      {showComplete ? (
        <button
          className="item-action-button complete"
          type="button"
          onClick={() => onComplete(target)}
          title="标记完成"
          aria-label={`标记完成：${target.title}`}
        >
          <Check size={17} aria-hidden="true" />
        </button>
      ) : null}
      {showRevert && onRevert ? (
        <button
          className="item-action-button revert"
          type="button"
          onClick={() => onRevert(target)}
          title="撤回完成"
          aria-label={`撤回完成：${target.title}`}
        >
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button
        className="item-action-button delete"
        type="button"
        onClick={() => onDelete(target)}
        title="删除事项"
        aria-label={`删除事项：${target.title}`}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      {showDiscuss ? (
        <button
          className="item-action-button voice"
          type="button"
          onClick={() => onDiscuss(target)}
          title="语音更新"
          aria-label={`通过对话更新：${target.title}`}
        >
          <Mic size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
