import {
  normalizeAiInterpretation,
  type AiInterpretation
} from "@/lib/ai/interpretation";
import { localNowText, summarizeState, timezoneForState } from "@/lib/ai/agentPlan/context";
import { canUseAgentPlan, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan/provider";
import { COVERAGE_PROMPT, PLANNING_PROMPT, UNDERSTANDING_PROMPT } from "@/lib/ai/agentPlan/prompts";
import { splitCombinedTravelPrepCheckIns } from "@/lib/ai/agentPlan/travelPrepPolicy";
import { requestValidatedAgentPlanJson } from "@/lib/ai/agentPlan/validatedJson";
import type { ProgressReporter } from "@/lib/ai/agentPlan/types";
import {
  normalizeCoverageReview,
  normalizeIntentUnderstanding,
  validateCoverage,
  validateFinalInterpretation,
  validateUnderstanding,
  type CoverageReview,
  type IntentUnderstanding
} from "@/lib/ai/agentPlan/validators";
import { selectRelevantMemories } from "@/lib/memory/selectRelevantMemories";
import type { AssistantState, MemoryContext } from "@/types/domain";

export {
  canUseAgentPlan,
  requestAgentPlanChatCompletion,
  resolveAgentPlanLanguageModel
} from "@/lib/ai/agentPlan/provider";
export { requestValidatedAgentPlanJson } from "@/lib/ai/agentPlan/validatedJson";
export { repairTranscriptWithAgentPlan } from "@/lib/ai/agentPlan/transcriptRepair";

async function understandInputWithAgentPlan({
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

async function checkCoverageWithAgentPlan({
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

async function planFinalActionsWithAgentPlan({
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
      return interpretation ? splitCombinedTravelPrepCheckIns(interpretation) : null;
    },
    validate: (interpretation, raw) => validateFinalInterpretation(rawText, interpretation, raw)
  });
}

export async function interpretWithAgentPlan({
  rawText,
  inputType,
  state,
  model,
  onProgress
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  model?: string;
  onProgress?: ProgressReporter;
}): Promise<AiInterpretation> {
  if (!canUseAgentPlan()) {
    throw new Error("Agent Plan runtime is not configured.");
  }

  const modelId = resolveAgentPlanLanguageModel(model);
  const now = new Date().toISOString();
  const timezone = timezoneForState(state);
  const memoryContext = selectRelevantMemories(rawText, state);
  onProgress?.({
    stage: "understanding",
    status: "active",
    title: "理解原文",
    detail: "正在拆解你说到的每件事。"
  });
  const understanding = await understandInputWithAgentPlan({
    rawText,
    inputType,
    state,
    model: modelId,
    now,
    timezone,
    memoryContext
  });
  onProgress?.({
    stage: "understanding",
    status: "complete",
    title: "理解原文",
    detail: "已完成原文理解。"
  });

  onProgress?.({
    stage: "coverage",
    status: "active",
    title: "检查遗漏",
    detail: "正在确认没有漏掉前半句、日期或提醒。"
  });
  const coverage = await checkCoverageWithAgentPlan({ rawText, understanding, model: modelId, now, timezone, memoryContext });
  onProgress?.({
    stage: "coverage",
    status: coverage.coverage === "complete" ? "complete" : "attention",
    title: "检查遗漏",
    detail: coverage.missingIntents.length
      ? `补上了 ${coverage.missingIntents.length} 个遗漏意图。`
      : "没有发现遗漏。"
  });

  onProgress?.({
    stage: "planning",
    status: "active",
    title: "整理事项",
    detail: "正在合并主活动，并把提醒挂到合适的位置。"
  });
  const interpretation = await planFinalActionsWithAgentPlan({
    rawText,
    inputType,
    state,
    understanding,
    coverage,
    model: modelId,
    now,
    timezone,
    memoryContext
  });
  onProgress?.({
    stage: "planning",
    status: "complete",
    title: "整理事项",
    detail: "已生成待办、活动和附属提醒。"
  });

  return interpretation;
}
