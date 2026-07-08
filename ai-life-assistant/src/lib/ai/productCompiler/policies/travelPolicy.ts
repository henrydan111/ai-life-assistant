import type { AiInterpretation, InterpretAction } from "@/lib/ai/interpretation";
import { actionText } from "@/lib/ai/agentPlan/actionText";
import { ensureActionRef, uniqueRef } from "@/lib/ai/agentPlan/actionRefs";
import type { PlanTrace } from "@/lib/ai/agentPlan/types";

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

function mentionedTravelLocation(rawText: string) {
  const knownCity = rawText.match(/(?:去|出差去|旅行去|出行去)(苏州|上海|北京|杭州|南京|深圳|广州|成都|重庆|西安|武汉|长沙|厦门|青岛|天津|香港|澳门|台北|宁波|无锡|合肥|郑州|昆明|东京|新加坡)/);
  if (knownCity?.[1]) return knownCity[1];
  const english = rawText.match(/\b(?:go to|travel to|trip to|visit)\s+([a-zA-Z][a-zA-Z\s-]{1,30})/i);
  return english?.[1]?.trim();
}

function travelTitle(rawText: string, location: string) {
  if (!/[\u4e00-\u9fa5]/.test(location)) return `Trip to ${location}`;
  if (/这周末|本周末|周末/.test(rawText)) return `本周末去${location}`;
  return `去${location}`;
}

function travelDateQuestion(rawText: string, location: string) {
  if (!/[\u4e00-\u9fa5]/.test(location)) return `When are you planning to go to ${location}?`;
  if (/这周末|本周末|周末/.test(rawText)) return `这周末去${location}，具体是哪天、几点出发？`;
  return `你打算哪天去${location}？`;
}

function includesText(text: string, value: string) {
  return text.toLowerCase().includes(value.toLowerCase());
}

function mentionedTravelIsBlocked(rawText: string, location: string) {
  const cancelled = [
    `不去${location}`,
    `取消去${location}`,
    `别记去${location}`,
    `不用记去${location}`,
    `不要记去${location}`,
    `不用记录去${location}`,
    `不要记录去${location}`,
    `不是我去${location}`
  ];
  if (cancelled.some((phrase) => includesText(rawText, phrase))) return true;

  const thirdPartyTravel = new RegExp(`(?:朋友|同事|别人|他|她).{0,8}(?:去|出差去|旅行去|出行去)${location}`);
  const travelingWithUser = new RegExp(`(?:我|我们).{0,6}(?:和|跟|带).{0,8}(?:朋友|同事|他|她).{0,8}(?:去|出差去|旅行去|出行去)${location}`);
  return thirdPartyTravel.test(rawText) && !travelingWithUser.test(rawText);
}

function hasTravelLifeEventForLocation(actions: InterpretAction[], location: string) {
  return actions.some((action) => {
    if (action.type !== "add_life_event") return false;
    return includesText(actionText(action), location);
  });
}

export function ensureMentionedTravelDraft(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  const location = mentionedTravelLocation(rawText);
  if (!location) return interpretation;
  if (mentionedTravelIsBlocked(rawText, location)) return interpretation;
  if (hasTravelLifeEventForLocation(interpretation.actions, location)) return interpretation;

  const ref = uniqueRef(interpretation.actions, "travel_draft");
  return {
    ...interpretation,
    actions: [
      {
        type: "add_life_event",
        ref,
        title: travelTitle(rawText, location),
        category: "travel",
        location,
        priority: "medium"
      },
      {
        type: "add_check_in",
        title: /[\u4e00-\u9fa5]/.test(location) ? "确认出行时间" : "Confirm trip date",
        question: travelDateQuestion(rawText, location),
        relatedType: "life_event",
        relatedRef: ref,
        clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" }
      },
      ...interpretation.actions
    ]
  };
}

export function hasUnsafeCoarseWeekendTravelText(rawText: string, text: string) {
  return rawHasCoarseWeekendTravel(rawText) && unsafeCoarseWeekendTravelTimePattern.test(text);
}

export function applyTravelPolicy(rawText: string, interpretation: AiInterpretation, trace: PlanTrace[]) {
  const withoutUnsupportedTimes = removeUnsupportedCoarseWeekendTravelTimes(rawText, interpretation, trace);
  return ensureMentionedTravelDraft(rawText, withoutUnsupportedTimes);
}
