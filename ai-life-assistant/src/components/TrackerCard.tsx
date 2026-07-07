"use client";

import { useState } from "react";
import { BarChart3, CheckCircle2, ChevronRight, Clock } from "lucide-react";
import { ItemActionButtons } from "@/components/ItemActionButtons";
import type { AssistantCheckIn, AssistantItemRef, AssistantState } from "@/types/domain";
import { addDays, formatShortDate, formatTime, isSameLocalDay, startOfLocalDay } from "@/lib/time/parseTime";

type CompletedMainItem = {
  id: string;
  title: string;
  kind: "task" | "life_event" | "shopping_item";
  completedAt: string;
  meta?: string;
  reminders: AssistantCheckIn[];
};

const priorityLabels = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
} as const;

function dayKey(date: Date, timezone?: string) {
  if (timezone) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(iso: string, timezone?: string) {
  const date = new Date(iso);
  return isSameLocalDay(date, new Date(), timezone) ? "今天" : formatShortDate(iso, timezone);
}

function weekdayLabel(date: Date, timezone?: string) {
  if (isSameLocalDay(date, new Date(), timezone)) return "今天";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, weekday: "short" }).format(date);
}

function visibleRelatedReminders(
  state: AssistantState,
  relatedType: "task" | "life_event" | "shopping_item",
  relatedId: string
) {
  return state.checkIns
    .filter((checkIn) => checkIn.status !== "dismissed" && checkIn.relatedType === relatedType && checkIn.relatedId === relatedId)
    .sort((left, right) => new Date(left.askAt).getTime() - new Date(right.askAt).getTime());
}

function completedMainItems(state: AssistantState): CompletedMainItem[] {
  return [
    ...state.tasks
      .filter((task) => task.status === "done")
      .map((task) => ({
        id: task.id,
        title: task.title,
        kind: "task" as const,
        completedAt: task.updatedAt,
        meta: priorityLabels[task.priority],
        reminders: visibleRelatedReminders(state, "task", task.id)
      })),
    ...state.lifeEvents
      .filter((event) => event.status === "done")
      .map((event) => ({
        id: event.id,
        title: event.title,
        kind: "life_event" as const,
        completedAt: event.updatedAt,
        meta: event.location ?? "日程",
        reminders: visibleRelatedReminders(state, "life_event", event.id)
      })),
    ...state.shoppingItems
      .filter((item) => item.status === "bought")
      .map((item) => ({
        id: item.id,
        title: item.itemName,
        kind: "shopping_item" as const,
        completedAt: item.updatedAt,
        meta: item.category ?? "购物",
        reminders: visibleRelatedReminders(state, "shopping_item", item.id)
      }))
  ]
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())
    .slice(0, 8);
}

function dateForTask(task: AssistantState["tasks"][number], today: Date) {
  if (task.dueAt) return new Date(task.dueAt);
  if (task.status === "done") return new Date(task.updatedAt);
  if (task.horizon === "now" || task.horizon === "today") return today;
  return undefined;
}

function buildDailyTracker(state: AssistantState) {
  const timezone = state.preferences.timezone;
  const today = startOfLocalDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index);
    return { date, key: dayKey(date, timezone), total: 0, completed: 0 };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));

  state.tasks.forEach((task) => {
    if (task.status === "cancelled" || task.status === "deferred") return;
    const date = dateForTask(task, today);
    if (!date) return;
    const bucket = byKey.get(dayKey(date, timezone));
    if (!bucket) return;
    bucket.total += 1;
    if (task.status === "done") bucket.completed += 1;
  });

  state.lifeEvents.forEach((event) => {
    if (event.status === "cancelled") return;
    const date = event.startsAt ? new Date(event.startsAt) : event.status === "done" ? new Date(event.updatedAt) : undefined;
    if (!date) return;
    const bucket = byKey.get(dayKey(date, timezone));
    if (!bucket) return;
    bucket.total += 1;
    if (event.status === "done") bucket.completed += 1;
  });

  state.shoppingItems.forEach((item) => {
    if (item.status === "removed") return;
    const date = item.expectedAt ? new Date(item.expectedAt) : item.status === "bought" ? new Date(item.updatedAt) : undefined;
    if (!date) return;
    const bucket = byKey.get(dayKey(date, timezone));
    if (!bucket) return;
    bucket.total += 1;
    if (item.status === "bought") bucket.completed += 1;
  });

  return days;
}

export function TrackerCard({
  state,
  onDeleteItem,
  onRevertItem
}: {
  state: AssistantState;
  onDeleteItem: (target: AssistantItemRef) => void;
  onRevertItem: (target: AssistantItemRef) => void;
}) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const timezone = state.preferences.timezone;
  const tracker = buildDailyTracker(state);
  const completed = completedMainItems(state);
  const maxTotal = Math.max(1, ...tracker.map((day) => day.total));
  const weekTotal = tracker.reduce((total, day) => total + day.total, 0);
  const weekCompleted = tracker.reduce((total, day) => total + day.completed, 0);

  function toggleItem(key: string) {
    setExpandedItems((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className="tracker-card-view" aria-label="Daily tracker and completed tasks">
      <header className="card-section-header">
        <p className="eyebrow">Tracker</p>
        <h2 className="card-title">节奏与完成</h2>
      </header>

      <section className="tracker-panel" aria-label="Daily task count">
        <div className="dashboard-section-head">
          <div className="dashboard-section-label">
            <BarChart3 size={17} aria-hidden="true" />
            <span>7日待办数</span>
          </div>
          <span className="today-count">{weekCompleted}/{weekTotal || 0}</span>
        </div>
        <div className="daily-tracker-bars" role="list" aria-label="未来 7 天每日主事项数量">
          {tracker.map((day) => {
            const barHeight = day.total ? Math.max(18, Math.round((day.total / maxTotal) * 96)) : 8;
            return (
              <div className={day.total ? "daily-tracker-day has-items" : "daily-tracker-day"} key={day.key} role="listitem">
                <div className="daily-tracker-count">{day.total}</div>
                <div className="daily-tracker-bar-shell" aria-hidden="true">
                  <div className="daily-tracker-bar" style={{ height: `${barHeight}px` }} />
                </div>
                <div className="daily-tracker-label">
                  <span>{weekdayLabel(day.date, timezone)}</span>
                  <small>{formatShortDate(day.date.toISOString(), timezone)}</small>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="tracker-panel completed-tracker-panel" aria-label="Completed main tasks">
        <div className="dashboard-section-head">
          <div className="dashboard-section-label">
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>已完成待办</span>
          </div>
          <span className="today-count">{completed.length}</span>
        </div>
        {completed.length ? (
          <ul className="completed-main-list">
            {completed.map((item) => {
              const itemKey = `tracker-completed-${item.kind}-${item.id}`;
              const isExpanded = Boolean(expandedItems[itemKey]);
              return (
                <li className={item.reminders.length ? "completed-main-item has-reminders" : "completed-main-item"} key={itemKey}>
                  <div className="completed-main-row">
                    {item.reminders.length ? (
                      <button
                        className={isExpanded ? "item-disclosure expanded" : "item-disclosure"}
                        type="button"
                        onClick={() => toggleItem(itemKey)}
                        aria-label={`${isExpanded ? "收起" : "展开"}${item.title}的提醒`}
                        aria-expanded={isExpanded}
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="item-disclosure-placeholder" aria-hidden="true" />
                    )}
                    <CheckCircle2 className="completed-main-icon" size={16} aria-hidden="true" />
                    <div className="completed-main-text">
                      <span>{item.title}</span>
                      <small>
                        {dayLabel(item.completedAt, timezone)}
                        {" · "}
                        {formatTime(item.completedAt, timezone)}
                        {item.meta ? ` · ${item.meta}` : ""}
                        {item.reminders.length ? ` · ${item.reminders.length}个提醒` : ""}
                      </small>
                    </div>
                  </div>
                  {item.reminders.length && isExpanded ? (
                    <ul className="related-reminders completed-related-reminders" aria-label={`${item.title}的提醒`}>
                      {item.reminders.map((reminder) => (
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
                          {reminder.status === "answered" ? (
                            <ItemActionButtons
                              className="hide-in-display compact-actions"
                              target={{ id: reminder.id, title: reminder.question, kind: "check_in" }}
                              onComplete={() => undefined}
                              onDelete={onDeleteItem}
                              onDiscuss={() => undefined}
                              onRevert={onRevertItem}
                              showComplete={false}
                              showRevert
                              showDiscuss={false}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="tracker-empty">完成主待办后会显示在这里。</p>
        )}
      </section>
    </section>
  );
}
