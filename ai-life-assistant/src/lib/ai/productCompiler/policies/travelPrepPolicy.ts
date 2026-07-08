import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { ensureActionRef } from "@/lib/ai/agentPlan/actionRefs";
import { actionText } from "@/lib/ai/agentPlan/actionText";

const travelPrepCategories = [
  {
    key: "ticket",
    pattern: /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返/,
    title: "确认高铁票",
    question: "高铁票订好了吗？"
  },
  {
    key: "luggage",
    pattern: /行李|收拾/,
    title: "收拾行李",
    question: "行李收拾好了吗？"
  },
  {
    key: "restaurant",
    pattern: /餐馆|餐厅|饭店|餐位|订位|定位置|订位置|定座|订座|定座位|订座位/,
    title: "预订餐馆位置",
    question: "餐馆位置订好了吗？"
  }
] as const;

export function travelPrepCategoriesIn(text: string) {
  return travelPrepCategories.filter((category) => category.pattern.test(text));
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

function ensureMentionedTravelPrepCheckIns(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  const categories = travelPrepCategoriesIn(rawText);
  if (!categories.length) return interpretation;

  let actions = interpretation.actions;
  const eventIndex = travelEventIndexForPrep(rawText, actions);
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
        relatedRef: eventRef
      }
    ];
  });

  return { ...interpretation, actions };
}

export function applyTravelPrepPolicy(rawText: string, interpretation: AiInterpretation) {
  return ensureMentionedTravelPrepCheckIns(rawText, splitCombinedTravelPrepCheckIns(interpretation));
}
