import type { AssistantState, ParseFeedback } from "@/types/domain";
import type { ConfirmationTrace } from "@/lib/confirmation/resolvePendingConfirmations";

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
  confirmationTrace?: ConfirmationTrace[];
};

export type RequestRevision = {
  clientRequestId: string;
  baseRevision: number;
};

export type InterpretStateUpdateBlockReason = "skip" | "request_mismatch" | "stale";

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

export function hasMismatchedInterpretRequest(
  result: Pick<InterpretResult, "clientRequestId">,
  request?: Pick<Partial<RequestRevision>, "clientRequestId">
) {
  return Boolean(result.clientRequestId && request?.clientRequestId && result.clientRequestId !== request.clientRequestId);
}

export function getInterpretStateUpdateBlockReason(
  result: Pick<InterpretResult, "provider" | "safeFailure" | "stateUnchanged" | "clientRequestId" | "baseRevision">,
  currentRevision: number,
  request?: Partial<RequestRevision>
): InterpretStateUpdateBlockReason | null {
  if (shouldSkipInterpretStateUpdate(result)) return "skip";
  if (hasMismatchedInterpretRequest(result, request)) return "request_mismatch";
  if (isStaleInterpretResult(result, currentRevision, request?.baseRevision)) return "stale";
  return null;
}

export function shouldApplyInterpretResult(
  result: Pick<InterpretResult, "provider" | "safeFailure" | "stateUnchanged" | "clientRequestId" | "baseRevision">,
  currentRevision: number,
  request?: Partial<RequestRevision>
) {
  return getInterpretStateUpdateBlockReason(result, currentRevision, request) === null;
}

export function applyInterpretResultIfFresh(
  result: Pick<InterpretResult, "provider" | "safeFailure" | "stateUnchanged" | "clientRequestId" | "baseRevision" | "state">,
  currentRevision: number,
  request: Partial<RequestRevision> | undefined,
  applyState: (state: AssistantState) => void
): InterpretStateUpdateBlockReason | null {
  const blockReason = getInterpretStateUpdateBlockReason(result, currentRevision, request);
  if (!blockReason && result.state) {
    applyState(result.state);
  }
  return blockReason;
}

export function buildStaleInterpretResultFeedback(): ParseFeedback {
  return {
    title: "没有覆盖当前总览",
    detail: "这次整理返回时，你的总览已经更新过。为了避免覆盖当前内容，我没有自动保存这次结果。你可以再说一遍需要补上的事项。"
  };
}
