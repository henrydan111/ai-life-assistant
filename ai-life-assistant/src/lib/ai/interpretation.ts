import type { EnergyLevel, Horizon, LifeEvent, MemoryWrite, ParseFeedback, Priority, RoutineGoal, ShoppingItem, Task } from "@/types/domain";

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
      type: "add_routine_goal";
      ref?: string;
      title: string;
      description?: string;
      cadence?: RoutineGoal["cadence"];
      targetTime?: string;
      targetTimeRelation?: RoutineGoal["targetTimeRelation"];
      scope?: RoutineGoal["scope"];
      scopeLabel?: string;
      priority?: Priority;
    }
  | {
      type: "add_check_in";
      title: string;
      question: string;
      relatedType: "task" | "shopping_item" | "life_event" | "project" | "routine_goal";
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

type ParseResult<T> = {
  value: T | null;
  errors: string[];
};

const actionTypes = [
  "add_task",
  "mark_task_done",
  "add_shopping_item",
  "update_shopping_status",
  "add_life_event",
  "add_routine_goal",
  "add_check_in",
  "add_mood_log"
] as const;

const taskTypes: Task["type"][] = ["task", "project_step", "reminder", "waiting_for", "habit"];
const horizons: Horizon[] = ["now", "today", "this_week", "later", "someday"];
const energyLevels: EnergyLevel[] = ["low", "medium", "high"];
const priorities: Priority[] = ["low", "medium", "high"];
const shoppingStatuses: ShoppingItem["status"][] = ["needed", "ordered", "bought", "removed"];
const lifeEventCategories: LifeEvent["category"][] = ["travel", "class", "appointment", "household", "outing", "other"];
const routineCadences: RoutineGoal["cadence"][] = ["daily", "weekly", "custom"];
const routineTargetTimeRelations: NonNullable<RoutineGoal["targetTimeRelation"]>[] = ["before", "at", "after"];
const routineScopes: RoutineGoal["scope"][] = ["recent", "ongoing", "date_range", "unspecified"];
const checkInRelatedTypes: Extract<InterpretAction, { type: "add_check_in" }>["relatedType"][] = [
  "task",
  "shopping_item",
  "life_event",
  "project",
  "routine_goal"
];
const memoryTypes: MemoryWrite["type"][] = [
  "household",
  "preference",
  "recurring_pattern",
  "travel_habit",
  "weather_preference",
  "assistant_behavior",
  "open_loop"
];
const sensitivities: NonNullable<MemoryWrite["sensitivity"]>[] = ["low", "medium", "high"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPresent(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function requiredStringField(record: Record<string, unknown>, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  errors.push(`${path}.${key} 必须是非空字符串。`);
  return undefined;
}

function optionalStringField(record: Record<string, unknown>, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (!isPresent(value)) return undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  errors.push(`${path}.${key} 必须是字符串。`);
  return undefined;
}

function optionalBooleanField(record: Record<string, unknown>, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (!isPresent(value)) return undefined;
  if (typeof value === "boolean") return value;
  errors.push(`${path}.${key} 必须是 boolean。`);
  return undefined;
}

function optionalBooleanAliasField(
  record: Record<string, unknown>,
  keys: string[],
  path: string,
  errors: string[]
) {
  const key = keys.find((item) => isPresent(record[item]));
  if (!key) return undefined;
  const value = record[key];
  if (typeof value === "boolean") return value;
  errors.push(`${path}.${key} 必须是 boolean。`);
  return undefined;
}

function optionalNumberField(record: Record<string, unknown>, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (!isPresent(value)) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  errors.push(`${path}.${key} 必须是有限数字。`);
  return undefined;
}

function requiredNumberField(record: Record<string, unknown>, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  errors.push(`${path}.${key} 必须是有限数字。`);
  return undefined;
}

function optionalStringArrayField(record: Record<string, unknown>, key: string, path: string, errors: string[]) {
  const value = record[key];
  if (!isPresent(value)) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path}.${key} 必须是字符串数组。`);
    return [];
  }
  const invalidIndex = value.findIndex((item) => typeof item !== "string" || !item.trim());
  if (invalidIndex >= 0) {
    errors.push(`${path}.${key}[${invalidIndex}] 必须是非空字符串。`);
    return [];
  }
  return value.map((item) => item.trim());
}

function optionalEnumField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
  errors: string[]
) {
  const value = record[key];
  if (!isPresent(value)) return undefined;
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  errors.push(`${path}.${key} 必须是 ${allowed.join("|")}。`);
  return undefined;
}

function requiredEnumField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
  errors: string[]
) {
  const value = record[key];
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  errors.push(`${path}.${key} 必须是 ${allowed.join("|")}。`);
  return undefined;
}

function parseAction(value: unknown, index = 0, key = "actions"): ParseResult<InterpretAction> {
  const path = `${key}[${index}]`;
  const errors: string[] = [];
  if (!isRecord(value)) return { value: null, errors: [`${path} 必须是 object。`] };
  const type = requiredEnumField(value, "type", actionTypes, path, errors);
  if (!type) return { value: null, errors };

  if (type === "add_task") {
    const title = requiredStringField(value, "title", path, errors);
    const ref = optionalStringField(value, "ref", path, errors);
    const description = optionalStringField(value, "description", path, errors);
    const taskType = optionalEnumField(value, "taskType", taskTypes, path, errors);
    const horizon = optionalEnumField(value, "horizon", horizons, path, errors);
    const dueAt = optionalStringField(value, "dueAt", path, errors);
    const estimatedMinutes = optionalNumberField(value, "estimatedMinutes", path, errors);
    const energyRequired = optionalEnumField(value, "energyRequired", energyLevels, path, errors);
    const priority = optionalEnumField(value, "priority", priorities, path, errors);
    const action = title
      ? {
          type,
          ref,
          title,
          description,
          taskType,
          horizon,
          dueAt,
          estimatedMinutes,
          energyRequired,
          priority
        }
      : null;
    return { value: errors.length ? null : action, errors };
  }

  if (type === "mark_task_done") {
    const matchTitle = requiredStringField(value, "matchTitle", path, errors);
    return { value: errors.length || !matchTitle ? null : { type, matchTitle }, errors };
  }

  if (type === "add_shopping_item") {
    const itemName = requiredStringField(value, "itemName", path, errors);
    const ref = optionalStringField(value, "ref", path, errors);
    const quantity = optionalStringField(value, "quantity", path, errors);
    const category = optionalStringField(value, "category", path, errors);
    const status = optionalEnumField(value, "status", shoppingStatuses, path, errors);
    const expectedAt = optionalStringField(value, "expectedAt", path, errors);
    const createTask = optionalBooleanField(value, "createTask", path, errors);
    const dueAt = optionalStringField(value, "dueAt", path, errors);
    const action = itemName
      ? {
          type,
          ref,
          itemName,
          quantity,
          category,
          status,
          expectedAt,
          createTask,
          dueAt
        }
      : null;
    return { value: errors.length ? null : action, errors };
  }

  if (type === "update_shopping_status") {
    const itemName = requiredStringField(value, "itemName", path, errors);
    const status = requiredEnumField(value, "status", shoppingStatuses, path, errors);
    const expectedAt = optionalStringField(value, "expectedAt", path, errors);
    const action = itemName && status ? { type, itemName, status, expectedAt } : null;
    return { value: errors.length ? null : action, errors };
  }

  if (type === "add_life_event") {
    const title = requiredStringField(value, "title", path, errors);
    const ref = optionalStringField(value, "ref", path, errors);
    const description = optionalStringField(value, "description", path, errors);
    const category = optionalEnumField(value, "category", lifeEventCategories, path, errors) ?? "other";
    const startsAt = optionalStringField(value, "startsAt", path, errors);
    const endsAt = optionalStringField(value, "endsAt", path, errors);
    const location = optionalStringField(value, "location", path, errors);
    const priority = optionalEnumField(value, "priority", priorities, path, errors);
    const participants = optionalStringArrayField(value, "participants", path, errors);
    const action = title
      ? {
          type,
          ref,
          title,
          description,
          category,
          startsAt,
          endsAt,
          location,
          priority,
          participants
        }
      : null;
    return { value: errors.length ? null : action, errors };
  }

  if (type === "add_routine_goal") {
    const title = requiredStringField(value, "title", path, errors);
    const ref = optionalStringField(value, "ref", path, errors);
    const description = optionalStringField(value, "description", path, errors);
    const cadence = optionalEnumField(value, "cadence", routineCadences, path, errors) ?? "custom";
    const targetTime = optionalStringField(value, "targetTime", path, errors);
    const targetTimeRelation = optionalEnumField(value, "targetTimeRelation", routineTargetTimeRelations, path, errors);
    const scope = optionalEnumField(value, "scope", routineScopes, path, errors) ?? "unspecified";
    const scopeLabel = optionalStringField(value, "scopeLabel", path, errors);
    const priority = optionalEnumField(value, "priority", priorities, path, errors);
    const action = title
      ? {
          type,
          ref,
          title,
          description,
          cadence,
          targetTime,
          targetTimeRelation,
          scope,
          scopeLabel,
          priority
        }
      : null;
    return { value: errors.length ? null : action, errors };
  }

  if (type === "add_check_in") {
    const title = requiredStringField(value, "title", path, errors);
    const question = requiredStringField(value, "question", path, errors);
    const relatedType = requiredEnumField(value, "relatedType", checkInRelatedTypes, path, errors);
    const relatedRef = optionalStringField(value, "relatedRef", path, errors);
    const relatedId = optionalStringField(value, "relatedId", path, errors);
    const askAt = optionalStringField(value, "askAt", path, errors);
    const action =
      title && question && relatedType
        ? {
            type,
            title,
            question,
            relatedType,
            relatedRef,
            relatedId,
            askAt
          }
        : null;
    return { value: errors.length ? null : action, errors };
  }

  if (type === "add_mood_log") {
    const moodLabel = requiredStringField(value, "moodLabel", path, errors);
    const energyLevel = optionalEnumField(value, "energyLevel", energyLevels, path, errors);
    const note = optionalStringField(value, "note", path, errors);
    const action = moodLabel
      ? {
          type,
          moodLabel,
          energyLevel,
          note
        }
      : null;
    return { value: errors.length ? null : action, errors };
  }

  return { value: null, errors };
}

function parseMemoryWrite(value: unknown, index = 0): ParseResult<MemoryWrite> {
  const path = `memoryWrites[${index}]`;
  const errors: string[] = [];
  if (!isRecord(value)) return { value: null, errors: [`${path} 必须是 object。`] };
  const type = requiredEnumField(value, "type", memoryTypes, path, errors);
  const summary = requiredStringField(value, "summary", path, errors);
  const confidence = requiredNumberField(value, "confidence", path, errors);
  const evidence = requiredStringField(value, "evidence", path, errors);
  const tags = optionalStringArrayField(value, "tags", path, errors);
  const entities = optionalStringArrayField(value, "entities", path, errors);
  const sensitivity = optionalEnumField(value, "sensitivity", sensitivities, path, errors);
  const requiresConfirmation = optionalBooleanAliasField(value, ["requiresConfirmation", "requires_confirmation"], path, errors);

  const write =
    type && summary && confidence !== undefined && evidence
      ? {
          type,
          summary,
          tags,
          entities,
          confidence,
          sensitivity,
          requiresConfirmation,
          evidence
        }
      : null;

  return { value: errors.length ? null : write, errors };
}

function readActionSource(record: Record<string, unknown>) {
  if (Array.isArray(record.actions)) return { key: "actions", source: record.actions };
  if (Array.isArray(record.operations)) return { key: "operations", source: record.operations };
  if (isPresent(record.actions)) return { key: "actions", source: undefined };
  if (isPresent(record.operations)) return { key: "operations", source: undefined };
  return { key: "actions", source: [] };
}

function readMemorySource(record: Record<string, unknown>) {
  if (Array.isArray(record.memoryWrites)) return { key: "memoryWrites", source: record.memoryWrites };
  if (Array.isArray(record.memory_writes)) return { key: "memory_writes", source: record.memory_writes };
  if (isPresent(record.memoryWrites)) return { key: "memoryWrites", source: undefined };
  if (isPresent(record.memory_writes)) return { key: "memory_writes", source: undefined };
  return { key: "memoryWrites", source: [] };
}

export function validateActionArraySchema(value: unknown, key = "actions") {
  if (!Array.isArray(value)) return [`${key} 必须是数组。`];
  return value.flatMap((item, index) => parseAction(item, index, key).errors);
}

export function parseAiInterpretation(value: unknown): ParseResult<AiInterpretation> {
  if (!isRecord(value)) return { value: null, errors: ["AI 输出必须是 object。"] };
  const errors: string[] = [];
  const feedback = isRecord(value.feedback) ? value.feedback : {};
  if (!isRecord(value.feedback)) errors.push("feedback 必须是 object。");
  const title = optionalString(feedback.title);
  const detail = optionalString(feedback.detail);
  if (!title) errors.push("feedback.title 必须是非空字符串。");
  if (!detail) errors.push("feedback.detail 必须是非空字符串。");
  const question = optionalStringField(feedback, "question", "feedback", errors);

  const actionSource = readActionSource(value);
  if (!actionSource.source) errors.push(`${actionSource.key} 必须是数组。`);
  const parsedActions = (actionSource.source ?? []).map((item, index) => parseAction(item, index, actionSource.key));
  errors.push(...parsedActions.flatMap((item) => item.errors));
  const actions = parsedActions.map((item) => item.value).filter((action): action is InterpretAction => Boolean(action));

  const memorySource = readMemorySource(value);
  if (!memorySource.source) errors.push(`${memorySource.key} 必须是数组。`);
  const parsedMemoryWrites = (memorySource.source ?? []).map((item, index) => parseMemoryWrite(item, index));
  errors.push(...parsedMemoryWrites.flatMap((item) => item.errors));
  const memoryWrites = parsedMemoryWrites.map((item) => item.value).filter((item): item is MemoryWrite => Boolean(item));

  if (!title || !detail) return { value: null, errors };

  return {
    value: {
      feedback: {
        title,
        detail,
        question
      },
      actions,
      memoryWrites
    },
    errors
  };
}

export function validateAiInterpretationSchema(value: unknown) {
  return parseAiInterpretation(value).errors;
}

/**
 * @deprecated This returns the parsed value even when errors were reported.
 * Use parseAiInterpretation() and inspect errors before saving model output.
 */
export function normalizeAiInterpretation(value: unknown): AiInterpretation | null {
  return parseAiInterpretation(value).value;
}
