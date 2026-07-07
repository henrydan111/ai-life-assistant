import type { AssistantState, ParseFeedback } from "@/types/domain";

export const safePlanningFailureProvider = "volcengine_agent_plan_runtime_failed_safely";

export type InterpretResult = {
  state?: AssistantState;
  feedback?: ParseFeedback;
  provider?: string;
  model?: string;
  error?: string;
  safeFailure?: boolean;
  stateUnchanged?: boolean;
  clientRequestId?: string;
  baseRevision?: number;
};

export function shouldSkipInterpretStateUpdate(result: Pick<InterpretResult, "provider" | "safeFailure" | "stateUnchanged">) {
  return Boolean(
    result.safeFailure ||
      result.stateUnchanged ||
      result.provider === safePlanningFailureProvider
  );
}

export function isStaleInterpretResult(
  result: Pick<InterpretResult, "baseRevision">,
  currentRevision: number,
  fallbackBaseRevision?: number
) {
  const baseRevision = typeof result.baseRevision === "number" ? result.baseRevision : fallbackBaseRevision;
  return typeof baseRevision === "number" && baseRevision !== currentRevision;
}

export function buildStaleInterpretResultFeedback(): ParseFeedback {
  return {
    title: "没有覆盖当前总览",
    detail: "这次结果基于较早的状态返回。为了避免覆盖你刚更新的内容，我没有保存这次结果。"
  };
}
