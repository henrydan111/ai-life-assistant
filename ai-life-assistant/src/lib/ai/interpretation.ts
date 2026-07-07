import type { EnergyLevel, Horizon, LifeEvent, MemoryWrite, ParseFeedback, Priority, ShoppingItem, Task } from "@/types/domain";

export type InterpretAction =
  | {
      type: "add_task";
      ref?: string;
      title: string;
      description?: string;
      taskType?: Task["type"];
      horizon?: Horizon;
      dueAt?: string;
      estimatedMinutes?: number;
      energyRequired?: EnergyLevel;
      priority?: Priority;
    }
  | {
      type: "mark_task_done";
      matchTitle: string;
    }
  | {
      type: "add_shopping_item";
      ref?: string;
      itemName: string;
      quantity?: string;
      category?: string;
      status?: ShoppingItem["status"];
      expectedAt?: string;
      createTask?: boolean;
      dueAt?: string;
    }
  | {
      type: "update_shopping_status";
      itemName: string;
      status: ShoppingItem["status"];
      expectedAt?: string;
    }
  | {
      type: "add_life_event";
      ref?: string;
      title: string;
      description?: string;
      category?: LifeEvent["category"];
      startsAt?: string;
      endsAt?: string;
      location?: string;
      priority?: Priority;
      participants?: string[];
    }
  | {
      type: "add_check_in";
      title: string;
      question: string;
      relatedType?: "task" | "shopping_item" | "life_event" | "project";
      relatedRef?: string;
      relatedId?: string;
      askAt?: string;
    }
  | {
      type: "add_mood_log";
      moodLabel: string;
      energyLevel?: EnergyLevel;
      note?: string;
    };

export type AiInterpretation = {
  feedback: ParseFeedback;
  actions: InterpretAction[];
  memoryWrites: MemoryWrite[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function parseAction(value: unknown): InterpretAction | null {
  if (!isRecord(value)) return null;
  const type = optionalString(value.type);

  if (type === "add_task") {
    const title = optionalString(value.title);
    if (!title) return null;
    return {
      type,
      ref: optionalString(value.ref),
      title,
      description: optionalString(value.description),
      taskType: optionalString(value.taskType) as Task["type"] | undefined,
      horizon: optionalString(value.horizon) as Horizon | undefined,
      dueAt: optionalString(value.dueAt),
      estimatedMinutes: optionalNumber(value.estimatedMinutes),
      energyRequired: optionalString(value.energyRequired) as EnergyLevel | undefined,
      priority: optionalString(value.priority) as Priority | undefined
    };
  }

  if (type === "mark_task_done") {
    const matchTitle = optionalString(value.matchTitle);
    return matchTitle ? { type, matchTitle } : null;
  }

  if (type === "add_shopping_item") {
    const itemName = optionalString(value.itemName);
    if (!itemName) return null;
    return {
      type,
      ref: optionalString(value.ref),
      itemName,
      quantity: optionalString(value.quantity),
      category: optionalString(value.category),
      status: optionalString(value.status) as ShoppingItem["status"] | undefined,
      expectedAt: optionalString(value.expectedAt),
      createTask: optionalBoolean(value.createTask),
      dueAt: optionalString(value.dueAt)
    };
  }

  if (type === "update_shopping_status") {
    const itemName = optionalString(value.itemName);
    const status = optionalString(value.status) as ShoppingItem["status"] | undefined;
    return itemName && status ? { type, itemName, status, expectedAt: optionalString(value.expectedAt) } : null;
  }

  if (type === "add_life_event") {
    const title = optionalString(value.title);
    if (!title) return null;
    return {
      type,
      ref: optionalString(value.ref),
      title,
      description: optionalString(value.description),
      category: (optionalString(value.category) as LifeEvent["category"] | undefined) ?? "other",
      startsAt: optionalString(value.startsAt),
      endsAt: optionalString(value.endsAt),
      location: optionalString(value.location),
      priority: optionalString(value.priority) as Priority | undefined,
      participants: Array.isArray(value.participants) ? value.participants.filter((item): item is string => typeof item === "string") : []
    };
  }

  if (type === "add_check_in") {
    const title = optionalString(value.title);
    const question = optionalString(value.question);
    if (!title || !question) return null;
    return {
      type,
      title,
      question,
      relatedType: optionalString(value.relatedType) as "task" | "shopping_item" | "life_event" | "project" | undefined,
      relatedRef: optionalString(value.relatedRef),
      relatedId: optionalString(value.relatedId),
      askAt: optionalString(value.askAt)
    };
  }

  if (type === "add_mood_log") {
    const moodLabel = optionalString(value.moodLabel);
    if (!moodLabel) return null;
    return {
      type,
      moodLabel,
      energyLevel: optionalString(value.energyLevel) as EnergyLevel | undefined,
      note: optionalString(value.note)
    };
  }

  return null;
}

function parseMemoryWrite(value: unknown): MemoryWrite | null {
  if (!isRecord(value)) return null;
  const type = optionalString(value.type) as MemoryWrite["type"] | undefined;
  const summary = optionalString(value.summary);
  const confidence = optionalNumber(value.confidence);
  const evidence = optionalString(value.evidence);

  if (!type || !summary || confidence === undefined || !evidence) return null;
  if (
    ![
      "household",
      "preference",
      "recurring_pattern",
      "travel_habit",
      "weather_preference",
      "assistant_behavior",
      "open_loop"
    ].includes(type)
  ) {
    return null;
  }

  return {
    type,
    summary,
    tags: stringArray(value.tags),
    entities: stringArray(value.entities),
    confidence,
    sensitivity: optionalString(value.sensitivity) as MemoryWrite["sensitivity"] | undefined,
    requiresConfirmation: optionalBoolean(value.requiresConfirmation ?? value.requires_confirmation),
    evidence
  };
}

export function normalizeAiInterpretation(value: unknown): AiInterpretation | null {
  if (!isRecord(value)) return null;
  const feedback = isRecord(value.feedback) ? value.feedback : {};
  const title = optionalString(feedback.title);
  const detail = optionalString(feedback.detail);
  const actionSource = Array.isArray(value.actions) ? value.actions : Array.isArray(value.operations) ? value.operations : [];
  const actions = actionSource.map(parseAction).filter((action): action is InterpretAction => Boolean(action));
  const memorySource = Array.isArray(value.memoryWrites)
    ? value.memoryWrites
    : Array.isArray(value.memory_writes)
      ? value.memory_writes
      : [];
  const memoryWrites = memorySource.map(parseMemoryWrite).filter((item): item is MemoryWrite => Boolean(item));

  if (!title || !detail) return null;

  return {
    feedback: {
      title,
      detail,
      question: optionalString(feedback.question)
    },
    actions,
    memoryWrites
  };
}
