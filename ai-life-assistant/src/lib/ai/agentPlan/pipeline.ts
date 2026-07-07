import type { AiInterpretation } from "@/lib/ai/interpretation";
import { selectRelevantMemories } from "@/lib/memory/selectRelevantMemories";
import type { AssistantState } from "@/types/domain";
import { timezoneForState } from "./context";
import { canUseAgentPlan, resolveAgentPlanLanguageModel } from "./provider";
import { checkCoverageWithAgentPlan, planFinalActionsWithAgentPlan, understandInputWithAgentPlan } from "./stages";
import type { ProgressReporter } from "./types";

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
