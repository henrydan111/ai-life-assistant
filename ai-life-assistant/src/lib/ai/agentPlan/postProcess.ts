import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import type { AssistantCheckIn, AssistantState } from "@/types/domain";
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

function isExplicitRecentSleepGoal(rawText: string) {
  if (!rawHasRecurringSleepGoal(rawText) || !/(最近|近期|这段时间)/.test(rawText)) return false;
  return resolveRecurringSleepTarget(rawText).ambiguity === "none";
}

function isRedundantRoutineScopeCheckIn(action: InterpretAction) {
  return (
    action.type === "add_check_in" &&
    action.relatedType === "routine_goal" &&
    (action.clarification?.slot === "routine_goal_scope" ||
      /(对吗|是否.*(设置|记录|保存)|确认.*(目标内容|日常目标)|短期|长期|试一段时间|持续多久|生效范围|范围)/.test(actionText(action)))
  );
}

function segmentMentioning(rawText: string, pattern: RegExp) {
  return rawText.split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/).find((segment) => pattern.test(segment)) ?? rawText;
}

function hasExplicitReminderTime(rawText: string, pattern: RegExp) {
  const segment = segmentMentioning(rawText, pattern);
  return /(今天|明天|后天|今晚|明早|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：))/.test(segment);
}

function rawHasCoarseWeekendTravel(rawText: string) {
  if (!/(周末|本周末|这周末)/.test(rawText) || !/(去|出行|旅行|出差|计划)/.test(rawText)) return false;
  const segment = segmentMentioning(rawText, /周末|本周末|这周末|去|出行|旅行|出差|计划/);
  return !/(周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|上午|中午|下午|晚上|凌晨|\d{1,2}\s*(?:点|:|：)|20\d{2})/.test(
    segment.replace(/(本|这)?周末/g, "")
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
  existingPattern: RegExp,
  clarification?: AssistantCheckIn["clarification"]
): InterpretAction[] {
  const exists = actions.some(
    (action) => {
      if (action.type !== "add_check_in" || action.relatedType !== "routine_goal" || action.relatedRef !== ref) return false;
      if (clarification && action.clarification?.slot === clarification.slot) return true;
      const isLegacyMatch = !action.clarification && (action.question === question || existingPattern.test(actionText(action)));
      if (clarification?.slot === "routine_goal_scope" && isRedundantRoutineScopeCheckIn(action)) return false;
      return isLegacyMatch;
    }
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
    relatedRef: ref,
    clarification
  };
  return [...actions, checkIn];
}

function removeRedundantRoutineScopeCheckIns(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  if (!isExplicitRecentSleepGoal(rawText)) return interpretation;
  const actions = interpretation.actions.filter((action) => {
    if (!isRedundantRoutineScopeCheckIn(action)) return true;
    trace.push({
      rule: "clarification.repair.remove_redundant_routine_scope_question",
      severity: "repair",
      before: action,
      reason: "The user already supplied an explicit recent routine goal, so asking whether it is short-term or long-term adds friction."
    });
    return false;
  });
  return actions.length === interpretation.actions.length ? interpretation : { ...interpretation, actions };
}

function removeUnsupportedMilkReminderTimes(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  if (!/牛奶/.test(rawText) || !/(买|需要|没有|没了|缺|快没了|提醒)/.test(rawText) || hasExplicitReminderTime(rawText, /牛奶/)) {
    return interpretation;
  }

  const actions = interpretation.actions.map((action) => {
    if (action.type === "add_task" && /牛奶/.test(actionText(action)) && action.dueAt) {
      const repaired = { ...action, dueAt: undefined };
      trace.push({
        rule: "temporal.repair.remove_unsupported_milk_due_at",
        severity: "repair",
        before: action,
        after: repaired,
        reason: "The user asked to remember buying milk but did not provide a reminder time."
      });
      return repaired;
    }
    if (action.type === "add_shopping_item" && /牛奶/.test(action.itemName) && action.dueAt) {
      const repaired = { ...action, dueAt: undefined };
      trace.push({
        rule: "temporal.repair.remove_unsupported_milk_shopping_due_at",
        severity: "repair",
        before: action,
        after: repaired,
        reason: "The user asked to remember buying milk but did not provide a reminder time."
      });
      return repaired;
    }
    return action;
  });

  return { ...interpretation, actions };
}

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

  const location = event.location ?? (event.title.replace(/^.*去/, "") || "目的地");
  actions = ensureCoarseWeekendTravelCheckIn(actions, eventRef, location);
  return { ...interpretation, actions };
}

function hasUnsafeMilkReminderQuestion(rawText: string, question: string) {
  return /牛奶/.test(rawText) && !hasExplicitReminderTime(rawText, /牛奶/) && /(明天中午|明天.*中午|中午.*牛奶|牛奶.*中午)/.test(question);
}

function hasUnsafeCoarseWeekendTravelQuestion(rawText: string, question: string) {
  return rawHasCoarseWeekendTravel(rawText) && /(202\d|20\d{2}|周日|星期日|周天|星期天|下午\s*2\s*点|14:00|明天中午)/.test(question);
}

function safeClarificationQuestions(actions: InterpretAction[]) {
  return actions
    .filter((action): action is Extract<InterpretAction, { type: "add_check_in" }> => action.type === "add_check_in")
    .map((action) => action.question)
    .filter((question) => question && !/(确认日常目标|你要设置的日常目标|长期保持|试一段时间|短期目标还是长期目标|明天中午|周日下午2点|14:00)/.test(question));
}

function sanitizeFeedbackQuestion(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]): AiInterpretation {
  const question = interpretation.feedback.question;
  if (!question) return interpretation;

  const unsafe =
    (isExplicitRecentSleepGoal(rawText) && isRedundantRoutineScopeCheckIn({
      type: "add_check_in",
      title: "feedback",
      question,
      relatedType: "routine_goal",
      relatedRef: "feedback"
    })) ||
    hasUnsafeMilkReminderQuestion(rawText, question) ||
    hasUnsafeCoarseWeekendTravelQuestion(rawText, question);
  if (!unsafe) return interpretation;

  const [replacement] = safeClarificationQuestions(interpretation.actions);
  const feedback = {
    ...interpretation.feedback,
    question: replacement
  };
  trace.push({
    rule: "feedback.repair.remove_unsafe_default_confirmation",
    severity: "repair",
    before: { question },
    after: replacement ? { question: replacement } : { question: undefined },
    reason: "Feedback should not ask the user to confirm invented defaults or restate explicit routine goals."
  });
  return { ...interpretation, feedback };
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
        /(中午|午夜|晚上|半夜|12点|十二点)/,
        { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
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
      /(中午|午夜|晚上|半夜|12点|十二点)/,
      { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
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
  next = removeRedundantRoutineScopeCheckIns(rawText, next, trace);
  next = removeUnsupportedMilkReminderTimes(rawText, next, trace);
  next = removeUnsupportedCoarseWeekendTravelTimes(rawText, next, trace);
  next = ensureMentionedTravelDraft(rawText, next);
  next = ensureMentionedTravelPrepCheckIns(rawText, next);
  next = ensureLeaveBossCheckIn(rawText, next);
  next = repairExistingRelatedRefs(state, next);
  next = sanitizeFeedbackQuestion(rawText, next, trace);
  return {
    interpretation: {
      ...next,
      planTrace: trace
    },
    trace
  };
}
