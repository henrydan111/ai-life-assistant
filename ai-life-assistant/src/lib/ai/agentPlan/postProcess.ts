import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import type { AssistantState } from "@/types/domain";
import { actionText } from "./actionText";
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

function rawHasRecurringSleepGoal(rawText: string) {
  return /(每天|每日|天天|每晚|daily|every day|every night)/i.test(rawText) && /(睡觉|睡|上床|休息)/.test(rawText);
}

function sleepTargetTime(rawText: string) {
  if (/(半夜|午夜|零点|0点|24点|二十四点)/.test(rawText)) return "00:00";
  const match = rawText.match(/(\d{1,2}|十[一二]?|十二|二十[一二三]?|二十四)\s*点\s*前/);
  if (!match) return undefined;
  const value = match[1];
  const hour =
    value === "十二"
      ? 12
      : value === "十一"
        ? 11
        : value === "二十四"
          ? 24
          : value.startsWith("二十")
            ? 20 + (value.endsWith("一") ? 1 : value.endsWith("二") ? 2 : value.endsWith("三") ? 3 : 0)
            : Number(value);
  if (!Number.isFinite(hour)) return undefined;
  return `${String(hour % 24).padStart(2, "0")}:00`;
}

function ensureRecurringSleepGoal(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  if (!rawHasRecurringSleepGoal(rawText)) return interpretation;
  const isRecent = /最近|近期|这段时间/.test(rawText);
  const targetTime = sleepTargetTime(rawText);
  const existingIndex = interpretation.actions.findIndex(
    (action) => action.type === "add_routine_goal" && /(睡觉|睡|上床|休息)/.test(actionText(action))
  );

  if (existingIndex >= 0) {
    let actions = interpretation.actions.map((action, index) => {
      if (index !== existingIndex || action.type !== "add_routine_goal") return action;
      const normalized: Extract<InterpretAction, { type: "add_routine_goal" }> = {
        ...action,
        cadence: "daily",
        targetTime: action.targetTime ?? targetTime,
        targetTimeRelation: action.targetTimeRelation ?? (targetTime ? "before" : undefined),
        scope: isRecent && (!action.scope || action.scope === "unspecified") ? "recent" : action.scope,
        scopeLabel: isRecent ? "最近" : action.scopeLabel
      };
      return normalized;
    });

    if (isRecent) {
      const withRef = ensureActionRef(actions, existingIndex, "sleep_routine");
      actions = withRef.actions;
      const ref = withRef.ref;
      const hasScopeCheckIn =
        ref &&
        actions.some(
          (action) =>
            action.type === "add_check_in" &&
            action.relatedType === "routine_goal" &&
            action.relatedRef === ref &&
            /(从今天|开始|试|多久|持续|长期|最近|范围)/.test(actionText(action))
        );
      if (ref && !hasScopeCheckIn) {
        actions.push({
          type: "add_check_in",
          title: "确认睡眠目标范围",
          question: "这个睡眠目标你想从今天开始执行，还是先试一段时间？",
          relatedType: "routine_goal",
          relatedRef: ref
        });
      }
    }

    return { ...interpretation, actions };
  }

  let actions = interpretation.actions;
  const ref = uniqueRef(actions, "sleep_routine");
  actions = [
    {
      type: "add_routine_goal",
      ref,
      title: targetTime ? `每天 ${targetTime} 前睡觉` : "每天按时睡觉",
      cadence: "daily",
      targetTime,
      targetTimeRelation: targetTime ? "before" : undefined,
      scope: isRecent ? "recent" : "ongoing",
      scopeLabel: isRecent ? "最近" : undefined,
      priority: "medium"
    },
    ...actions
  ];

  if (isRecent) {
    actions.push({
      type: "add_check_in",
      title: "确认睡眠目标范围",
      question: "这个睡眠目标你想从今天开始执行，还是先试一段时间？",
      relatedType: "routine_goal",
      relatedRef: ref
    });
  }

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
  let next = splitCombinedTravelPrepCheckIns(interpretation);
  next = ensureRecurringSleepGoal(rawText, next);
  next = ensureMentionedTravelDraft(rawText, next);
  next = ensureMentionedTravelPrepCheckIns(rawText, next);
  next = ensureLeaveBossCheckIn(rawText, next);
  next = repairExistingRelatedRefs(state, next);
  return next;
}
