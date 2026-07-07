import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { applyRoutineGoalPolicy } from "@/lib/ai/productCompiler/policies/routineGoalPolicy";
import { applyShoppingPolicy } from "@/lib/ai/productCompiler/policies/shoppingPolicy";
import { repairFeedbackCopy } from "@/lib/ai/productCompiler/responseRepair";
import type { AssistantState } from "@/types/domain";
import { actionText } from "./actionText";
import { actionRefs, ensureActionRef } from "./actionRefs";
import type { PlanTrace } from "./types";
import {
  containsMultipleTravelPrepCategories,
  ensureMentionedTravelDraft,
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

function segmentMentioning(rawText: string, pattern: RegExp) {
  return rawText.split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/).find((segment) => pattern.test(segment)) ?? rawText;
}

function rawHasCoarseWeekendTravel(rawText: string) {
  if (!/(周末|本周末|这周末)/.test(rawText) || !/(去|出行|旅行|出差|计划)/.test(rawText)) return false;
  const segment = segmentMentioning(rawText, /周末|本周末|这周末|去|出行|旅行|出差|计划/);
  return !/(周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：)|20\d{2})/.test(
    segment.replace(/(本|这)?周末/g, "")
  );
}

const unsafeCoarseWeekendTravelTimePattern =
  /(202\d|20\d{2}|(?:\d{1,2}|[一二三四五六七八九十]{1,3})月(?:\d{1,2}|[一二三四五六七八九十]{1,3})[日号]|本?周日|星期日|周天|星期天|下午\s*(?:2|二|两)\s*点(?:半|三十)?|14\s*(?::|：|点)\s*(?:00|30|半)?|明天\s*(?:中午|12\s*点|十二点))/;

function ensureCoarseWeekendTravelCheckIn(actions: InterpretAction[], eventRef: string, location: string) {
  const exists = actions.some(
    (action) =>
      action.type === "add_check_in" &&
      action.relatedType === "life_event" &&
      action.relatedRef === eventRef &&
      /(具体|哪天|几点|什么时候|出发|出行时间)/.test(actionText(action))
  );
  if (exists) return actions;
  const checkIn: InterpretAction = {
    type: "add_check_in",
    title: "确认出行时间",
    question: `这周末去${location}，具体是哪天、几点出发？`,
    relatedType: "life_event",
    relatedRef: eventRef,
    clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" }
  };
  return [...actions, checkIn];
}

function removeUnsupportedCoarseWeekendTravelTimes(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  if (!rawHasCoarseWeekendTravel(rawText)) return interpretation;

  let actions = interpretation.actions;
  const eventIndex = actions.findIndex((action) => action.type === "add_life_event" && /(上海|去|出行|旅行|周末)/.test(actionText(action)));
  if (eventIndex === -1) return interpretation;

  const withRef = ensureActionRef(actions, eventIndex, "weekend_travel_event");
  actions = withRef.actions;
  const event = actions[eventIndex];
  const eventRef = withRef.ref;
  if (event?.type !== "add_life_event" || !eventRef) return { ...interpretation, actions };

  if (event.startsAt || event.endsAt) {
    const repaired: InterpretAction = { ...event, startsAt: undefined, endsAt: undefined };
    trace.push({
      rule: "temporal.repair.remove_unsupported_weekend_travel_time",
      severity: "repair",
      before: event,
      after: repaired,
      reason: "The user gave only a coarse weekend travel window, not a specific day or time."
    });
    actions = actions.map((action, index) => (index === eventIndex ? repaired : action));
  }

  actions = actions.filter((action) => {
    if (action.type !== "add_check_in" || action.relatedType !== "life_event") return true;
    if (action.relatedRef !== eventRef && !/(上海|周末|出行|旅行)/.test(actionText(action))) return true;
    if (!unsafeCoarseWeekendTravelTimePattern.test(actionText(action))) return true;
    trace.push({
      rule: "temporal.repair.remove_unsupported_weekend_travel_check_in_time",
      severity: "repair",
      before: action,
      reason: "The user gave only a coarse weekend travel window, so confirmation copy must not include an invented concrete day or time."
    });
    return false;
  });

  const location = event.location ?? (event.title.replace(/^.*去/, "") || "目的地");
  actions = ensureCoarseWeekendTravelCheckIn(actions, eventRef, location);
  return { ...interpretation, actions };
}

function hasUnsafeCoarseWeekendTravelText(rawText: string, text: string) {
  return rawHasCoarseWeekendTravel(rawText) && unsafeCoarseWeekendTravelTimePattern.test(text);
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
  next = removeUnsupportedCoarseWeekendTravelTimes(rawText, next, trace);
  next = ensureMentionedTravelDraft(rawText, next);
  next = ensureMentionedTravelPrepCheckIns(rawText, next);
  next = ensureLeaveBossCheckIn(rawText, next);
  next = repairExistingRelatedRefs(state, next);
  next = repairFeedbackCopy(rawText, next, trace, { hasUnsafeCoarseWeekendTravelText });
  return {
    interpretation: {
      ...next,
      planTrace: trace
    },
    trace
  };
}
