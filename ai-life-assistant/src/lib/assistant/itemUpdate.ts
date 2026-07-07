import { createId } from "@/lib/id";
import { addDays, isSameLocalDay, nowIso } from "@/lib/time/parseTime";
import type { AssistantCheckIn, AssistantItemRef, AssistantState, ParseFeedback, Task } from "@/types/domain";

type RelatedCheckInUpdate = {
  create?: boolean;
  id?: string;
  matchText?: string;
  title?: string;
  question?: string;
  askAt?: string;
  status?: AssistantCheckIn["status"];
};

export type ItemUpdatePlan = {
  title?: string;
  dueAt?: string;
  completed?: boolean;
  deleted?: boolean;
  relatedCheckIns?: RelatedCheckInUpdate[];
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

function optionalCheckInStatus(value: unknown): AssistantCheckIn["status"] | undefined {
  return value === "pending" || value === "answered" || value === "dismissed" ? value : undefined;
}

function normalizeRelatedCheckInUpdate(value: unknown): RelatedCheckInUpdate | undefined {
  if (!isRecord(value)) return undefined;
  const update: RelatedCheckInUpdate = {
    create: optionalBoolean(value.create),
    id: optionalString(value.id),
    matchText: optionalString(value.matchText),
    title: optionalString(value.title),
    question: optionalString(value.question),
    askAt: optionalString(value.askAt),
    status: optionalCheckInStatus(value.status)
  };
  return update.id || update.matchText || (update.create && (update.title || update.question)) ? update : undefined;
}

function normalizeRelatedCheckIns(value: unknown) {
  return Array.isArray(value)
    ? value.map(normalizeRelatedCheckInUpdate).filter((item): item is RelatedCheckInUpdate => Boolean(item))
    : [];
}

function horizonForDueAt(dueAt?: string): Task["horizon"] | undefined {
  if (!dueAt) return undefined;
  const dueDate = new Date(dueAt);
  const today = new Date();
  if (isSameLocalDay(dueDate, today)) return "today";
  if (dueDate < addDays(today, 7)) return "this_week";
  return "later";
}

function checkInMatchesUpdate(checkIn: AssistantCheckIn, update: RelatedCheckInUpdate) {
  if (update.id && checkIn.id === update.id) return true;
  if (!update.matchText) return false;
  return `${checkIn.title} ${checkIn.question}`.includes(update.matchText);
}

function relatedAnchorForTarget(target: AssistantItemRef, checkIns: AssistantCheckIn[]) {
  if (target.kind === "life_event") return { relatedType: "life_event" as const, relatedId: target.id };
  if (target.kind === "shopping_item") return { relatedType: "shopping_item" as const, relatedId: target.id };
  if (target.kind === "task") return { relatedType: "task" as const, relatedId: target.id };
  if (target.kind === "check_in") {
    const checkIn = checkIns.find((item) => item.id === target.id);
    return checkIn ? { relatedType: checkIn.relatedType, relatedId: checkIn.relatedId } : undefined;
  }
  return undefined;
}

const travelPrepPatterns = [
  /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返/,
  /行李|收拾/,
  /餐馆|餐厅|饭店|餐位|订位|定位置|订位置|定座|订座|定座位|订座位/
];

function travelPrepMatchCount(text: string) {
  return travelPrepPatterns.filter((pattern) => pattern.test(text)).length;
}

function checkInBelongsToAnchor(
  checkIn: AssistantCheckIn,
  anchor: NonNullable<ReturnType<typeof relatedAnchorForTarget>>
) {
  return checkIn.relatedType === anchor.relatedType && checkIn.relatedId === anchor.relatedId;
}

function applyRelatedCheckInUpdates(
  checkIns: AssistantCheckIn[],
  updates: RelatedCheckInUpdate[],
  target: AssistantItemRef
) {
  if (!updates.length) return checkIns;
  const anchor = relatedAnchorForTarget(target, checkIns);
  const createdUpdates = updates.filter(
    (update): update is RelatedCheckInUpdate & Required<Pick<RelatedCheckInUpdate, "title" | "question" | "askAt">> =>
      Boolean(update.create && update.title && update.question && update.askAt)
  );
  const createdTravelPrepCount = createdUpdates.reduce(
    (count, update) => count + travelPrepMatchCount(`${update.title} ${update.question}`),
    0
  );

  const updated = checkIns.map((checkIn) => {
    const update = updates.find((item) => checkInMatchesUpdate(checkIn, item));
    if (!update) {
      if (
        anchor &&
        createdTravelPrepCount > 1 &&
        checkIn.status === "pending" &&
        checkInBelongsToAnchor(checkIn, anchor) &&
        travelPrepMatchCount(`${checkIn.title} ${checkIn.question}`) > 1
      ) {
        return { ...checkIn, status: "dismissed" as const };
      }
      return checkIn;
    }
    return {
      ...checkIn,
      title: update.title ?? checkIn.title,
      question: update.question ?? checkIn.question,
      askAt: update.askAt ?? checkIn.askAt,
      status: update.status ?? checkIn.status
    };
  });

  const created = anchor
    ? createdUpdates
        .map((update) => ({
          id: createId("check"),
          title: update.title,
          question: update.question,
          relatedType: anchor.relatedType,
          relatedId: anchor.relatedId,
          askAt: update.askAt,
          status: update.status ?? ("pending" as const),
          createdAt: nowIso()
        }))
    : [];

  return created.length ? [...created, ...updated] : updated;
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
    relatedCheckIns: normalizeRelatedCheckIns(value.relatedCheckIns ?? value.related_check_ins),
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
  const relatedCheckIns = plan.relatedCheckIns ?? [];
  const changes: string[] = [];

  if (nextTitle) changes.push("更新标题");
  if (nextTime) changes.push("更新时间");
  if (shouldComplete) changes.push("标记完成");
  if (shouldDelete) changes.push("删除事项");
  if (relatedCheckIns.length) changes.push("更新关联提醒");

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

  const finalState = {
    ...updated,
    checkIns: applyRelatedCheckInUpdates(updated.checkIns, relatedCheckIns, target)
  };

  return {
    state: finalState,
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
