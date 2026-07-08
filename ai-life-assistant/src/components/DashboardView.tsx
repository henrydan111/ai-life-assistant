"use client";

import { useId, useState } from "react";
import { Brain, CalendarDays, ChevronRight, CircleHelp, Clock, ListChecks, Monitor } from "lucide-react";
import { CalendarView } from "@/components/CalendarView";
import { ItemActionButtons } from "@/components/ItemActionButtons";
import { MemoryList } from "@/components/MemoryList";
import type { AssistantItemRef, AssistantState, DashboardData, Priority } from "@/types/domain";
import { formatShortDate, formatTime, isSameLocalDay } from "@/lib/time/parseTime";

const priorityLabels: Record<Priority, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

function dayLabel(iso: string, timezone?: string) {
  const date = new Date(iso);
  return isSameLocalDay(date, new Date(), timezone) ? "今天" : formatShortDate(iso, timezone);
}

function priorityLabel(priority: Priority) {
  return priorityLabels[priority];
}

function cadenceLabel(cadence: DashboardData["routineGoals"][number]["cadence"]) {
  if (cadence === "daily") return "每天";
  if (cadence === "weekly") return "每周";
  return "自定义";
}

function targetTimeLabel(goal: DashboardData["routineGoals"][number]) {
  if (!goal.targetTime) return undefined;
  const relation = goal.targetTimeRelation === "before" ? "前" : goal.targetTimeRelation === "after" ? "后" : "";
  return `${goal.targetTime}${relation}`;
}

function routineScopeLabel(goal: DashboardData["routineGoals"][number]) {
  if (goal.scopeLabel) return goal.scopeLabel;
  if (goal.scope === "recent") return "最近";
  if (goal.scope === "ongoing") return "长期";
  if (goal.scope === "date_range") return "一段时间";
  return "范围待确认";
}

function checkInIsDue(askAt: string) {
  return new Date(askAt).getTime() <= Date.now();
}

function visibleRelatedReminders(
  state: AssistantState,
  relatedType: "task" | "life_event" | "shopping_item" | "routine_goal",
  relatedId: string
) {
  return state.checkIns
    .filter((checkIn) => checkIn.status === "pending" && checkIn.relatedType === relatedType && checkIn.relatedId === relatedId)
    .sort((left, right) => new Date(left.askAt).getTime() - new Date(right.askAt).getTime());
}

export function DashboardView({
  dashboard,
  state,
  displayMode,
  onCompleteItem,
  onDeleteItem,
  onDiscussItem,
  onRevertItem,
  onConfirmMemory,
  onForgetMemory,
  onUpdateMemorySummary,
  onToggleDisplay
}: {
  dashboard: DashboardData;
  state?: AssistantState;
  displayMode?: boolean;
  onCompleteItem: (target: AssistantItemRef) => void;
  onDeleteItem: (target: AssistantItemRef) => void;
  onDiscussItem: (target: AssistantItemRef) => void;
  onRevertItem: (target: AssistantItemRef) => void;
  onConfirmMemory: (memoryId: string) => void;
  onForgetMemory: (memoryId: string) => void;
  onUpdateMemorySummary: (memoryId: string, summary: string) => void;
  onToggleDisplay?: () => void;
}) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const percent = dashboard.progress.total > 0 ? (dashboard.progress.completed / dashboard.progress.total) * 100 : 0;
  const progressCount = dashboard.progress.total > 0 ? `${dashboard.progress.completed}/${dashboard.progress.total}` : "无事项";
  const titleId = useId();
  const progressId = useId();
  const timezone = state?.preferences.timezone;
  const suggestedMemories = (state?.memoryItems ?? []).filter((memory) => memory.status === "suggested").slice(0, 2);
  const suggestedMemoryIds = new Set(suggestedMemories.map((memory) => memory.id));
  const openConfirmations = (state?.checkIns ?? [])
    .filter(
      (checkIn) =>
        checkIn.status === "pending" &&
        checkIn.relatedType !== "task" &&
        checkInIsDue(checkIn.askAt) &&
        !suggestedMemoryIds.has(checkIn.relatedId)
    )
    .sort((left, right) => new Date(left.askAt).getTime() - new Date(right.askAt).getTime())
    .slice(0, 3);
  const remembered = (state?.memoryItems ?? []).filter((memory) => memory.status === "active").slice(0, 4);

  function remindersForTask(taskId: string) {
    return state ? visibleRelatedReminders(state, "task", taskId) : [];
  }

  function remindersForRoutineGoal(goalId: string) {
    return state ? visibleRelatedReminders(state, "routine_goal", goalId) : [];
  }

  function toggleItem(key: string) {
    setExpandedItems((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className="dashboard dashboard-card-view" aria-labelledby={titleId}>
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 id={titleId} className="page-title">
            今日总览
          </h1>
        </div>
        <div className="button-row hide-in-display">
          {onToggleDisplay ? (
            <button className="text-button" type="button" onClick={onToggleDisplay} aria-pressed={Boolean(displayMode)}>
              <Monitor size={17} aria-hidden="true" />
              Display
            </button>
          ) : null}
        </div>
      </header>

      <section className="dashboard-section today-summary-section" aria-label="Today tasks">
        <div className="dashboard-section-head">
          <div className="dashboard-section-label">
            <ListChecks size={17} aria-hidden="true" />
            <span>今日事项</span>
          </div>
          <span className="today-count">{progressCount}</span>
        </div>

        <div className="today-progress-block">
          <div
            id={progressId}
            className="progress-track"
            role="progressbar"
            aria-label="今日完成进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, percent))}
            aria-valuetext={dashboard.progress.label}
          >
            <div className="progress-fill" style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <p className="state-line">{dashboard.progress.label}</p>
        </div>

        <ul className="task-list">
          {dashboard.today.length > 0 ? (
            dashboard.today.map((task) => {
              const reminders = remindersForTask(task.id);
              const itemKey = `today-task-${task.id}`;
              const isExpanded = Boolean(expandedItems[itemKey]);
              return (
                <li className={reminders.length ? "task-item task-item-shell has-reminders" : "task-item task-item-shell"} key={task.id}>
                  <div className="task-item-row">
                    {reminders.length ? (
                      <button
                        className={isExpanded ? "item-disclosure expanded" : "item-disclosure"}
                        type="button"
                        onClick={() => toggleItem(itemKey)}
                        aria-label={`${isExpanded ? "收起" : "展开"}${task.title}的提醒`}
                        aria-expanded={isExpanded}
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="item-disclosure-placeholder" aria-hidden="true" />
                    )}
                    <div className="item-main">
                      <div className="item-title">{task.title}</div>
                      <div className="item-meta">
                        {task.due ? `${task.due} · ` : ""}
                        {priorityLabel(task.priority)}
                        {reminders.length ? ` · ${reminders.length}个提醒` : ""}
                      </div>
                    </div>
                    <div className="item-actions hide-in-display">
                      <ItemActionButtons
                        target={{ id: task.id, title: task.title, kind: "task" }}
                        onComplete={onCompleteItem}
                        onDelete={onDeleteItem}
                        onDiscuss={onDiscussItem}
                      />
                    </div>
                  </div>
                  {reminders.length && isExpanded ? (
                    <ul className="related-reminders task-related-reminders" aria-label={`${task.title}的提醒`}>
                      {reminders.map((reminder) => (
                        <li
                          className={reminder.status === "answered" ? "related-reminder completed" : "related-reminder"}
                          key={reminder.id}
                        >
                          <Clock size={13} aria-hidden="true" />
                          <div className="related-reminder-main">
                            <span>{reminder.title}</span>
                            <small>
                              {dayLabel(reminder.askAt, timezone)}
                              {" · "}
                              {formatTime(reminder.askAt, timezone)}
                              {reminder.status === "answered" ? " · 已完成" : ""}
                            </small>
                            <p>{reminder.question}</p>
                          </div>
                          <ItemActionButtons
                            className="hide-in-display compact-actions"
                            target={{ id: reminder.id, title: reminder.question, kind: "check_in" }}
                            onComplete={onCompleteItem}
                            onDelete={onDeleteItem}
                            onDiscuss={onDiscussItem}
                            onRevert={onRevertItem}
                            showComplete={reminder.status !== "answered"}
                            showRevert={reminder.status === "answered"}
                            showDiscuss={false}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })
          ) : (
            <li className="task-item">
              <div className="item-main">
                <div className="item-title">今天暂时清爽</div>
                <div className="item-meta">从输入页添加新的事项。</div>
              </div>
            </li>
          )}
        </ul>
      </section>

      {dashboard.routineGoals.length ? (
        <section className="dashboard-section routine-goals-section" aria-label="Routine goals">
          <div className="dashboard-section-head">
            <div className="dashboard-section-label">
              <Clock size={17} aria-hidden="true" />
              <span>节奏目标</span>
            </div>
            <span className="today-count">{dashboard.routineGoals.length}</span>
          </div>
          <ul className="routine-goal-list" aria-label="正在跟进的节奏目标">
            {dashboard.routineGoals.map((goal) => {
              const timeText = targetTimeLabel(goal);
              const reminders = remindersForRoutineGoal(goal.id);
              return (
                <li className={reminders.length ? "routine-goal-item has-reminders" : "routine-goal-item"} key={goal.id}>
                  <div className="routine-goal-row">
                    <div className="routine-goal-main">
                      <div className="item-title">{goal.title}</div>
                      <div className="item-meta">
                        {routineScopeLabel(goal)}
                        {" · "}
                        {cadenceLabel(goal.cadence)}
                        {timeText ? ` · ${timeText}` : ""}
                        {goal.status === "paused" ? " · 已暂停" : ""}
                        {reminders.length ? ` · ${reminders.length}个确认` : ""}
                      </div>
                    </div>
                    <ItemActionButtons
                      className="hide-in-display compact-actions"
                      target={{ id: goal.id, title: goal.title, kind: "routine_goal" }}
                      onComplete={onCompleteItem}
                      onDelete={onDeleteItem}
                      onDiscuss={onDiscussItem}
                      showComplete={false}
                    />
                  </div>
                  {reminders.length ? (
                    <ul className="related-reminders routine-related-reminders" aria-label={`${goal.title}的确认`}>
                      {reminders.map((reminder) => (
                        <li
                          className={reminder.status === "answered" ? "related-reminder completed" : "related-reminder"}
                          key={reminder.id}
                        >
                          <Clock size={13} aria-hidden="true" />
                          <div className="related-reminder-main">
                            <span>{reminder.title}</span>
                            <small>
                              {dayLabel(reminder.askAt, timezone)}
                              {" · "}
                              {formatTime(reminder.askAt, timezone)}
                              {reminder.status === "answered" ? " · 已完成" : ""}
                            </small>
                            <p>{reminder.question}</p>
                          </div>
                          <ItemActionButtons
                            className="hide-in-display compact-actions"
                            target={{ id: reminder.id, title: reminder.question, kind: "check_in" }}
                            onComplete={onCompleteItem}
                            onDelete={onDeleteItem}
                            onDiscuss={onDiscussItem}
                            onRevert={onRevertItem}
                            showComplete={reminder.status !== "answered"}
                            showRevert={reminder.status === "answered"}
                            showDiscuss={false}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {suggestedMemories.length || openConfirmations.length ? (
        <section className="dashboard-section memory-dashboard-section" aria-label="Needs confirmation">
          <div className="dashboard-section-head">
            <div className="dashboard-section-label">
              <CircleHelp size={17} aria-hidden="true" />
              <span>需要你确认</span>
            </div>
          </div>
          <div className="confirmation-groups">
            {suggestedMemories.length ? (
              <div className="confirmation-group">
                <div className="confirmation-group-label">建议记住</div>
                <MemoryList
                  memories={suggestedMemories}
                  compact
                  emptyText=""
                  onConfirmMemory={onConfirmMemory}
                  onForgetMemory={onForgetMemory}
                  onUpdateMemorySummary={onUpdateMemorySummary}
                />
              </div>
            ) : null}
            {openConfirmations.length ? (
              <div className="confirmation-group">
                <div className="confirmation-group-label">待补充细节</div>
                <ul className="memory-list compact confirmation-list">
                  {openConfirmations.map((checkIn) => (
                    <li className="memory-item" key={checkIn.id}>
                      <div className="memory-main">
                        <p>{checkIn.question}</p>
                        <small>
                          {dayLabel(checkIn.askAt, timezone)}
                          {" · "}
                          {formatTime(checkIn.askAt, timezone)}
                        </small>
                      </div>
                      <ItemActionButtons
                        className="hide-in-display compact-actions"
                        target={{ id: checkIn.id, title: checkIn.question, kind: "check_in" }}
                        onComplete={onCompleteItem}
                        onDelete={onDeleteItem}
                        onDiscuss={onDiscussItem}
                        showDiscuss={false}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {remembered.length ? (
        <section className="dashboard-section memory-dashboard-section" aria-label="Remembered by AI">
          <div className="dashboard-section-head">
            <div className="dashboard-section-label">
              <Brain size={17} aria-hidden="true" />
              <span>AI 记住了</span>
            </div>
          </div>
          <MemoryList
            memories={remembered}
            compact
            emptyText="还没有长期记忆。"
            onConfirmMemory={onConfirmMemory}
            onForgetMemory={onForgetMemory}
            onUpdateMemorySummary={onUpdateMemorySummary}
          />
        </section>
      ) : null}

      <section className="dashboard-section schedule-summary-section" aria-label="Upcoming schedule">
        <div className="dashboard-section-head">
          <div className="dashboard-section-label">
            <CalendarDays size={17} aria-hidden="true" />
            <span>后续安排</span>
          </div>
        </div>
        {state ? (
          <CalendarView
            state={state}
            compact
            hiddenTaskIds={dashboard.today.map((task) => task.id)}
            onCompleteItem={onCompleteItem}
            onDeleteItem={onDeleteItem}
            onDiscussItem={onDiscussItem}
            onRevertItem={onRevertItem}
          />
        ) : (
          <p className="state-line">后续 3 天、7 天和 1 个月的安排会显示在这里。</p>
        )}
      </section>
    </section>
  );
}
