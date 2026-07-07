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
};

export function shouldSkipInterpretStateUpdate(result: Pick<InterpretResult, "provider" | "safeFailure" | "stateUnchanged">) {
  return Boolean(
    result.safeFailure ||
      result.stateUnchanged ||
      result.provider === safePlanningFailureProvider
  );
}
