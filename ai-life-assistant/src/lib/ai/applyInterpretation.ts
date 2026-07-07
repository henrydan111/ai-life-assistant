import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { createId } from "@/lib/id";
import { nowIso } from "@/lib/time/parseTime";
import type { AssistantCheckIn, AssistantState, ParseFeedback, RecurrenceCandidate, ShoppingItem, Task } from "@/types/domain";

export type InterpretResult = {
  state: AssistantState;
  feedback: ParseFeedback;
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
    priority: action.priority ?? (action.dueAt ? "high" : "medium"),
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
  const newItem: ShoppingItem | undefined = existing
    ? undefined
    : {
        id: itemId,
        itemName: action.itemName,
        quantity: action.quantity,
        status: action.status ?? "needed",
        expectedAt: action.expectedAt,
        category: action.category ?? "household",
        createdAt: now,
        updatedAt: now
      };

  if (action.ref) refs[action.ref] = itemId;

  const recurrenceCandidates = upsertRecurrence(state.recurrenceCandidates, normalize(action.itemName), "shopping_item");
  const prompt = recurrencePrompt(recurrenceCandidates, action.itemName, itemId, state.checkIns);
  const shouldCreateTask = action.createTask !== false && (action.status ?? "needed") === "needed";

  return {
    ...state,
    shoppingItems: newItem ? [newItem, ...state.shoppingItems] : state.shoppingItems,
    tasks: shouldCreateTask ? [createShoppingTask(action.itemName, sourceInputId, action.dueAt), ...state.tasks] : state.tasks,
    checkIns: prompt ? [prompt, ...state.checkIns] : state.checkIns,
    recurrenceCandidates
  };
}

function updateShoppingStatus(state: AssistantState, action: Extract<InterpretAction, { type: "update_shopping_status" }>) {
  const now = nowIso();
  const hasExisting = state.shoppingItems.some((item) => similar(item.itemName, action.itemName));
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

  if (hasExisting) return { ...state, shoppingItems: updated };

  return {
    ...state,
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
  interpretation: AiInterpretation
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
        inputType,
        parsedSummary: interpretation.feedback.title,
        createdAt: now
      },
      ...state.inputs
    ].slice(0, 60)
  };

  interpretation.actions.forEach((action) => {
    if (action.type === "add_task") {
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
      const event = {
        id: createId("event"),
        title: action.title,
        description: action.description,
        category: action.category ?? "other",
        startsAt: action.startsAt,
        endsAt: action.endsAt,
        location: action.location,
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
      next = {
        ...next,
        checkIns: [
          {
            id: createId("check"),
            title: action.title,
            question: action.question,
            relatedType: action.relatedType ?? "project",
            relatedId: action.relatedId ?? (action.relatedRef ? refs[action.relatedRef] : undefined) ?? "assistant",
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

  return {
    state: next,
    feedback: interpretation.feedback
  };
}
