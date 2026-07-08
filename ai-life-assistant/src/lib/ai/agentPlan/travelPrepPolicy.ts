import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { ensureActionRef } from "./actionRefs";
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

export function applyTravelPrepPolicy(rawText: string, interpretation: AiInterpretation) {
  return ensureMentionedTravelPrepCheckIns(rawText, splitCombinedTravelPrepCheckIns(interpretation));
}
