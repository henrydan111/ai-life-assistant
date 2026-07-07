import { createId } from "@/lib/id";
import { addDays, isSameLocalDay, nowIso } from "@/lib/time/parseTime";
import type { AssistantItemRef, AssistantState, ParseFeedback, Task } from "@/types/domain";

export type ItemUpdatePlan = {
  title?: string;
  dueAt?: string;
  completed?: boolean;
  deleted?: boolean;
  feedback?: ParseFeedback;
};

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function horizonForDueAt(dueAt?: string): Task["horizon"] | undefined {
  if (!dueAt) return undefined;
  const dueDate = new Date(dueAt);
  const today = new Date();
  if (isSameLocalDay(dueDate, today)) return "today";
  if (dueDate < addDays(today, 7)) return "this_week";
  return "later";
}

export function normalizeItemUpdatePlan(value: unknown): ItemUpdatePlan | null {
  if (!isRecord(value)) return null;
  const feedback = isRecord(value.feedback) ? value.feedback : undefined;
  const feedbackTitle = feedback ? optionalString(feedback.title) : undefined;
  const feedbackDetail = feedback ? optionalString(feedback.detail) : undefined;
  return {
    title: optionalString(value.title),
    dueAt: optionalString(value.dueAt),
    completed: optionalBoolean(value.completed),
    deleted: optionalBoolean(value.deleted),
    feedback:
      feedbackTitle && feedbackDetail
        ? {
            title: feedbackTitle,
            detail: feedbackDetail,
            question: optionalString(feedback?.question)
          }
        : undefined
  };
}

export function applyItemUpdatePlan(
  state: AssistantState,
  target: AssistantItemRef,
  rawText: string,
  inputType: "text" | "voice",
  plan: ItemUpdatePlan
) {
  const text = rawText.trim();
  if (!text) {
    return {
      state,
      feedback: { title: "没有更新", detail: "说出或输入你想怎么改这条事项。" }
    };
  }

  const now = nowIso();
  const nextTitle = plan.title?.trim();
  const nextTime = plan.dueAt;
  const shouldComplete = Boolean(plan.completed);
  const shouldDelete = Boolean(plan.deleted);
  const changes: string[] = [];

  if (nextTitle) changes.push("更新标题");
  if (nextTime) changes.push("更新时间");
  if (shouldComplete) changes.push("标记完成");
  if (shouldDelete) changes.push("删除事项");

  const next: AssistantState = {
    ...state,
    inputs: [
      {
        id: createId("input"),
        rawText: `更新「${target.title}」：${text}`,
        inputType,
        parsedSummary: plan.feedback?.title ?? (changes.length ? "Updated item" : "Saved item note"),
        createdAt: now
      },
      ...state.inputs
    ].slice(0, 60)
  };

  let updated: AssistantState;
  if (target.kind === "task") {
    const horizon = horizonForDueAt(nextTime);
    updated = {
      ...next,
      tasks: next.tasks.map((task) =>
        task.id === target.id
          ? {
              ...task,
              title: nextTitle ?? task.title,
              dueAt: nextTime ?? task.dueAt,
              horizon: horizon ?? task.horizon,
              status: shouldDelete ? "cancelled" : shouldComplete ? "done" : task.status,
              updatedAt: now
            }
          : task
      )
    };
  } else if (target.kind === "life_event") {
    updated = {
      ...next,
      lifeEvents: next.lifeEvents.map((event) =>
        event.id === target.id
          ? {
              ...event,
              title: nextTitle ?? event.title,
              startsAt: nextTime ?? event.startsAt,
              status: shouldDelete ? "cancelled" : shouldComplete ? "done" : event.status,
              updatedAt: now
            }
          : event
      )
    };
  } else if (target.kind === "shopping_item") {
    updated = {
      ...next,
      shoppingItems: next.shoppingItems.map((item) =>
        item.id === target.id
          ? {
              ...item,
              itemName: nextTitle ?? item.itemName,
              expectedAt: nextTime ?? item.expectedAt,
              status: shouldDelete ? "removed" : shouldComplete ? "bought" : item.status,
              updatedAt: now
            }
          : item
      )
    };
  } else {
    updated = {
      ...next,
      checkIns: next.checkIns.map((checkIn) =>
        checkIn.id === target.id
          ? {
              ...checkIn,
              question: nextTitle ?? checkIn.question,
              askAt: nextTime ?? checkIn.askAt,
              status: shouldDelete ? "dismissed" : shouldComplete ? "answered" : checkIn.status
            }
          : checkIn
      )
    };
  }

  return {
    state: updated,
    feedback:
      plan.feedback ??
      (changes.length
        ? { title: "已更新", detail: `我已经${changes.join("、")}。` }
        : {
            title: "已记录",
            detail: "这次补充已经关联到该事项。你可以继续说“改到周五”“改成……”或“标记完成”。"
          })
  };
}
