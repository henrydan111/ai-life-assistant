import { generateDashboard } from "@/lib/dashboard/generateDashboard";
import type { AssistantCheckIn, AssistantState, DashboardData } from "@/types/domain";

type VisibleCheckIn = Pick<AssistantCheckIn, "id" | "title" | "question" | "relatedType" | "relatedId" | "askAt" | "status">;

type VisibleItemWithReminders = {
  id: string;
  title: string;
  meta?: string;
  reminders: VisibleCheckIn[];
};

export type VisibleDashboardSnapshot = {
  today: VisibleItemWithReminders[];
  shopping: Array<{
    id: string;
    itemName: string;
    status: string;
    expectedAt?: string;
  }>;
  routineGoals: VisibleItemWithReminders[];
  openConfirmations: VisibleCheckIn[];
  suggestedMemories: Array<{
    id: string;
    summary: string;
  }>;
  upcoming: VisibleItemWithReminders[];
  dashboardPrompts: VisibleCheckIn[];
  visibleText: string;
};

function checkInIsDue(askAt: string) {
  return new Date(askAt).getTime() <= Date.now();
}

function visibleRelatedReminders(
  state: AssistantState,
  relatedType: AssistantCheckIn["relatedType"],
  relatedId: string
): VisibleCheckIn[] {
  return state.checkIns
    .filter((checkIn) => checkIn.status === "pending" && checkIn.relatedType === relatedType && checkIn.relatedId === relatedId)
    .sort((left, right) => new Date(left.askAt).getTime() - new Date(right.askAt).getTime())
    .map(toVisibleCheckIn);
}

function toVisibleCheckIn(checkIn: AssistantCheckIn): VisibleCheckIn {
  return {
    id: checkIn.id,
    title: checkIn.title,
    question: checkIn.question,
    relatedType: checkIn.relatedType,
    relatedId: checkIn.relatedId,
    askAt: checkIn.askAt,
    status: checkIn.status
  };
}

function routineMeta(goal: DashboardData["routineGoals"][number]) {
  const scope = goal.scopeLabel ?? (goal.scope === "recent" ? "最近" : goal.scope === "ongoing" ? "长期" : "范围待确认");
  const time = goal.targetTime ? `${goal.targetTime}${goal.targetTimeRelation === "before" ? "前" : ""}` : undefined;
  return [scope, goal.cadence, time, goal.status].filter(Boolean).join(" · ");
}

function hasRelatedRecord(state: AssistantState, checkIn: AssistantCheckIn) {
  if (checkIn.relatedType === "task") {
    return state.tasks.some((task) => task.id === checkIn.relatedId && task.status !== "cancelled");
  }
  if (checkIn.relatedType === "life_event") {
    return state.lifeEvents.some((event) => event.id === checkIn.relatedId && event.status !== "cancelled");
  }
  if (checkIn.relatedType === "shopping_item") {
    return state.shoppingItems.some((item) => item.id === checkIn.relatedId && item.status !== "removed");
  }
  if (checkIn.relatedType === "project") {
    return state.projects.some((project) => project.id === checkIn.relatedId && project.status !== "done");
  }
  if (checkIn.relatedType === "memory") {
    return state.memoryItems.some((memory) => memory.id === checkIn.relatedId && memory.status === "suggested");
  }
  if (checkIn.relatedType === "routine_goal") {
    return state.routineGoals.some((goal) => goal.id === checkIn.relatedId && goal.status !== "cancelled");
  }
  return false;
}

function buildUpcomingSnapshot(state: AssistantState, hiddenTaskIds: string[]): VisibleItemWithReminders[] {
  const items: VisibleItemWithReminders[] = [];
  const hiddenTasks = new Set(hiddenTaskIds);

  state.tasks.forEach((task) => {
    if (hiddenTasks.has(task.id) || !task.dueAt || task.status === "done" || task.status === "cancelled") return;
    items.push({
      id: task.id,
      title: task.title,
      meta: task.dueAt,
      reminders: visibleRelatedReminders(state, "task", task.id)
    });
  });

  state.lifeEvents.forEach((event) => {
    if (!event.startsAt || event.status === "done" || event.status === "cancelled") return;
    items.push({
      id: event.id,
      title: event.title,
      meta: [event.startsAt, event.location].filter(Boolean).join(" · "),
      reminders: visibleRelatedReminders(state, "life_event", event.id)
    });
  });

  state.shoppingItems.forEach((item) => {
    if (!item.expectedAt || item.status === "bought" || item.status === "removed") return;
    items.push({
      id: item.id,
      title: item.itemName,
      meta: [item.expectedAt, item.status].filter(Boolean).join(" · "),
      reminders: visibleRelatedReminders(state, "shopping_item", item.id)
    });
  });

  state.checkIns.forEach((checkIn) => {
    if (checkIn.status !== "pending" || hasRelatedRecord(state, checkIn)) return;
    items.push({
      id: checkIn.id,
      title: checkIn.question,
      meta: [checkIn.askAt, checkIn.title].filter(Boolean).join(" · "),
      reminders: []
    });
  });

  return items.sort((left, right) => {
    const leftTime = new Date(left.meta?.split(" · ")[0] ?? 0).getTime();
    const rightTime = new Date(right.meta?.split(" · ")[0] ?? 0).getTime();
    return leftTime - rightTime;
  });
}

function collectText(snapshot: Omit<VisibleDashboardSnapshot, "visibleText">) {
  const parts: string[] = [];
  snapshot.today.forEach((item) => {
    parts.push(item.title, item.meta ?? "");
    item.reminders.forEach((reminder) => parts.push(reminder.title, reminder.question));
  });
  snapshot.shopping.forEach((item) => parts.push(item.itemName, item.status, item.expectedAt ?? ""));
  snapshot.routineGoals.forEach((item) => {
    parts.push(item.title, item.meta ?? "");
    item.reminders.forEach((reminder) => parts.push(reminder.title, reminder.question));
  });
  snapshot.openConfirmations.forEach((checkIn) => parts.push(checkIn.title, checkIn.question));
  snapshot.suggestedMemories.forEach((memory) => parts.push(memory.summary));
  snapshot.upcoming.forEach((item) => {
    parts.push(item.title, item.meta ?? "");
    item.reminders.forEach((reminder) => parts.push(reminder.title, reminder.question));
  });
  snapshot.dashboardPrompts.forEach((checkIn) => parts.push(checkIn.title, checkIn.question));
  return parts.filter(Boolean).join(" ");
}

export function generateVisibleDashboardSnapshot(state: AssistantState): VisibleDashboardSnapshot {
  const dashboard = generateDashboard(state);
  const suggestedMemories = state.memoryItems
    .filter((memory) => memory.status === "suggested")
    .slice(0, 3)
    .map((memory) => ({ id: memory.id, summary: memory.summary }));
  const suggestedMemoryIds = new Set(suggestedMemories.map((memory) => memory.id));
  const openConfirmations = state.checkIns
    .filter(
      (checkIn) =>
        checkIn.status === "pending" &&
        checkIn.relatedType !== "task" &&
        checkInIsDue(checkIn.askAt) &&
        !suggestedMemoryIds.has(checkIn.relatedId)
    )
    .sort((left, right) => new Date(left.askAt).getTime() - new Date(right.askAt).getTime())
    .slice(0, Math.max(0, 3 - suggestedMemories.length))
    .map(toVisibleCheckIn);

  const snapshotWithoutText = {
    today: dashboard.today.map((task) => ({
      id: task.id,
      title: task.title,
      meta: [task.due, task.priority, task.status].filter(Boolean).join(" · "),
      reminders: visibleRelatedReminders(state, "task", task.id)
    })),
    shopping: dashboard.shopping.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      status: item.status,
      expectedAt: item.expectedAt
    })),
    routineGoals: dashboard.routineGoals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      meta: routineMeta(goal),
      reminders: visibleRelatedReminders(state, "routine_goal", goal.id)
    })),
    openConfirmations,
    suggestedMemories,
    upcoming: buildUpcomingSnapshot(
      state,
      dashboard.today.map((task) => task.id)
    ),
    dashboardPrompts: dashboard.prompts.map(toVisibleCheckIn)
  };

  return {
    ...snapshotWithoutText,
    visibleText: collectText(snapshotWithoutText)
  };
}
