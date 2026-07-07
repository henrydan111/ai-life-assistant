import type { AssistantState, ParseFeedback } from "@/types/domain";
import { resolveAgentPlanLanguageModel } from "./provider";

export const safePlanningFailureProvider = "volcengine_agent_plan_runtime_failed_safely";

export function safePlanningFailureFeedback(): ParseFeedback {
  return {
    title: "这次没有安全保存",
    detail: "AI 整理时遇到内部格式问题。为了避免记错，我没有修改你的事项，可以换个说法再试一次。"
  };
}

export function buildSafePlanningFailureResult(state: AssistantState, model?: string) {
  return {
    state,
    feedback: safePlanningFailureFeedback(),
    provider: safePlanningFailureProvider,
    model: resolveAgentPlanLanguageModel(model)
  };
}

