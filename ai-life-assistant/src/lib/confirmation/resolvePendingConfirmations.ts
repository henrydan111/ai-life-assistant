import { createId } from "@/lib/id";
import { parseDueDate, nowIso } from "@/lib/time/parseTime";
import type { AssistantCheckIn, AssistantState, ParseFeedback, RawInput, TranscriptRepair } from "@/types/domain";

type ResolveOptions = {
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
};

export type PendingConfirmationResolution = {
  state: AssistantState;
  feedback: ParseFeedback;
  unhandledText?: string;
  sourceInputId: string;
};

const timeQuestionPattern = /(时间|哪天|什么时候|几点|日期|开始|出行)/;
const routineScopeQuestionPattern = /(短期|长期|范围|持续|多久|最近|试)/;
const routineTargetTimeQuestionPattern = /(12点|十二点|中午|午夜|半夜|晚上|凌晨|几点|时间)/;
const routineTextPattern = /(睡觉|睡|上床|入睡|休息|作息|早睡)/;
const newIntentConnectorPattern = /(另外|还有|顺便|然后|并且|同时|再帮我|再提醒我)/;
const newIntentCuePattern =
  /\b(buy|get|pick up|order|call|email|text|schedule|book|remind|prepare|finish)\b|买|采购|下单|提醒|帮我|打电话|联系|安排|预约|预订|订|准备|带|发|写|完成|处理|去|见|请假|没了|没有了|用完了|缺|不够/;
const nonConfirmationObjectCuePattern = /(药|方案|项目|妈妈|爸爸|朋友|客户|老板|会议|电话|牛奶|伞|票|餐厅|饭店|文件|邮件)/;

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[，。,.!?！？；;]/g, " ");
}

function similar(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  return a.includes(b) || b.includes(a);
}

function appendInput(
  state: AssistantState,
  rawText: string,
  inputType: "text" | "voice",
  feedback: ParseFeedback,
  options: ResolveOptions
): { state: AssistantState; inputId: string } {
  const now = nowIso();
  const input: RawInput = {
    id: createId("input"),
    rawText,
    originalText: options.originalText && options.originalText !== rawText ? options.originalText : undefined,
    transcriptRepair: options.transcriptRepair
      ? {
          confidence: options.transcriptRepair.confidence,
          needsUserConfirmation: options.transcriptRepair.needsUserConfirmation,
          question: options.transcriptRepair.question,
          repairs: options.transcriptRepair.repairs
        }
      : undefined,
    inputType,
    parsedSummary: feedback.title,
    createdAt: now
  };

  return {
    state: {
      ...state,
      inputs: [input, ...state.inputs].slice(0, 60)
    },
    inputId: input.id
  };
}

function checkInText(checkIn: AssistantCheckIn) {
  return `${checkIn.title} ${checkIn.question}`;
}

function checkInClarifies(
  checkIn: AssistantCheckIn,
  slot: NonNullable<AssistantCheckIn["clarification"]>["slot"],
  legacyPattern: RegExp
) {
  if (checkIn.clarification) return checkIn.clarification.slot === slot;
  return legacyPattern.test(checkInText(checkIn));
}

function pendingCheckIns(state: AssistantState) {
  return state.checkIns.filter((checkIn) => checkIn.status === "pending");
}

function mentionedEvent(rawText: string, event: AssistantState["lifeEvents"][number]) {
  return Boolean(
    (event.location && rawText.includes(event.location)) ||
      similar(rawText, event.title) ||
      event.title.split(/\s+|，|。|、/).some((part) => part.length >= 2 && rawText.includes(part))
  );
}

function textSegments(rawText: string) {
  return rawText
    .split(/然后|另外|还有|顺便|并且|同时|再帮我|再提醒我|，|。|；|,|;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function compactText(rawText: string) {
  return rawText.replace(/\s|[，。,.!?！？；;]/g, "");
}

function isLikelyStandaloneConfirmationAnswer(rawText: string) {
  const compact = compactText(rawText);
  return (
    compact.length <= 12 &&
    !newIntentConnectorPattern.test(rawText) &&
    !newIntentCuePattern.test(rawText) &&
    !nonConfirmationObjectCuePattern.test(rawText)
  );
}

function canAutoBindSingleCandidate(rawText: string, candidateCount: number) {
  return candidateCount === 1 && isLikelyStandaloneConfirmationAnswer(rawText);
}

function eventTimeSegment(rawText: string, event: AssistantState["lifeEvents"][number], allowStandaloneAnswer: boolean) {
  return textSegments(rawText).find((segment) => {
    if (!parseDueDate(segment)) return false;
    return mentionedEvent(segment, event) || canAutoBindSingleCandidate(segment, allowStandaloneAnswer ? 1 : 2);
  });
}

function mentionedRoutine(rawText: string, goal: AssistantState["routineGoals"][number]) {
  return similar(rawText, goal.title) || (routineTextPattern.test(rawText) && routineTextPattern.test(goal.title));
}

function matchingRoutineSegment(
  rawText: string,
  goal: AssistantState["routineGoals"][number],
  candidateCount: number,
  predicate: (segment: string) => boolean
) {
  return textSegments(rawText).find(
    (segment) =>
      predicate(segment) &&
      (mentionedRoutine(segment, goal) || canAutoBindSingleCandidate(segment, candidateCount))
  );
}

function resolveLifeEventTime(rawText: string, state: AssistantState) {
  const onlyPendingCheckIn = pendingCheckIns(state).length === 1;
  const candidates = pendingCheckIns(state).filter(
    (checkIn) => checkIn.relatedType === "life_event" && checkInClarifies(checkIn, "life_event_time", timeQuestionPattern)
  );
  const matched = candidates
    .map((checkIn) => {
      const event = state.lifeEvents.find((item) => item.id === checkIn.relatedId && item.status !== "cancelled");
      if (!event) return undefined;
      const segment = eventTimeSegment(rawText, event, onlyPendingCheckIn);
      const startsAt = segment ? parseDueDate(segment) : undefined;
      return startsAt ? { checkIn, event, startsAt } : undefined;
    })
    .filter((item): item is { checkIn: AssistantCheckIn; event: AssistantState["lifeEvents"][number]; startsAt: string } =>
      Boolean(item)
    );
  if (!matched.length) return { state, changed: false, details: [] as string[] };

  const startsByEventId = new Map(matched.map((item) => [item.event.id, item.startsAt]));
  const now = nowIso();
  return {
    state: {
      ...state,
      lifeEvents: state.lifeEvents.map((event) =>
        startsByEventId.has(event.id)
          ? {
              ...event,
              startsAt: startsByEventId.get(event.id),
              updatedAt: now
            }
          : event
      ),
      checkIns: state.checkIns.map((checkIn) =>
        matched.some((item) => item.checkIn.id === checkIn.id) ? { ...checkIn, status: "answered" as const } : checkIn
      )
    },
    changed: true,
    details: ["已更新出行/日程时间。"]
  };
}

function routineScope(rawText: string) {
  if (/(短期|最近|近期|这段时间|先试|试一周|一周)/.test(rawText)) {
    return {
      scope: "recent" as const,
      scopeLabel: /一周|试一周/.test(rawText) ? "先试一周" : "短期"
    };
  }
  if (/(长期|一直|持续保持|长期坚持)/.test(rawText)) {
    return {
      scope: "ongoing" as const,
      scopeLabel: "长期"
    };
  }
  return undefined;
}

function routineScopeIsConfirmed(goal: AssistantState["routineGoals"][number]) {
  if (goal.scope === "ongoing") return true;
  if (goal.scope === "recent" && goal.scopeLabel && !/(最近|近期)$/.test(goal.scopeLabel)) return true;
  return false;
}

function resolveRoutineScope(rawText: string, state: AssistantState) {
  const candidates = pendingCheckIns(state).filter(
    (checkIn) => checkIn.relatedType === "routine_goal" && checkInClarifies(checkIn, "routine_goal_scope", routineScopeQuestionPattern)
  );
  const matched = candidates
    .map((checkIn) => {
      const goal = state.routineGoals.find((item) => item.id === checkIn.relatedId && item.status !== "cancelled");
      if (!goal) return undefined;
      const segment = matchingRoutineSegment(rawText, goal, candidates.length, (item) => Boolean(routineScope(item)));
      if (!segment) return undefined;
      const scope = routineScope(segment);
      return scope ? { checkIn, scope } : undefined;
    })
    .filter((item): item is { checkIn: AssistantCheckIn; scope: NonNullable<ReturnType<typeof routineScope>> } =>
      Boolean(item)
    );
  if (!matched.length) return { state, changed: false, details: [] as string[] };

  const scopeByGoalId = new Map(matched.map((item) => [item.checkIn.relatedId, item.scope]));
  const now = nowIso();
  return {
    state: {
      ...state,
      routineGoals: state.routineGoals.map((goal) =>
        scopeByGoalId.has(goal.id)
          ? {
              ...goal,
              scope: scopeByGoalId.get(goal.id)?.scope ?? goal.scope,
              scopeLabel: scopeByGoalId.get(goal.id)?.scopeLabel ?? goal.scopeLabel,
              updatedAt: now
            }
          : goal
      ),
      checkIns: state.checkIns.map((checkIn) =>
        matched.some((item) => item.checkIn.id === checkIn.id) ? { ...checkIn, status: "answered" as const } : checkIn
      )
    },
    changed: true,
    details: ["已更新节奏目标范围。"]
  };
}

function clarifiedRoutineTargetTime(rawText: string) {
  if (/((中午|正午)\s*(12|十二)\s*点|(12|十二)\s*点\s*(中午|正午))/.test(rawText)) {
    return "12:00";
  }
  if (/(半夜|午夜|零点|零时|0点|0\s*[:：]\s*00|24点|二十四点|晚上\s*(12|十二)\s*点|夜里\s*(12|十二)\s*点|凌晨\s*(12|十二)\s*点)/.test(rawText)) {
    return "00:00";
  }
  const earlyMorning = rawText.match(/(凌晨|清晨|夜里)\s*(\d{1,2})\s*[点:：]\s*(\d{1,2})?/);
  if (earlyMorning) {
    const hour = Number(earlyMorning[2]);
    const minute = earlyMorning[3] ? Number(earlyMorning[3]) : 0;
    if (hour >= 0 && hour <= 11 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  const evening = rawText.match(/(晚上|晚间|今晚|每晚)\s*(\d{1,2})\s*[点:：]\s*(\d{1,2})?/);
  if (evening) {
    const hour = Number(evening[2]);
    const minute = evening[3] ? Number(evening[3]) : 0;
    if (hour >= 6 && hour <= 11 && minute >= 0 && minute <= 59) {
      return `${String(hour + 12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  const clock = rawText.match(/\b([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)\b/);
  if (clock) {
    return `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}`;
  }
  return undefined;
}

function resolveRoutineTargetTime(rawText: string, state: AssistantState) {
  const candidates = pendingCheckIns(state).filter(
    (checkIn) => checkIn.relatedType === "routine_goal" && checkInClarifies(checkIn, "routine_goal_target_time", routineTargetTimeQuestionPattern)
  );
  const matched = candidates
    .map((checkIn) => {
      const goal = state.routineGoals.find((item) => item.id === checkIn.relatedId && item.status !== "cancelled");
      if (!goal) return undefined;
      const segment = matchingRoutineSegment(rawText, goal, candidates.length, (item) => Boolean(clarifiedRoutineTargetTime(item)));
      if (!segment) return undefined;
      const targetTime = clarifiedRoutineTargetTime(segment);
      return targetTime ? { checkIn, targetTime } : undefined;
    })
    .filter((item): item is { checkIn: AssistantCheckIn; targetTime: string } => Boolean(item));
  if (!matched.length) return { state, changed: false, details: [] as string[] };

  const targetTimeByGoalId = new Map(matched.map((item) => [item.checkIn.relatedId, item.targetTime]));
  const now = nowIso();
  return {
    state: {
      ...state,
      routineGoals: state.routineGoals.map((goal) =>
        targetTimeByGoalId.has(goal.id)
          ? {
              ...goal,
              targetTime: targetTimeByGoalId.get(goal.id),
              targetTimeRelation: goal.targetTimeRelation ?? "before",
              updatedAt: now
            }
          : goal
      ),
      checkIns: state.checkIns.map((checkIn) =>
        matched.some((item) => item.checkIn.id === checkIn.id) ? { ...checkIn, status: "answered" as const } : checkIn
      )
    },
    changed: true,
    details: ["已更新节奏目标时间。"]
  };
}

export function cleanupResolvedCheckIns(state: AssistantState): AssistantState {
  return {
    ...state,
    checkIns: state.checkIns.map((checkIn) => {
      if (checkIn.status !== "pending") return checkIn;
      if (checkIn.relatedType === "life_event" && checkInClarifies(checkIn, "life_event_time", timeQuestionPattern)) {
        const event = state.lifeEvents.find((item) => item.id === checkIn.relatedId);
        return event?.startsAt ? { ...checkIn, status: "answered" as const } : checkIn;
      }
      if (checkIn.relatedType === "routine_goal") {
        const goal = state.routineGoals.find((item) => item.id === checkIn.relatedId);
        if (!goal) return checkIn;
        if (checkInClarifies(checkIn, "routine_goal_target_time", routineTargetTimeQuestionPattern) && goal.targetTime) {
          return { ...checkIn, status: "answered" as const };
        }
        if (checkInClarifies(checkIn, "routine_goal_scope", routineScopeQuestionPattern) && routineScopeIsConfirmed(goal)) {
          return { ...checkIn, status: "answered" as const };
        }
      }
      return checkIn;
    })
  };
}

function changedEventIds(before: AssistantState, after: AssistantState) {
  return new Set(
    after.lifeEvents
      .filter((event) => {
        const previous = before.lifeEvents.find((item) => item.id === event.id);
        return previous && previous.startsAt !== event.startsAt;
      })
      .map((event) => event.id)
  );
}

function changedRoutineTargetIds(before: AssistantState, after: AssistantState) {
  return new Set(
    after.routineGoals
      .filter((goal) => {
        const previous = before.routineGoals.find((item) => item.id === goal.id);
        return previous && previous.targetTime !== goal.targetTime;
      })
      .map((goal) => goal.id)
  );
}

function changedRoutineScopeIds(before: AssistantState, after: AssistantState) {
  return new Set(
    after.routineGoals
      .filter((goal) => {
        const previous = before.routineGoals.find((item) => item.id === goal.id);
        return previous && (previous.scope !== goal.scope || previous.scopeLabel !== goal.scopeLabel);
      })
      .map((goal) => goal.id)
  );
}

function segmentWasResolvedConfirmation(segment: string, before: AssistantState, after: AssistantState) {
  const eventIds = changedEventIds(before, after);
  if (
    eventIds.size > 0 &&
    before.lifeEvents.some((event) => eventIds.has(event.id) && mentionedEvent(segment, event) && Boolean(parseDueDate(segment)))
  ) {
    return true;
  }

  const targetIds = changedRoutineTargetIds(before, after);
  if (
    targetIds.size > 0 &&
    before.routineGoals.some(
      (goal) =>
        targetIds.has(goal.id) &&
        Boolean(clarifiedRoutineTargetTime(segment)) &&
        (mentionedRoutine(segment, goal) || isLikelyStandaloneConfirmationAnswer(segment))
    )
  ) {
    return true;
  }

  const scopeIds = changedRoutineScopeIds(before, after);
  if (
    scopeIds.size > 0 &&
    before.routineGoals.some(
      (goal) =>
        scopeIds.has(goal.id) &&
        Boolean(routineScope(segment)) &&
        (mentionedRoutine(segment, goal) || isLikelyStandaloneConfirmationAnswer(segment))
    )
  ) {
    return true;
  }

  return false;
}

function unresolvedIntentText(rawText: string, before: AssistantState, after: AssistantState) {
  const unresolved = textSegments(rawText).filter((segment) => {
    if (segmentWasResolvedConfirmation(segment, before, after)) return false;
    return newIntentCuePattern.test(segment);
  });
  return unresolved.length ? unresolved.join("。") : undefined;
}

export function resolvePendingConfirmations(
  rawText: string,
  inputType: "text" | "voice",
  state: AssistantState,
  options: ResolveOptions = {}
): PendingConfirmationResolution | null {
  const before = state;
  let next = state;
  const details: string[] = [];

  [resolveLifeEventTime, resolveRoutineTargetTime, resolveRoutineScope].forEach((resolver) => {
    const result = resolver(rawText, next);
    next = result.state;
    if (result.changed) details.push(...result.details);
  });

  next = cleanupResolvedCheckIns(next);
  if (!details.length) return null;

  const feedback: ParseFeedback = {
    title: "已更新确认信息",
    detail: Array.from(new Set(details)).join(" ")
  };

  const appended = appendInput(next, rawText, inputType, feedback, options);
  return {
    state: appended.state,
    feedback,
    unhandledText: unresolvedIntentText(rawText, before, next),
    sourceInputId: appended.inputId
  };
}
