import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { createId } from "@/lib/id";
import { applyMemoryWrites } from "@/lib/memory/applyMemoryWrites";
import { isSameLocalDay, nowIso } from "@/lib/time/parseTime";
import type { AssistantCheckIn, AssistantState, ParseFeedback, RecurrenceCandidate, ShoppingItem, Task, TranscriptRepair } from "@/types/domain";

export type InterpretResult = {
  state: AssistantState;
  feedback: ParseFeedback;
};

export type ApplyInterpretationOptions = {
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
};

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[，。,.!?！？]/g, " ");
}

function similar(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  return a.includes(b) || b.includes(a);
}

function titleCase(text: string) {
  if (/[\u4e00-\u9fa5]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shoppingTaskTitle(itemName: string) {
  return /[\u4e00-\u9fa5]/.test(itemName) ? `买${itemName}` : `Buy ${itemName}`;
}

function sameDueWindow(left?: string, right?: string) {
  if (!left || !right) return true;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return left === right;
  return isSameLocalDay(leftDate, rightDate);
}

function findOpenTask(tasks: Task[], title: string, dueAt?: string) {
  return tasks.find(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      similar(task.title, title) &&
      sameDueWindow(task.dueAt, dueAt)
  );
}

function shouldCloseShoppingTask(task: Task, itemName: string) {
  if (task.status === "done" || task.status === "cancelled") return false;
  return (
    similar(task.title, itemName) &&
    (similar(task.title, shoppingTaskTitle(itemName)) || /\b(buy|get|pick up|order)\b|买|采购|下单/.test(normalize(task.title)))
  );
}

function closeShoppingTasks(tasks: Task[], itemName: string, status: ShoppingItem["status"]) {
  if (status === "needed") return tasks;
  const closedStatus: Task["status"] = status === "removed" ? "cancelled" : "done";
  const now = nowIso();
  return tasks.map((task) =>
    shouldCloseShoppingTask(task, itemName)
      ? {
          ...task,
          status: closedStatus,
          updatedAt: now
        }
      : task
  );
}

function findSimilarLifeEvent(
  state: AssistantState,
  action: Extract<InterpretAction, { type: "add_life_event" }>
) {
  return state.lifeEvents.find((event) => {
    if (event.status === "cancelled") return false;
    const sameTitleOrPlace = similar(event.title, action.title) || Boolean(action.location && event.location && similar(event.location, action.location));
    if (!sameTitleOrPlace) return false;
    if (!event.startsAt || !action.startsAt) return true;
    return isSameLocalDay(new Date(event.startsAt), new Date(action.startsAt));
  });
}

function findSimilarCheckIn(
  checkIns: AssistantCheckIn[],
  title: string,
  question: string,
  relatedType: AssistantCheckIn["relatedType"],
  relatedId: string
) {
  return checkIns.find(
    (checkIn) =>
      checkIn.status !== "dismissed" &&
      checkIn.relatedType === relatedType &&
      checkIn.relatedId === relatedId &&
      (similar(checkIn.question, question) || similar(checkIn.title, title))
  );
}

function upsertRecurrence(candidates: RecurrenceCandidate[], normalizedTitle: string, relatedType: RecurrenceCandidate["relatedType"]) {
  const now = nowIso();
  const existing = candidates.find((candidate) => candidate.normalizedTitle === normalizedTitle);
  if (!existing) {
    return [
      ...candidates,
      {
        id: createId("repeat"),
        normalizedTitle,
        relatedType,
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        status: "watching" as const
      }
    ];
  }

  return candidates.map((candidate) =>
    candidate.id === existing.id
      ? {
          ...candidate,
          seenCount: candidate.seenCount + 1,
          lastSeenAt: now,
          suggestedRule: candidate.seenCount + 1 >= 2 ? "weekly" : candidate.suggestedRule,
          status: candidate.seenCount + 1 >= 2 ? ("suggested" as const) : candidate.status
        }
      : candidate
  );
}

function recurrencePrompt(
  candidates: RecurrenceCandidate[],
  itemName: string,
  relatedId: string,
  existingPrompts: AssistantCheckIn[]
) {
  const candidate = candidates.find((item) => item.normalizedTitle === normalize(itemName));
  const alreadyAsked = existingPrompts.some((prompt) => prompt.relatedId === relatedId && prompt.title.includes("Recurring"));
  if (!candidate || candidate.seenCount < 2 || alreadyAsked) return undefined;

  return {
    id: createId("check"),
    title: "Recurring suggestion",
    question: `看起来你经常需要买 ${itemName}。要把它设成每周提醒吗？`,
    relatedType: "shopping_item" as const,
    relatedId,
    askAt: nowIso(),
    status: "pending" as const,
    createdAt: nowIso()
  };
}

function createTaskFromAction(action: Extract<InterpretAction, { type: "add_task" }>, sourceInputId: string): Task {
  const now = nowIso();
  return {
    id: createId("task"),
    title: titleCase(action.title),
    description: action.description,
    type: action.taskType ?? "task",
    horizon: action.horizon ?? (action.dueAt ? "today" : "later"),
    dueAt: action.dueAt,
    estimatedMinutes: action.estimatedMinutes,
    energyRequired: action.energyRequired ?? "medium",
    priority: action.priority ?? "medium",
    status: "todo",
    sourceInputId,
    confidence: 0.82,
    createdAt: now,
    updatedAt: now
  };
}

function createShoppingTask(itemName: string, sourceInputId: string, dueAt?: string): Task {
  const now = nowIso();
  return {
    id: createId("task"),
    title: titleCase(shoppingTaskTitle(itemName)),
    type: "task",
    horizon: "today",
    dueAt,
    energyRequired: "low",
    priority: "medium",
    status: "todo",
    sourceInputId,
    confidence: 0.86,
    createdAt: now,
    updatedAt: now
  };
}

function addShoppingItem(
  state: AssistantState,
  action: Extract<InterpretAction, { type: "add_shopping_item" }>,
  sourceInputId: string,
  refs: Record<string, string>
) {
  const now = nowIso();
  const existing = state.shoppingItems.find((item) => similar(item.itemName, action.itemName) && item.status !== "removed");
  const itemId = existing?.id ?? createId("shop");
  const nextStatus = action.status ?? (existing?.status === "bought" ? "needed" : existing?.status ?? "needed");
  const newItem: ShoppingItem | undefined = existing
    ? undefined
    : {
        id: itemId,
        itemName: action.itemName,
        quantity: action.quantity,
        status: nextStatus,
        expectedAt: action.expectedAt,
        category: action.category ?? "household",
        createdAt: now,
        updatedAt: now
      };

  if (action.ref) refs[action.ref] = itemId;

  const recurrenceCandidates = upsertRecurrence(state.recurrenceCandidates, normalize(action.itemName), "shopping_item");
  const prompt = recurrencePrompt(recurrenceCandidates, action.itemName, itemId, state.checkIns);
  const taskTitle = shoppingTaskTitle(action.itemName);
  const shouldCreateTask = action.createTask !== false && nextStatus === "needed" && !findOpenTask(state.tasks, taskTitle, action.dueAt);
  const shoppingItems = existing
    ? state.shoppingItems.map((item) =>
        item.id === existing.id
          ? {
              ...item,
              quantity: action.quantity ?? item.quantity,
              status: nextStatus,
              expectedAt: action.expectedAt ?? item.expectedAt,
              category: action.category ?? item.category,
              updatedAt: now
            }
          : item
      )
    : [newItem!, ...state.shoppingItems];

  return {
    ...state,
    shoppingItems,
    tasks: shouldCreateTask ? [createShoppingTask(action.itemName, sourceInputId, action.dueAt), ...state.tasks] : state.tasks,
    checkIns: prompt ? [prompt, ...state.checkIns] : state.checkIns,
    recurrenceCandidates
  };
}

function updateShoppingStatus(state: AssistantState, action: Extract<InterpretAction, { type: "update_shopping_status" }>) {
  const now = nowIso();
  const hasExisting = state.shoppingItems.some((item) => similar(item.itemName, action.itemName));
  const tasks = closeShoppingTasks(state.tasks, action.itemName, action.status);
  const updated = state.shoppingItems.map((item) =>
    similar(item.itemName, action.itemName)
      ? {
          ...item,
          status: action.status,
          expectedAt: action.expectedAt ?? item.expectedAt,
          updatedAt: now
        }
      : item
  );

  if (hasExisting) return { ...state, shoppingItems: updated, tasks };

  return {
    ...state,
    tasks,
    shoppingItems: [
      {
        id: createId("shop"),
        itemName: action.itemName,
        status: action.status,
        expectedAt: action.expectedAt,
        category: "household",
        createdAt: now,
        updatedAt: now
      },
      ...state.shoppingItems
    ]
  };
}

export function applyInterpretation(
  rawText: string,
  inputType: "text" | "voice",
  state: AssistantState,
  interpretation: AiInterpretation,
  options: ApplyInterpretationOptions = {}
): InterpretResult {
  const now = nowIso();
  const inputId = createId("input");
  const refs: Record<string, string> = {};
  let next: AssistantState = {
    ...state,
    inputs: [
      {
        id: inputId,
        rawText,
        originalText: options.originalText && options.originalText !== rawText ? options.originalText : undefined,
        transcriptRepair: options.transcriptRepair
          ? {
              confidence: options.transcriptRepair.confidence,
              needsUserConfirmation: options.transcriptRepair.needsUserConfirmation,
              question: options.transcriptRepair.question,
              repairs: options.transcriptRepair.repairs
            }
          : undefined,
        inputType,
        parsedSummary: interpretation.feedback.title,
        createdAt: now
      },
      ...state.inputs
    ].slice(0, 60)
  };

  interpretation.actions.forEach((action) => {
    if (action.type === "add_task") {
      const existing = findOpenTask(next.tasks, action.title, action.dueAt);
      if (existing) {
        if (action.ref) refs[action.ref] = existing.id;
        return;
      }
      const task = createTaskFromAction(action, inputId);
      if (action.ref) refs[action.ref] = task.id;
      next = { ...next, tasks: [task, ...next.tasks] };
      return;
    }

    if (action.type === "mark_task_done") {
      next = {
        ...next,
        tasks: next.tasks.map((task) =>
          similar(task.title, action.matchTitle) ? { ...task, status: "done", updatedAt: nowIso() } : task
        )
      };
      return;
    }

    if (action.type === "add_shopping_item") {
      next = addShoppingItem(next, action, inputId, refs);
      return;
    }

    if (action.type === "update_shopping_status") {
      next = updateShoppingStatus(next, action);
      return;
    }

    if (action.type === "add_life_event") {
      const existing = findSimilarLifeEvent(next, action);
      if (existing) {
        if (action.ref) refs[action.ref] = existing.id;
        next = {
          ...next,
          lifeEvents: next.lifeEvents.map((event) =>
            event.id === existing.id
              ? {
                  ...event,
                  description: action.description ?? event.description,
                  startsAt: action.startsAt ?? event.startsAt,
                  endsAt: action.endsAt ?? event.endsAt,
                  location: action.location ?? event.location,
                  priority: action.priority ?? event.priority,
                  updatedAt: nowIso()
                }
              : event
          )
        };
        return;
      }
      const event = {
        id: createId("event"),
        title: action.title,
        description: action.description,
        category: action.category ?? "other",
        startsAt: action.startsAt,
        endsAt: action.endsAt,
        location: action.location,
        priority: action.priority ?? "medium",
        participants: action.participants ?? [],
        status: "planned" as const,
        sourceInputId: inputId,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      if (action.ref) refs[action.ref] = event.id;
      next = { ...next, lifeEvents: [event, ...next.lifeEvents] };
      return;
    }

    if (action.type === "add_check_in") {
      const relatedType = action.relatedType;
      const relatedId = action.relatedId ?? (action.relatedRef ? refs[action.relatedRef] : undefined) ?? (relatedType === "project" ? "assistant" : undefined);
      if (!relatedId) return;
      if (findSimilarCheckIn(next.checkIns, action.title, action.question, relatedType, relatedId)) {
        return;
      }
      next = {
        ...next,
        checkIns: [
          {
            id: createId("check"),
            title: action.title,
            question: action.question,
            relatedType,
            relatedId,
            askAt: action.askAt ?? nowIso(),
            status: "pending",
            createdAt: nowIso()
          },
          ...next.checkIns
        ]
      };
      return;
    }

    if (action.type === "add_mood_log") {
      next = {
        ...next,
        moodLogs: [
          {
            id: createId("mood"),
            moodLabel: action.moodLabel,
            energyLevel: action.energyLevel ?? "medium",
            note: action.note,
            createdAt: nowIso()
          },
          ...next.moodLogs
        ]
      };
    }
  });

  next = applyMemoryWrites(next, interpretation.memoryWrites, inputId);

  return {
    state: next,
    feedback: interpretation.feedback
  };
}
