import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { actionText } from "@/lib/ai/agentPlan/actionText";
import { ensureActionRef, uniqueRef } from "@/lib/ai/agentPlan/actionRefs";
import { rawHasRecurringSleepGoal, resolveRecurringSleepTarget } from "@/lib/ai/agentPlan/temporalPolicy";
import type { PlanTrace } from "@/lib/ai/agentPlan/types";
import type { AssistantCheckIn } from "@/types/domain";

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

export function isExplicitRecentSleepGoal(rawText: string) {
  if (!rawHasRecurringSleepGoal(rawText) || !/(最近|近期|这段时间)/.test(rawText)) return false;
  return resolveRecurringSleepTarget(rawText).ambiguity === "none";
}

export function isRedundantRoutineScopeCheckIn(action: InterpretAction) {
  return (
    action.type === "add_check_in" &&
    action.relatedType === "routine_goal" &&
    (action.clarification?.slot === "routine_goal_scope" ||
      /(对吗|是否.*(设置|记录|保存)|确认.*(目标内容|日常目标)|短期|长期|试一段时间|持续多久|生效范围|范围)/.test(actionText(action)))
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
  const exists = actions.some((action) => {
    if (action.type !== "add_check_in" || action.relatedType !== "routine_goal" || action.relatedRef !== ref) return false;
    if (clarification && action.clarification?.slot === clarification.slot) return true;
    const isLegacyMatch = !action.clarification && (action.question === question || existingPattern.test(actionText(action)));
    if (clarification?.slot === "routine_goal_scope" && isRedundantRoutineScopeCheckIn(action)) return false;
    return isLegacyMatch;
  });
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

export function applyRoutineGoalPolicy(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]) {
  const withRoutineGoal = ensureRecurringSleepGoal(rawText, interpretation, trace);
  return removeRedundantRoutineScopeCheckIns(rawText, withRoutineGoal, trace);
}
