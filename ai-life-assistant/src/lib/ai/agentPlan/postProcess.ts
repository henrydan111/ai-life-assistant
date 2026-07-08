import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { applyRoutineGoalPolicy } from "@/lib/ai/productCompiler/policies/routineGoalPolicy";
import { applyShoppingPolicy } from "@/lib/ai/productCompiler/policies/shoppingPolicy";
import { applyTravelPolicy } from "@/lib/ai/productCompiler/policies/travelPolicy";
import { repairFeedbackCopy } from "@/lib/ai/productCompiler/responseRepair";
import type { AssistantState } from "@/types/domain";
import { actionText } from "./actionText";
import { actionRefs, ensureActionRef } from "./actionRefs";
import type { PlanTrace } from "./types";
import {
  containsMultipleTravelPrepCategories,
  splitCombinedTravelPrepCheckIns,
  travelPrepCategoriesIn
} from "./travelPrepPolicy";

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

function ensureMentionedTravelPrepCheckIns(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  const categories = travelPrepCategoriesIn(rawText);
  if (!categories.length) return interpretation;

  let actions = interpretation.actions;
  const eventIndex = actions.findIndex(
    (action) => action.type === "add_life_event" && (action.category === "travel" || /去|出行|旅行|上海|苏州/.test(actionText(action)))
  );
  if (eventIndex === -1) return interpretation;

  const withRef = ensureActionRef(actions, eventIndex, "travel_event");
  actions = withRef.actions;
  const eventRef = withRef.ref;
  if (!eventRef) return { ...interpretation, actions };

  categories.forEach((category) => {
    const exists = actions.some((action) => {
      if (action.type !== "add_check_in" || action.relatedType !== "life_event" || action.relatedRef !== eventRef) return false;
      const text = actionText(action);
      return category.pattern.test(text) && !containsMultipleTravelPrepCategories(text);
    });
    if (exists) return;
    actions = [
      ...actions,
      {
        type: "add_check_in",
        title: category.title,
        question: category.question,
        relatedType: "life_event",
        relatedRef: eventRef
      }
    ];
  });

  return { ...interpretation, actions };
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
  let next = splitCombinedTravelPrepCheckIns(interpretation);
  next = applyRoutineGoalPolicy(rawText, next, trace);
  next = applyShoppingPolicy(rawText, next, trace);
  next = applyTravelPolicy(rawText, next, trace);
  next = ensureMentionedTravelPrepCheckIns(rawText, next);
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
