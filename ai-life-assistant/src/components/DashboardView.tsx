"use client";

import { useId, useState } from "react";
import { CalendarDays, ChevronRight, Clock, ListChecks, Monitor } from "lucide-react";
import { CalendarView } from "@/components/CalendarView";
import { ItemActionButtons } from "@/components/ItemActionButtons";
import type { AssistantItemRef, AssistantState, DashboardData } from "@/types/domain";
import { formatShortDate, formatTime, isSameLocalDay } from "@/lib/time/parseTime";

function dayLabel(iso: string) {
  const date = new Date(iso);
  return isSameLocalDay(date, new Date()) ? "今天" : formatShortDate(iso);
}

export function DashboardView({
  dashboard,
  state,
  displayMode,
  onCompleteItem,
  onDeleteItem,
  onDiscussItem,
  onToggleDisplay
}: {
  dashboard: DashboardData;
  state?: AssistantState;
  displayMode?: boolean;
  onCompleteItem: (target: AssistantItemRef) => void;
  onDeleteItem: (target: AssistantItemRef) => void;
  onDiscussItem: (target: AssistantItemRef) => void;
  onToggleDisplay?: () => void;
}) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const percent = dashboard.progress.total > 0 ? (dashboard.progress.completed / dashboard.progress.total) * 100 : 0;
  const progressCount = dashboard.progress.total > 0 ? `${dashboard.progress.completed}/${dashboard.progress.total}` : "无事项";
  const titleId = useId();
  const progressId = useId();

  function remindersForTask(taskId: string) {
    return (state?.checkIns ?? [])
      .filter((checkIn) => checkIn.status === "pending" && checkIn.relatedType === "task" && checkIn.relatedId === taskId)
      .sort((left, right) => new Date(left.askAt).getTime() - new Date(right.askAt).getTime());
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
                        {task.priority} priority
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
                        <li className="related-reminder" key={reminder.id}>
                          <Clock size={13} aria-hidden="true" />
                          <div className="related-reminder-main">
                            <span>{reminder.title}</span>
                            <small>
                              {dayLabel(reminder.askAt)}
                              {" · "}
                              {formatTime(reminder.askAt)}
                            </small>
                            <p>{reminder.question}</p>
                          </div>
                          <ItemActionButtons
                            className="hide-in-display compact-actions"
                            target={{ id: reminder.id, title: reminder.question, kind: "check_in" }}
                            onComplete={onCompleteItem}
                            onDelete={onDeleteItem}
                            onDiscuss={onDiscussItem}
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
            onCompleteItem={onCompleteItem}
            onDeleteItem={onDeleteItem}
            onDiscussItem={onDiscussItem}
          />
        ) : (
          <p className="state-line">后续 3 天、7 天和 1 个月的安排会显示在这里。</p>
        )}
      </section>
    </section>
  );
}
