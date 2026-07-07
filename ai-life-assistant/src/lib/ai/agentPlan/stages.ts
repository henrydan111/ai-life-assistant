import { normalizeAiInterpretation } from "@/lib/ai/interpretation";
import type { AssistantState, MemoryContext } from "@/types/domain";
import { localNowText, summarizeState } from "./context";
import { COVERAGE_PROMPT, PLANNING_PROMPT, UNDERSTANDING_PROMPT } from "./prompts";
import { ensureMentionedTravelDraft, splitCombinedTravelPrepCheckIns } from "./travelPrepPolicy";
import { requestValidatedAgentPlanJson } from "./validatedJson";
import {
  normalizeCoverageReview,
  normalizeIntentUnderstanding,
  validateCoverage,
  validateFinalInterpretation,
  validateUnderstanding,
  type CoverageReview,
  type IntentUnderstanding
} from "./validators";

export async function understandInputWithAgentPlan({
  rawText,
  inputType,
  state,
  model,
  now,
  timezone,
  memoryContext
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  model: string;
  now: string;
  timezone: string;
  memoryContext: MemoryContext;
}) {
  return requestValidatedAgentPlanJson({
    model,
    systemPrompt: UNDERSTANDING_PROMPT,
    payload: {
      now,
      localNow: localNowText(timezone),
      timezone,
      rawText,
      inputType,
      memoryContext,
      state: summarizeState(state)
    },
    temperature: 0.1,
    stageName: "Agent Plan understanding",
    normalize: normalizeIntentUnderstanding,
    validate: (understanding, raw) => validateUnderstanding(rawText, understanding, raw)
  });
}

export async function checkCoverageWithAgentPlan({
  rawText,
  understanding,
  model,
  now,
  timezone,
  memoryContext
}: {
  rawText: string;
  understanding: IntentUnderstanding;
  model: string;
  now: string;
  timezone: string;
  memoryContext: MemoryContext;
}) {
  return requestValidatedAgentPlanJson({
    model,
    systemPrompt: COVERAGE_PROMPT,
    payload: {
      now,
      localNow: localNowText(timezone),
      timezone,
      rawText,
      memoryContext,
      feedback: understanding.feedback,
      actions: understanding.actions,
      memory_candidates: understanding.memoryCandidates,
      proactive_checkins: understanding.proactiveCheckins
    },
    temperature: 0.1,
    stageName: "Agent Plan coverage",
    normalize: normalizeCoverageReview,
    validate: (coverage, raw) => validateCoverage(rawText, coverage, raw)
  });
}

export async function planFinalActionsWithAgentPlan({
  rawText,
  inputType,
  state,
  understanding,
  coverage,
  model,
  now,
  timezone,
  memoryContext
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  understanding: IntentUnderstanding;
  coverage: CoverageReview;
  model: string;
  now: string;
  timezone: string;
  memoryContext: MemoryContext;
}) {
  const payload = {
    now,
    localNow: localNowText(timezone),
    timezone,
    rawText,
    inputType,
    memoryContext,
    state: summarizeState(state),
    understanding: {
      feedback: understanding.feedback,
      actions: understanding.actions,
      memory_candidates: understanding.memoryCandidates,
      proactive_checkins: understanding.proactiveCheckins
    },
    coverage: {
      coverage: coverage.coverage,
      missing_intents: coverage.missingIntents,
      revised_actions: coverage.revisedActions,
      memory_candidates: coverage.memoryCandidates.length ? coverage.memoryCandidates : understanding.memoryCandidates,
      proactive_checkins: coverage.proactiveCheckins.length ? coverage.proactiveCheckins : understanding.proactiveCheckins
    }
  };

  return requestValidatedAgentPlanJson({
    model,
    systemPrompt: PLANNING_PROMPT,
    payload,
    temperature: 0.2,
    stageName: "Agent Plan planning",
    normalize: (value) => {
      const interpretation = normalizeAiInterpretation(value);
      return interpretation ? ensureMentionedTravelDraft(rawText, splitCombinedTravelPrepCheckIns(interpretation)) : null;
    },
    validate: (interpretation, raw) => validateFinalInterpretation(rawText, interpretation, raw)
  });
}
