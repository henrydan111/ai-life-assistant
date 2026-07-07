import {
  normalizeAiInterpretation,
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
  return normalizeAiInterpretation({
    feedback: { title: "中间结果", detail: "中间结果" },
    actions: rawArray(value)
  })?.actions ?? [];
}

export function normalizeIntentUnderstanding(value: unknown): IntentUnderstanding | null {
  if (!isRecord(value)) return null;
  const interpretation = normalizeAiInterpretation(value);
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

export function validateUnderstanding(rawText: string, understanding: IntentUnderstanding, raw: unknown) {
  return [
    ...validateAiInterpretationSchema(raw),
    ...validateCoreIntentCoverage(rawText, understanding.actions, understanding.feedback.question)
  ];
}

export function validateCoverage(rawText: string, coverage: CoverageReview, raw: unknown) {
  const revisedKey = isRecord(raw) && Array.isArray(raw.revised_actions)
    ? "revised_actions"
    : isRecord(raw) && Array.isArray(raw.revisedActions)
      ? "revisedActions"
      : "actions";
  const errors = [
    ...validateNormalizedActionCount(raw, coverage.revisedActions.length, revisedKey),
    ...validateCoreIntentCoverage(rawText, coverage.revisedActions)
  ];
  if (!isRecord(raw) || (!Array.isArray(raw.revised_actions) && !Array.isArray(raw.revisedActions))) {
    errors.push("revised_actions 必须返回完整 action 列表，不能省略或改名为其他字段。");
  }
  if (!coverage.revisedActions.length) {
    errors.push("revised_actions 必须返回完整 action 列表，不能省略。");
  }
  return errors;
}

export function validateFinalInterpretation(rawText: string, interpretation: AiInterpretation, raw?: unknown) {
  return [
    ...(raw === undefined ? [] : validateAiInterpretationSchema(raw)),
    ...validateCoreIntentCoverage(rawText, interpretation.actions, interpretation.feedback.question, true)
  ];
}
