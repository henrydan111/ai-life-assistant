import type { AssistantCheckIn, AssistantState, DashboardData, Task } from "@/types/domain";
import { formatTime, isSameLocalDay } from "@/lib/time/parseTime";

function sortTasks(a: Task, b: Task) {
  const priorityScore = { high: 3, medium: 2, low: 1 };
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return priorityScore[b.priority] - priorityScore[a.priority];
}

function promptIsDue(prompt: AssistantCheckIn) {
  return prompt.status === "pending" && new Date(prompt.askAt).getTime() <= Date.now();
}

function promptCanSurfaceDirectly(prompt: AssistantCheckIn) {
  return prompt.relatedType !== "memory";
}

function belongsToToday(task: Task, today: Date, timezone: string) {
  if (task.horizon === "now" || task.horizon === "today") return true;
  if (task.dueAt && isSameLocalDay(new Date(task.dueAt), today, timezone)) return true;
  if (task.status === "done" && isSameLocalDay(new Date(task.updatedAt), today, timezone)) return true;
  return false;
}

export function generateDashboard(state: AssistantState): DashboardData {
  const today = new Date();
  const timezone = state.preferences.timezone;
  const latestMood = state.moodLogs[0];

  const todayTaskPool = state.tasks.filter((task) => {
    if (task.status === "cancelled" || task.status === "deferred") return false;
    return belongsToToday(task, today, timezone);
  });

  const todayTasks = todayTaskPool.filter((task) => task.status === "todo" || task.status === "doing").sort(sortTasks);

  const nowTask = todayTasks[0];
  const completed = todayTaskPool.filter((task) => task.status === "done").length;
  const total = todayTaskPool.length;

  const stateLine = latestMood
    ? `当前状态：${latestMood.moodLabel}。`
    : "今日事项会按真实数量展示。";

  return {
    now: nowTask
      ? {
          id: nowTask.id,
          title: nowTask.title,
          reason: nowTask.dueAt ? "Highest-priority deadline today" : "Best next action",
          due: formatTime(nowTask.dueAt, timezone)
        }
      : undefined,
    today: todayTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      due: formatTime(task.dueAt, timezone),
      priority: task.priority
    })),
    progress: {
      completed,
      total,
      label: total > 0 ? `今日已完成 ${completed}/${total}` : "今日暂无事项"
    },
    week: state.projects
      .filter((project) => project.status === "active")
      .slice(0, 3)
      .map((project) => ({
        id: project.id,
        title: project.title,
        progress: project.progressPercent
      })),
    shopping: state.shoppingItems
      .filter((item) => item.status === "needed" || item.status === "ordered")
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        itemName: item.itemName,
        status: item.status,
        expectedAt: item.expectedAt
      })),
    routineGoals: state.routineGoals
      .filter((goal) => goal.status === "active" || goal.status === "paused")
      .slice(0, 4)
      .map((goal) => ({
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
    state: stateLine,
    prompts: state.checkIns.filter((prompt) => promptIsDue(prompt) && promptCanSurfaceDirectly(prompt)).slice(0, 2)
  };
}
