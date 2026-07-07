import { DEFAULT_TIMEZONE } from "@/lib/time/parseTime";
import type { AssistantState } from "@/types/domain";
import { runtimeTimezone } from "./provider";

export function timezoneForState(state: AssistantState) {
  return state.preferences.timezone || runtimeTimezone();
}

export function summarizeState(state: AssistantState) {
  return {
    preferences: state.preferences,
    tasks: state.tasks.slice(0, 20).map((task) => ({
      id: task.id,
      title: task.title,
      horizon: task.horizon,
      dueAt: task.dueAt,
      priority: task.priority,
      status: task.status
    })),
    shoppingItems: state.shoppingItems.slice(0, 20).map((item) => ({
      id: item.id,
      itemName: item.itemName,
      status: item.status,
      expectedAt: item.expectedAt
    })),
    lifeEvents: state.lifeEvents.slice(0, 12).map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      startsAt: event.startsAt,
      location: event.location,
      priority: event.priority,
      status: event.status
    })),
    routineGoals: state.routineGoals.slice(0, 12).map((goal) => ({
      id: goal.id,
      title: goal.title,
      cadence: goal.cadence,
      targetTime: goal.targetTime,
      targetTimeRelation: goal.targetTimeRelation,
      scope: goal.scope,
      scopeLabel: goal.scopeLabel,
      priority: goal.priority,
      status: goal.status
    })),
    checkIns: state.checkIns.slice(0, 12).map((checkIn) => ({
      id: checkIn.id,
      title: checkIn.title,
      question: checkIn.question,
      relatedType: checkIn.relatedType,
      relatedId: checkIn.relatedId,
      askAt: checkIn.askAt,
      status: checkIn.status
    })),
    recurrenceCandidates: state.recurrenceCandidates.slice(0, 12).map((candidate) => ({
      normalizedTitle: candidate.normalizedTitle,
      relatedType: candidate.relatedType,
      seenCount: candidate.seenCount,
      status: candidate.status
    })),
    recentInputs: state.inputs.slice(0, 8).map((input) => input.rawText)
  };
}

export function localNowText(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "medium"
  }).format(new Date());
}
