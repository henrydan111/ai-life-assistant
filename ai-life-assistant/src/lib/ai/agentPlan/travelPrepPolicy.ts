import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { actionText } from "./actionText";

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
  if (first.relatedRef || second.relatedRef) return first.relatedRef === second.relatedRef;
  if (first.relatedId || second.relatedId) return first.relatedId === second.relatedId;
  return first.relatedType === second.relatedType;
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
      const hasExistingSeparate = interpretation.actions.some((other) => {
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

function mentionedTravelLocation(rawText: string) {
  const knownCity = rawText.match(/(?:去|出差去|旅行去|出行去)(苏州|上海|北京|杭州|南京|深圳|广州|成都|重庆|西安|武汉|长沙|厦门|青岛|天津|香港|澳门|台北)/);
  if (knownCity?.[1]) return knownCity[1];
  const english = rawText.match(/\b(?:go to|travel to|trip to|visit)\s+([A-Z][a-zA-Z\s-]{1,30})/);
  return english?.[1]?.trim();
}

function uniqueRef(actions: InterpretAction[], base: string) {
  const refs = new Set(
    actions.flatMap((action) => ("ref" in action && action.ref ? [action.ref] : []))
  );
  if (!refs.has(base)) return base;
  let index = 2;
  while (refs.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

export function ensureMentionedTravelDraft(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  const location = mentionedTravelLocation(rawText);
  if (!location) return interpretation;
  if (interpretation.actions.some((action) => actionText(action).includes(location))) return interpretation;

  const ref = uniqueRef(interpretation.actions, "travel_draft");
  return {
    ...interpretation,
    actions: [
      {
        type: "add_life_event",
        ref,
        title: /[\u4e00-\u9fa5]/.test(location) ? `去${location}` : `Trip to ${location}`,
        category: "travel",
        location,
        priority: "medium"
      },
      {
        type: "add_check_in",
        title: /[\u4e00-\u9fa5]/.test(location) ? "确认出行时间" : "Confirm trip date",
        question: /[\u4e00-\u9fa5]/.test(location) ? `你打算哪天去${location}？` : `When are you planning to go to ${location}?`,
        relatedType: "life_event",
        relatedRef: ref
      },
      ...interpretation.actions
    ]
  };
}
