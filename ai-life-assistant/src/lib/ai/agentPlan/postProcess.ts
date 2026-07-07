import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import type { AssistantState } from "@/types/domain";
import { actionText } from "./actionText";
import { rawHasRecurringSleepGoal, resolveRecurringSleepTarget } from "./temporalPolicy";
import type { PlanTrace } from "./types";
import {
  containsMultipleTravelPrepCategories,
  ensureMentionedTravelDraft,
  splitCombinedTravelPrepCheckIns,
  travelPrepCategoriesIn
} from "./travelPrepPolicy";

function uniqueRef(actions: InterpretAction[], base: string) {
  const refs = new Set(actions.flatMap((action) => ("ref" in action && action.ref ? [action.ref] : [])));
  if (!refs.has(base)) return base;
  let index = 2;
  while (refs.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function ensureActionRef(actions: InterpretAction[], index: number, base: string) {
  const action = actions[index];
  if (
    !action ||
    (action.type !== "add_task" &&
      action.type !== "add_life_event" &&
      action.type !== "add_shopping_item" &&
      action.type !== "add_routine_goal")
  ) {
    return { actions, ref: undefined };
  }
  if (action.ref) return { actions, ref: action.ref };

  const ref = uniqueRef(actions, base);
  return {
    actions: actions.map((item, itemIndex) => (itemIndex === index ? ({ ...item, ref } as InterpretAction) : item)),
    ref
  };
}

function actionRefs(actions: InterpretAction[]) {
  return new Set(actions.flatMap((action) => ("ref" in action && action.ref ? [action.ref] : [])));
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

function isSleepGoalTask(action: InterpretAction) {
  return action.type === "add_task" && /(睡觉|上床|入睡|休息)/.test(actionText(action));
}

function isRecurringSleepTask(action: InterpretAction) {
  return (
    isSleepGoalTask(action) &&
    /(每天|每日|天天|每晚|daily|every day|every night)/i.test(actionText(action)) &&
    /(睡觉|上床|入睡|休息)/.test(actionText(action))
  );
}

function removeDuplicateRecurringSleepTasks(actions: InterpretAction[], trace: PlanTrace[], removeAnySleepTask = false) {
  return actions.filter((action) => {
    if (!(removeAnySleepTask ? isSleepGoalTask(action) : isRecurringSleepTask(action))) return true;
    trace.push({
      rule: "routine.repair.remove_duplicate_task",
      severity: "repair",
      before: action,
      reason: removeAnySleepTask
        ? "Raw input is already represented as a recurring sleep RoutineGoal, so a parallel sleep Task would duplicate the goal."
        : "Recurring sleep goals should be represented as RoutineGoal, not as a one-time Task."
    });
    return false;
  });
}

function ensureRoutineCheckIn(
  actions: InterpretAction[],
  ref: string,
  title: string,
  question: string,
  trace: PlanTrace[],
  rule: string,
  existingPattern: RegExp
): InterpretAction[] {
  const exists = actions.some(
    (action) =>
      action.type === "add_check_in" &&
      action.relatedType === "routine_goal" &&
      action.relatedRef === ref &&
      (action.question === question || existingPattern.test(actionText(action)))
  );
  if (exists) return actions;

  trace.push({
    rule,
    severity: "clarification",
    after: { title, question, relatedType: "routine_goal", relatedRef: ref },
    reason: "Routine goal has a safe-to-save missing slot that should be clarified instead of guessed."
  });
  const checkIn: InterpretAction = {
    type: "add_check_in",
    title,
    question,
    relatedType: "routine_goal",
    relatedRef: ref
  };
  return [...actions, checkIn];
}

function normalizeRoutineGoalAction(
  rawText: string,
  action: Extract<InterpretAction, { type: "add_routine_goal" }>,
  trace: PlanTrace[]
): Extract<InterpretAction, { type: "add_routine_goal" }> {
  const resolution = resolveRecurringSleepTarget(rawText);
  const isRecent = /最近|近期|这段时间/.test(rawText);
  let normalized: Extract<InterpretAction, { type: "add_routine_goal" }> = {
    ...action,
    cadence: "daily",
    targetTime: resolution.ambiguity === "ampm" ? undefined : (resolution.targetTime ?? action.targetTime),
    targetTimeRelation:
      resolution.ambiguity === "ampm" ? undefined : (resolution.targetTimeRelation ?? action.targetTimeRelation),
    scope: isRecent && (!action.scope || action.scope === "unspecified") ? "recent" : action.scope,
    scopeLabel: isRecent ? "最近" : action.scopeLabel
  };

  if (resolution.evidence === "explicit_midnight" && action.targetTime && action.targetTime !== "00:00") {
    trace.push({
      rule: "temporal.sleep.explicit_midnight_repair",
      severity: "repair",
      sourceQuote: resolution.sourceQuote,
      before: { targetTime: action.targetTime },
      after: { targetTime: "00:00" },
      reason: "Raw text explicitly points to midnight or 24:00."
    });
    normalized = {
      ...normalized,
      targetTime: "00:00",
      targetTimeRelation: resolution.targetTimeRelation ?? action.targetTimeRelation ?? "before"
    };
  }

  if (resolution.ambiguity === "ampm" && action.targetTime) {
    trace.push({
      rule: "temporal.sleep.bare_12_requires_clarification",
      severity: "clarification",
      sourceQuote: resolution.sourceQuote,
      before: { targetTime: action.targetTime },
      after: { targetTime: undefined },
      reason: "Bare sleep time '12点前' should not be silently saved as noon or midnight."
    });
  }

  return normalized;
}

function ensureRecurringSleepGoal(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  if (!rawHasRecurringSleepGoal(rawText)) return interpretation;
  const isRecent = /最近|近期|这段时间/.test(rawText);
  const resolution = resolveRecurringSleepTarget(rawText);
  const existingIndex = interpretation.actions.findIndex(
    (action) => action.type === "add_routine_goal" && /(睡觉|睡|上床|休息)/.test(actionText(action))
  );

  if (existingIndex >= 0) {
    let actions = interpretation.actions.map((action, index) => {
      if (index !== existingIndex || action.type !== "add_routine_goal") return action;
      return normalizeRoutineGoalAction(rawText, action, trace);
    });

    const withRef = ensureActionRef(actions, existingIndex, "sleep_routine");
    actions = withRef.actions;
    const ref = withRef.ref;
    if (ref && resolution.ambiguity === "ampm") {
      actions = ensureRoutineCheckIn(
        actions,
        ref,
        "确认睡眠目标时间",
        resolution.question ?? "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
        trace,
        "clarification.compiler.create_sleep_time_question",
        /(中午|午夜|晚上|半夜|12点|十二点)/
      );
    }
    if (ref && isRecent) {
      actions = ensureRoutineCheckIn(
        actions,
        ref,
        "确认睡眠目标范围",
        "这个睡眠目标你想先从今天开始试一段时间，还是长期保持？",
        trace,
        "clarification.compiler.create_sleep_scope_question",
        /(最近|近期|这段时间|长期|多久|持续|范围|试|保持)/
      );
    }

    actions = removeDuplicateRecurringSleepTasks(actions, trace, Boolean(ref));
    return { ...interpretation, actions };
  }

  let actions = interpretation.actions;
  const ref = uniqueRef(actions, "sleep_routine");
  const targetTime = resolution.ambiguity === "ampm" ? undefined : resolution.targetTime;
  actions = [
    {
      type: "add_routine_goal",
      ref,
      title: targetTime ? `每天 ${targetTime} 前睡觉` : "每天按时睡觉",
      cadence: "daily",
      targetTime,
      targetTimeRelation: targetTime ? (resolution.targetTimeRelation ?? "before") : undefined,
      scope: isRecent ? "recent" : "ongoing",
      scopeLabel: isRecent ? "最近" : undefined,
      priority: "medium"
    },
    ...actions
  ];
  trace.push({
    rule: "routine.compiler.create_goal",
    severity: "info",
    sourceQuote: rawText,
    after: actions[0],
    reason: "Raw text contains a recurring sleep goal that should be represented as a RoutineGoal."
  });

  if (resolution.ambiguity === "ampm") {
    actions = ensureRoutineCheckIn(
      actions,
      ref,
      "确认睡眠目标时间",
      resolution.question ?? "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
      trace,
      "clarification.compiler.create_sleep_time_question",
      /(中午|午夜|晚上|半夜|12点|十二点)/
    );
  }
  if (isRecent) {
    actions = ensureRoutineCheckIn(
      actions,
      ref,
      "确认睡眠目标范围",
      "这个睡眠目标你想先从今天开始试一段时间，还是长期保持？",
      trace,
      "clarification.compiler.create_sleep_scope_question",
      /(最近|近期|这段时间|长期|多久|持续|范围|试|保持)/
    );
  }

  actions = removeDuplicateRecurringSleepTasks(actions, trace, true);
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
  next = ensureRecurringSleepGoal(rawText, next, trace);
  next = ensureMentionedTravelDraft(rawText, next);
  next = ensureMentionedTravelPrepCheckIns(rawText, next);
  next = ensureLeaveBossCheckIn(rawText, next);
  next = repairExistingRelatedRefs(state, next);
  return {
    interpretation: {
      ...next,
      planTrace: trace
    },
    trace
  };
}
