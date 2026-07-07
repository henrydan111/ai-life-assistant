import {
  parseAiInterpretation,
  validateActionArraySchema,
  validateAiInterpretationSchema,
  type AiInterpretation,
  type InterpretAction
} from "@/lib/ai/interpretation";
import { validateCoreIntentCoverage } from "./scenarioCoverageGuards";

export type IntentUnderstanding = {
  feedback: AiInterpretation["feedback"];
  actions: InterpretAction[];
  memoryCandidates: unknown[];
  proactiveCheckins: unknown[];
};

export type CoverageReview = {
  coverage: "complete" | "incomplete";
  missingIntents: string[];
  revisedActions: InterpretAction[];
  memoryCandidates: unknown[];
  proactiveCheckins: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function rawArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readArray(record: Record<string, unknown>, snakeKey: string, camelKey: string) {
  return rawArray(record[snakeKey] ?? record[camelKey]);
}

function normalizeActionArray(value: unknown) {
  return parseAiInterpretation({
    feedback: { title: "中间结果", detail: "中间结果" },
    actions: rawArray(value)
  }).value?.actions ?? [];
}

export function normalizeIntentUnderstanding(value: unknown): IntentUnderstanding | null {
  if (!isRecord(value)) return null;
  const interpretation = parseAiInterpretation(value).value;
  if (!interpretation) return null;

  return {
    feedback: interpretation.feedback,
    actions: interpretation.actions,
    memoryCandidates: readArray(value, "memory_candidates", "memoryCandidates"),
    proactiveCheckins: readArray(value, "proactive_checkins", "proactiveCheckins")
  };
}

export function normalizeCoverageReview(value: unknown): CoverageReview | null {
  if (!isRecord(value)) return null;
  const missingIntents = stringArray(value.missing_intents ?? value.missingIntents);
  const revisedSource = value.revised_actions ?? value.revisedActions ?? value.actions;
  const revisedActions = revisedSource ? normalizeActionArray(revisedSource) : [];
  const coverage = optionalString(value.coverage) === "complete" && missingIntents.length === 0 ? "complete" : "incomplete";

  return {
    coverage,
    missingIntents,
    revisedActions,
    memoryCandidates: readArray(value, "memory_candidates", "memoryCandidates"),
    proactiveCheckins: readArray(value, "proactive_checkins", "proactiveCheckins")
  };
}

function rawActionSource(raw: unknown, key = "actions") {
  if (!isRecord(raw)) return [];
  return rawArray(raw[key]);
}

export function validateNormalizedActionCount(raw: unknown, normalizedCount: number, key = "actions") {
  const source = rawActionSource(raw, key);
  if (!source.length) return [];
  const schemaErrors = validateActionArraySchema(source, key);
  if (schemaErrors.length) return schemaErrors;
  return source.length === normalizedCount
    ? []
    : [`${key} 中有 ${source.length - normalizedCount} 个 action 没有通过 schema 校验，不能被静默丢弃。`];
}

export function validateUnderstanding(_rawText: string, understanding: IntentUnderstanding, raw: unknown) {
  return validateAiInterpretationSchema(raw).filter((error) => !isMemoryWriteSchemaError(error));
}

function isMemoryWriteSchemaError(error: string) {
  return /^memoryWrites\[\d+\]\.|^memory_writes\[\d+\]\.|^memoryWrites 必须是数组|^memory_writes 必须是数组/.test(error);
}

function validateAiInterpretationSchemaForPlanning(raw: unknown) {
  return validateAiInterpretationSchema(raw).filter((error) => !isMemoryWriteSchemaError(error));
}

export function validateCoverage(_rawText: string, coverage: CoverageReview, raw: unknown) {
  const revisedKey = isRecord(raw) && Array.isArray(raw.revised_actions)
    ? "revised_actions"
    : isRecord(raw) && Array.isArray(raw.revisedActions)
      ? "revisedActions"
      : "actions";
  const errors = [
    ...validateNormalizedActionCount(raw, coverage.revisedActions.length, revisedKey)
  ];
  if (!isRecord(raw) || (!Array.isArray(raw.revised_actions) && !Array.isArray(raw.revisedActions))) {
    errors.push("revised_actions 必须返回完整 action 列表，不能省略或改名为其他字段。");
  }
  return errors;
}

function validateCheckInReferences(actions: InterpretAction[]) {
  const errors: string[] = [];
  const refs = new Map<string, InterpretAction["type"]>();
  actions.forEach((action) => {
    if ("ref" in action && action.ref) refs.set(action.ref, action.type);
  });

  actions.forEach((action, index) => {
    if (action.type !== "add_check_in") return;
    if (action.relatedType === "project") return;
    if (!action.relatedRef && !action.relatedId) {
      errors.push(`actions[${index}] add_check_in relatedType=${action.relatedType} 时必须提供 relatedRef 或 relatedId。`);
      return;
    }
    if (!action.relatedRef) return;

    const refType = refs.get(action.relatedRef);
    if (!refType) {
      errors.push(`actions[${index}] add_check_in relatedRef="${action.relatedRef}" 没有对应的主 action ref。`);
      return;
    }
    const expectedType =
      action.relatedType === "life_event"
        ? "add_life_event"
        : action.relatedType === "shopping_item"
          ? "add_shopping_item"
          : action.relatedType === "routine_goal"
            ? "add_routine_goal"
            : "add_task";
    if (refType !== expectedType) {
      errors.push(`actions[${index}] add_check_in relatedRef="${action.relatedRef}" 指向 ${refType}，但 relatedType=${action.relatedType}。`);
    }
  });

  return errors;
}

function isHHMM(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateRoutineGoalTargetTimes(actions: InterpretAction[]) {
  const errors: string[] = [];
  actions.forEach((action, index) => {
    if (action.type !== "add_routine_goal" || !action.targetTime) return;
    if (!isHHMM(action.targetTime)) {
      errors.push(`normalized_actions[${index}].targetTime 必须是 HH:mm，且范围为 00:00-23:59。`);
    }
  });
  return errors;
}

export function validateFinalInterpretation(rawText: string, interpretation: AiInterpretation, raw?: unknown) {
  return [
    ...(raw === undefined ? [] : validateAiInterpretationSchemaForPlanning(raw)),
    ...validateActionArraySchema(interpretation.actions, "normalized_actions"),
    ...validateRoutineGoalTargetTimes(interpretation.actions),
    ...validateCoreIntentCoverage(rawText, interpretation.actions, interpretation.feedback.question, true),
    ...validateCheckInReferences(interpretation.actions)
  ];
}
