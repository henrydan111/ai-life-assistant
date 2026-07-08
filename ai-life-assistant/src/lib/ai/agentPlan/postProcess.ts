import type { AiInterpretation } from "@/lib/ai/interpretation";
import { applyRoutineGoalPolicy } from "@/lib/ai/productCompiler/policies/routineGoalPolicy";
import { applyShoppingPolicy } from "@/lib/ai/productCompiler/policies/shoppingPolicy";
import { applyTravelPolicy } from "@/lib/ai/productCompiler/policies/travelPolicy";
import { applyTravelPrepPolicy } from "@/lib/ai/productCompiler/policies/travelPrepPolicy";
import { repairFeedbackCopy } from "@/lib/ai/productCompiler/responseRepair";
import type { AssistantState } from "@/types/domain";
import { actionText } from "./actionText";
import { actionRefs, ensureActionRef } from "./actionRefs";
import type { PlanTrace } from "./types";

function expectedActionTypeForRelatedType(relatedType: Extract<AiInterpretation["actions"][number], { type: "add_check_in" }>["relatedType"]) {
  if (relatedType === "life_event") return "add_life_event";
  if (relatedType === "shopping_item") return "add_shopping_item";
  if (relatedType === "routine_goal") return "add_routine_goal";
  if (relatedType === "task") return "add_task";
  return undefined;
}

function normalizeCheckInRelatedActionRefs(interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  const refs = new Map<string, AiInterpretation["actions"][number]["type"]>();
  interpretation.actions.forEach((action) => {
    if ("ref" in action && action.ref) refs.set(action.ref, action.type);
  });
  if (!refs.size) return interpretation;

  return {
    ...interpretation,
    actions: interpretation.actions.map((action) => {
      if (action.type !== "add_check_in" || !action.relatedId || action.relatedRef) return action;
      const refType = refs.get(action.relatedId);
      if (!refType || refType !== expectedActionTypeForRelatedType(action.relatedType)) return action;
      const repaired = {
        ...action,
        relatedRef: action.relatedId,
        relatedId: undefined
      };
      trace.push({
        rule: "references.repair.related_id_action_ref",
        severity: "repair",
        before: action,
        after: repaired,
        reason: "The model put a same-batch action ref in relatedId; relatedId is only for persisted object ids, so normalize it to relatedRef before apply."
      });
      return repaired;
    })
  };
}

function repairExistingRelatedRefs(state: AssistantState, interpretation: AiInterpretation): AiInterpretation {
  const refs = actionRefs(interpretation.actions);
  const existingIds = {
    task: new Set(state.tasks.map((task) => task.id)),
    shopping_item: new Set(state.shoppingItems.map((item) => item.id)),
    life_event: new Set(state.lifeEvents.map((event) => event.id)),
    project: new Set(state.projects.map((project) => project.id)),
    routine_goal: new Set(state.routineGoals.map((goal) => goal.id))
  };

  return {
    ...interpretation,
    actions: interpretation.actions.map((action) => {
      if (action.type !== "add_check_in" || !action.relatedRef || action.relatedId || refs.has(action.relatedRef)) {
        return action;
      }
      if (!existingIds[action.relatedType].has(action.relatedRef)) return action;
      return {
        ...action,
        relatedId: action.relatedRef,
        relatedRef: undefined
      };
    })
  };
}

function ensureLeaveBossCheckIn(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  if (!/请假/.test(rawText) || !/(老板|领导|提前|提醒)/.test(rawText)) return interpretation;

  let actions = interpretation.actions;
  const taskIndex = actions.findIndex((action) => action.type === "add_task" && /请假/.test(actionText(action)));
  if (taskIndex === -1) return interpretation;

  const withRef = ensureActionRef(actions, taskIndex, "leave_task");
  actions = withRef.actions;
  const taskRef = withRef.ref;
  if (!taskRef) return { ...interpretation, actions };

  const exists = actions.some(
    (action) =>
      action.type === "add_check_in" &&
      action.relatedType === "task" &&
      action.relatedRef === taskRef &&
      /(老板|领导|提前|请假)/.test(actionText(action))
  );
  if (exists) return { ...interpretation, actions };

  return {
    ...interpretation,
    actions: [
      ...actions,
      {
        type: "add_check_in",
        title: "提前和老板沟通请假",
        question: "请假前和老板说好了吗？",
        relatedType: "task",
        relatedRef: taskRef
      }
    ]
  };
}

export function postProcessAgentPlanInterpretation(
  rawText: string,
  state: AssistantState,
  interpretation: AiInterpretation
): AiInterpretation {
  return postProcessAgentPlanInterpretationWithTrace(rawText, state, interpretation).interpretation;
}

export function postProcessAgentPlanInterpretationWithTrace(
  rawText: string,
  state: AssistantState,
  interpretation: AiInterpretation
) {
  const trace: PlanTrace[] = [...(interpretation.planTrace ?? [])];
  let next = interpretation;
  next = normalizeCheckInRelatedActionRefs(next, trace);
  next = applyRoutineGoalPolicy(rawText, next, trace);
  next = applyShoppingPolicy(rawText, next, trace);
  next = applyTravelPolicy(rawText, next, trace);
  next = applyTravelPrepPolicy(rawText, next, trace);
  next = ensureLeaveBossCheckIn(rawText, next);
  next = repairExistingRelatedRefs(state, next);
  next = repairFeedbackCopy(rawText, next, trace);
  return {
    interpretation: {
      ...next,
      planTrace: trace
    },
    trace
  };
}
