import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { ensureActionRef } from "@/lib/ai/agentPlan/actionRefs";
import { actionText } from "@/lib/ai/agentPlan/actionText";
import type { PlanTrace } from "@/lib/ai/agentPlan/types";

const travelPrepCategories = [
  {
    key: "ticket",
    pattern: /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返/,
    label: "订票",
    title: "确认高铁票",
    question: "高铁票订好了吗？"
  },
  {
    key: "luggage",
    pattern: /行李|收拾/,
    label: "行李",
    title: "收拾行李",
    question: "行李收拾好了吗？"
  },
  {
    key: "restaurant",
    pattern: /餐馆|餐厅|饭店|餐位|订位|定位置|订位置|定座|订座|定座位|订座位/,
    label: "餐馆预订",
    title: "预订餐馆位置",
    question: "餐馆位置订好了吗？"
  },
  {
    key: "hotel",
    pattern: /酒店|宾馆|住宿|住处|订房|订酒店|定酒店|预订酒店|房间/,
    label: "酒店预订",
    title: "预订酒店",
    question: "酒店订好了吗？"
  }
] as const;

export function travelPrepCategoriesIn(text: string) {
  return travelPrepCategories.filter((category) => category.pattern.test(text));
}

export function isTravelPrepCheckInText(text: string) {
  return travelPrepCategoriesIn(text).length > 0;
}

export function containsMultipleTravelPrepCategories(text: string) {
  return travelPrepCategoriesIn(text).length > 1;
}

export function hasSeparateTravelPrepCheckIn(actions: InterpretAction[], pattern: RegExp) {
  return actions.some((action) => {
    if (action.type !== "add_check_in" || action.relatedType !== "life_event") return false;
    const text = actionText(action);
    return pattern.test(text) && !containsMultipleTravelPrepCategories(text);
  });
}

function sameRelatedAnchor(
  first: Extract<InterpretAction, { type: "add_check_in" }>,
  second: Extract<InterpretAction, { type: "add_check_in" }>
) {
  const firstAnchor = first.relatedRef ?? first.relatedId;
  const secondAnchor = second.relatedRef ?? second.relatedId;
  if (firstAnchor || secondAnchor) return firstAnchor === secondAnchor;
  return first.relatedType === second.relatedType;
}

function travelEventCandidateIndices(actions: InterpretAction[]) {
  return actions.flatMap((action, index) => {
    if (action.type !== "add_life_event") return [];
    if (action.category !== "travel" && !/去|出行|旅行|上海|苏州/.test(actionText(action))) return [];
    return [index];
  });
}

function knownDestinationTokens(action: Extract<InterpretAction, { type: "add_life_event" }>) {
  const text = actionText(action);
  return [
    action.location,
    ...["上海", "苏州", "北京", "杭州", "南京", "深圳", "广州", "成都", "重庆", "西安", "武汉", "长沙", "厦门", "青岛", "天津", "香港", "澳门", "台北", "宁波", "无锡", "合肥", "郑州", "昆明", "东京", "新加坡"].filter(
      (destination) => text.includes(destination)
    )
  ].filter((value): value is string => Boolean(value?.trim()));
}

function travelEventMatchesRawText(rawText: string, action: Extract<InterpretAction, { type: "add_life_event" }>) {
  return knownDestinationTokens(action).some((destination) => rawText.includes(destination));
}

function travelEventIndexForPrep(rawText: string, actions: InterpretAction[]) {
  const candidateIndices = travelEventCandidateIndices(actions);
  if (candidateIndices.length <= 1) return candidateIndices[0] ?? -1;

  const matched = candidateIndices.filter((index) => {
    const action = actions[index];
    return action.type === "add_life_event" && travelEventMatchesRawText(rawText, action);
  });
  return matched.length === 1 ? matched[0] : -1;
}

function hasAmbiguousTravelPrepTarget(rawText: string, actions: InterpretAction[]) {
  const candidateIndices = travelEventCandidateIndices(actions);
  if (candidateIndices.length <= 1) return false;
  return travelEventIndexForPrep(rawText, actions) === -1;
}

function prepLabels(categories: ReturnType<typeof travelPrepCategoriesIn>) {
  return categories.map((category) => category.label).join("、");
}

export function travelPrepAskAtBefore(startsAt?: string) {
  if (!startsAt) return undefined;
  const start = new Date(startsAt);
  if (!Number.isFinite(start.getTime())) return undefined;
  const now = new Date();
  const oneDayBefore = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  return (oneDayBefore.getTime() > now.getTime() ? oneDayBefore : now).toISOString();
}

function ensureTravelPrepTargetClarification(
  rawText: string,
  interpretation: AiInterpretation,
  categories: ReturnType<typeof travelPrepCategoriesIn>,
  trace?: PlanTrace[]
): AiInterpretation {
  const question = `你想把${prepLabels(categories)}提醒挂到哪次出行？`;
  const exists = interpretation.actions.some(
    (action) =>
      action.type === "add_check_in" &&
      action.relatedType === "project" &&
      /(哪次出行|哪个行程|挂到哪次)/.test(actionText(action))
  );
  if (exists) return interpretation;

  const next: AiInterpretation = {
    ...interpretation,
    feedback: {
      ...interpretation.feedback,
      title: "需要确认出行准备",
      detail: `我看到了${prepLabels(categories)}提醒，但现在有多个出行安排；我还没把它挂到具体行程，避免记错。`,
      question
    },
    actions: [
      ...interpretation.actions,
      {
        type: "add_check_in",
        title: "确认出行准备归属",
        question,
        relatedType: "project"
      }
    ]
  };

  trace?.push({
    rule: "travel_prep.clarification.ambiguous_travel_event",
    severity: "clarification",
    sourceQuote: rawText,
    before: interpretation.feedback,
    after: next.feedback,
    reason: "The user asked for travel prep while multiple travel events are present, so the assistant must ask which trip to attach it to instead of guessing."
  });
  return next;
}

export function splitCombinedTravelPrepCheckIns(interpretation: AiInterpretation): AiInterpretation {
  const actions: InterpretAction[] = [];

  for (const action of interpretation.actions) {
    if (action.type !== "add_check_in" || action.relatedType !== "life_event") {
      actions.push(action);
      continue;
    }

    const categories = travelPrepCategoriesIn(actionText(action));
    if (categories.length <= 1) {
      actions.push(action);
      continue;
    }

    categories.forEach((category) => {
      const hasExistingSeparate = [...interpretation.actions, ...actions].some((other) => {
        if (other === action || other.type !== "add_check_in" || other.relatedType !== "life_event") return false;
        const text = actionText(other);
        return sameRelatedAnchor(action, other) && category.pattern.test(text) && !containsMultipleTravelPrepCategories(text);
      });
      if (hasExistingSeparate) return;
      actions.push({
        type: "add_check_in",
        title: category.title,
        question: category.question,
        relatedType: action.relatedType,
        relatedRef: action.relatedRef,
        relatedId: action.relatedId,
        askAt: action.askAt
      });
    });
  }

  return { ...interpretation, actions };
}

function eventStartsByRef(actions: InterpretAction[]) {
  const starts = new Map<string, string>();
  actions.forEach((action) => {
    if (action.type === "add_life_event" && action.ref && action.startsAt) starts.set(action.ref, action.startsAt);
  });
  return starts;
}

function repairTravelPrepAskAt(interpretation: AiInterpretation, trace?: PlanTrace[]): AiInterpretation {
  const startsByRef = eventStartsByRef(interpretation.actions);
  if (!startsByRef.size) return interpretation;

  return {
    ...interpretation,
    actions: interpretation.actions.map((action) => {
      if (action.type !== "add_check_in" || action.relatedType !== "life_event" || !action.relatedRef) return action;
      if (!isTravelPrepCheckInText(actionText(action))) return action;
      const startsAt = startsByRef.get(action.relatedRef);
      const askAt = travelPrepAskAtBefore(startsAt);
      if (!startsAt || !askAt) return action;
      if (action.askAt && new Date(action.askAt).getTime() < new Date(startsAt).getTime()) return action;
      const repaired = { ...action, askAt };
      trace?.push({
        rule: "travel_prep.repair.ask_at_before_trip",
        severity: "repair",
        before: action,
        after: repaired,
        reason: "Travel prep reminders must happen before departure, not after the trip starts."
      });
      return repaired;
    })
  };
}

function ensureMentionedTravelPrepCheckIns(rawText: string, interpretation: AiInterpretation, trace?: PlanTrace[]): AiInterpretation {
  const categories = travelPrepCategoriesIn(rawText);
  if (!categories.length) return interpretation;

  let actions = interpretation.actions;
  const eventIndex = travelEventIndexForPrep(rawText, actions);
  if (eventIndex === -1 && hasAmbiguousTravelPrepTarget(rawText, actions)) {
    return ensureTravelPrepTargetClarification(rawText, interpretation, categories, trace);
  }
  if (eventIndex === -1) return interpretation;

  const withRef = ensureActionRef(actions, eventIndex, "travel_event");
  actions = withRef.actions;
  const eventRef = withRef.ref;
  if (!eventRef) return { ...interpretation, actions };

  categories.forEach((category) => {
    const exists = actions.some((action) => {
      if (
        action.type !== "add_check_in" ||
        action.relatedType !== "life_event" ||
        (action.relatedRef ?? action.relatedId) !== eventRef
      ) {
        return false;
      }
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
        relatedRef: eventRef,
        askAt: travelPrepAskAtBefore(actions[eventIndex]?.type === "add_life_event" ? actions[eventIndex].startsAt : undefined)
      }
    ];
  });

  return { ...interpretation, actions };
}

export function applyTravelPrepPolicy(rawText: string, interpretation: AiInterpretation, trace?: PlanTrace[]) {
  return repairTravelPrepAskAt(ensureMentionedTravelPrepCheckIns(rawText, splitCombinedTravelPrepCheckIns(interpretation), trace), trace);
}
