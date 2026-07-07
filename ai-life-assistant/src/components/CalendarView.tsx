"use client";

import { useId, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, Clock, MapPin, Plane, ShoppingBag } from "lucide-react";
import { ItemActionButtons } from "@/components/ItemActionButtons";
import type { AssistantItemRef, AssistantState } from "@/types/domain";
import { addDays, formatShortDate, formatTime, isSameLocalDay, startOfLocalDay } from "@/lib/time/parseTime";

type CalendarReminder = {
  id: string;
  title: string;
  question: string;
  target: AssistantItemRef;
  at: Date;
  status: "pending" | "answered";
  meta?: string;
};

type CalendarItem = {
  id: string;
  title: string;
  kind: "task" | "event" | "check" | "shopping";
  target: AssistantItemRef;
  at: Date;
  meta?: string;
  reminders: CalendarReminder[];
};

const kindIcon = {
  task: CheckCircle2,
  event: Plane,
  check: Clock,
  shopping: ShoppingBag
};

const horizonCards = [
  {
    id: "next-3",
    title: "3天",
    subtitle: "近期",
    startOffset: 0,
    endOffset: 3
  },
  {
    id: "next-7",
    title: "7天",
    subtitle: "本周",
    startOffset: 3,
    endOffset: 7
  },
  {
    id: "next-30",
    title: "1个月",
    subtitle: "稍后",
    startOffset: 7,
    endOffset: 30
  }
] as const;

function relativeDay(date: Date, today: Date, timezone?: string) {
  if (isSameLocalDay(date, today, timezone)) return "今天";
  if (isSameLocalDay(date, addDays(today, 1), timezone)) return "明天";
  return formatShortDate(date.toISOString(), timezone) ?? "";
}

function rangeLabel(start: Date, end: Date, timezone?: string) {
  const startText = formatShortDate(start.toISOString(), timezone);
  const endText = formatShortDate(addDays(end, -1).toISOString(), timezone);
  return startText === endText ? startText : `${startText} - ${endText}`;
}

function parentKey(kind: string, id: string) {
  return `${kind}:${id}`;
}

function hasRelatedRecord(state: AssistantState, kind: string, id: string) {
  if (kind === "task") return state.tasks.some((task) => task.id === id && task.status !== "cancelled");
  if (kind === "life_event") return state.lifeEvents.some((event) => event.id === id && event.status !== "cancelled");
  if (kind === "shopping_item") return state.shoppingItems.some((item) => item.id === id && item.status !== "removed");
  if (kind === "project") return state.projects.some((project) => project.id === id && project.status !== "done");
  if (kind === "memory") return state.memoryItems.some((memory) => memory.id === id && memory.status === "suggested");
  return false;
}

function buildCalendarItems(state: AssistantState, hiddenTaskIds = new Set<string>()) {
  const items: CalendarItem[] = [];
  const parents = new Map<string, CalendarItem>();

  function addItem(item: CalendarItem) {
    items.push(item);
    parents.set(parentKey(item.target.kind, item.id), item);
  }

  for (const task of state.tasks) {
    if (hiddenTaskIds.has(task.id)) continue;
    if (!task.dueAt || task.status === "done" || task.status === "cancelled") continue;
    addItem({
      id: task.id,
      title: task.title,
      kind: "task",
      target: { id: task.id, title: task.title, kind: "task" },
      at: new Date(task.dueAt),
      reminders: []
    });
  }

  for (const event of state.lifeEvents) {
    if (!event.startsAt || event.status === "done" || event.status === "cancelled") continue;
    addItem({
      id: event.id,
      title: event.title,
      kind: "event",
      target: { id: event.id, title: event.title, kind: "life_event" },
      at: new Date(event.startsAt),
      meta: event.location,
      reminders: []
    });
  }

  for (const item of state.shoppingItems) {
    if (!item.expectedAt || item.status === "bought" || item.status === "removed") continue;
    addItem({
      id: item.id,
      title: item.itemName,
      kind: "shopping",
      target: { id: item.id, title: item.itemName, kind: "shopping_item" },
      at: new Date(item.expectedAt),
      meta: item.status === "ordered" ? "到货" : "家务",
      reminders: []
    });
  }

  for (const checkIn of state.checkIns) {
    if (checkIn.status === "dismissed") continue;
    const reminder: CalendarReminder = {
      id: checkIn.id,
      title: checkIn.title,
      question: checkIn.question,
      target: { id: checkIn.id, title: checkIn.question, kind: "check_in" },
      at: new Date(checkIn.askAt),
      status: checkIn.status,
      meta: checkIn.relatedType
    };
    const parent = parents.get(parentKey(checkIn.relatedType, checkIn.relatedId));
    if (parent) {
      parent.reminders.push(reminder);
      continue;
    }
    if (checkIn.status !== "pending") continue;
    if (hasRelatedRecord(state, checkIn.relatedType, checkIn.relatedId)) continue;
    addItem({
      id: checkIn.id,
      title: checkIn.question,
      kind: "check",
      target: reminder.target,
      at: reminder.at,
      meta: checkIn.title,
      reminders: []
    });
  }

  items.forEach((item) => item.reminders.sort((left, right) => left.at.getTime() - right.at.getTime()));
  return items.sort((left, right) => left.at.getTime() - right.at.getTime());
}

export function CalendarView({
  state,
  compact = false,
  hiddenTaskIds,
  onCompleteItem,
  onDeleteItem,
  onDiscussItem,
  onRevertItem
}: {
  state: AssistantState;
  compact?: boolean;
  hiddenTaskIds?: string[];
  onCompleteItem: (target: AssistantItemRef) => void;
  onDeleteItem: (target: AssistantItemRef) => void;
  onDiscussItem: (target: AssistantItemRef) => void;
  onRevertItem: (target: AssistantItemRef) => void;
}) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const timezone = state.preferences.timezone;
  const today = startOfLocalDay(new Date());
  const items = buildCalendarItems(state, new Set(hiddenTaskIds ?? []));
  const titleId = useId();

  function toggleItem(key: string) {
    setExpandedItems((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className={compact ? "calendar-view compact-calendar" : "calendar-view"} aria-labelledby={titleId}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Schedule</p>
          <h2 id={titleId} className="section-headline">
            后续安排
          </h2>
        </div>
        <CalendarDays size={18} aria-hidden="true" />
      </div>

      <div className="calendar-horizons" role="list" aria-label="后续安排">
        {horizonCards.map((card) => {
          const start = addDays(today, card.startOffset);
          const end = addDays(today, card.endOffset);
          const cardItems = items.filter((item) => item.at >= start && item.at < end);
          return (
            <article
              className={`${cardItems.length ? "horizon-card has-items" : "horizon-card"} horizon-${card.id}`}
              key={card.id}
              role="listitem"
            >
              <div className="horizon-card-head">
                <div>
                  <p>{card.subtitle}</p>
                  <h3>{card.title}</h3>
                </div>
                <span aria-label={`${cardItems.length} scheduled items`}>{cardItems.length}</span>
              </div>
              <div className="horizon-range">{rangeLabel(start, end, timezone)}</div>
              <ul className="horizon-items" aria-label={`${card.title}安排`}>
                {cardItems.length ? (
                  cardItems.slice(0, 4).map((item) => {
                    const Icon = kindIcon[item.kind];
                    const itemKey = `${item.kind}-${item.id}`;
                    const isExpanded = Boolean(expandedItems[itemKey]);
                    return (
                      <li className={item.reminders.length ? "horizon-item-shell has-reminders" : "horizon-item-shell"} key={itemKey}>
                        <div className="horizon-item">
                          <div className="horizon-item-marker">
                            {item.reminders.length ? (
                              <button
                                className={isExpanded ? "horizon-disclosure expanded" : "horizon-disclosure"}
                                type="button"
                                onClick={() => toggleItem(itemKey)}
                                aria-label={`${isExpanded ? "收起" : "展开"}${item.title}的提醒`}
                                aria-expanded={isExpanded}
                              >
                                <ChevronRight size={13} aria-hidden="true" />
                              </button>
                            ) : (
                              <span className="horizon-disclosure-placeholder" aria-hidden="true" />
                            )}
                            <Icon size={14} aria-hidden="true" />
                          </div>
                          <div className="horizon-item-main">
                            <span>{item.title}</span>
                            <small>
                              {relativeDay(item.at, today, timezone)}
                              {" · "}
                              {formatTime(item.at.toISOString(), timezone)}
                              {item.meta ? (
                                <>
                                  {" · "}
                                  {item.kind === "event" ? <MapPin size={11} aria-hidden="true" /> : null}
                                  {item.meta}
                                </>
                              ) : null}
                              {item.reminders.length ? ` · ${item.reminders.length}个提醒` : ""}
                            </small>
                          </div>
                          <ItemActionButtons
                            className="hide-in-display"
                            target={item.target}
                            onComplete={onCompleteItem}
                            onDelete={onDeleteItem}
                            onDiscuss={onDiscussItem}
                          />
                        </div>
                        {item.reminders.length && isExpanded ? (
                          <ul className="related-reminders horizon-related-reminders" aria-label={`${item.title}的提醒`}>
                            {item.reminders.map((reminder) => (
                              <li
                                className={reminder.status === "answered" ? "related-reminder completed" : "related-reminder"}
                                key={reminder.id}
                              >
                                <Clock size={13} aria-hidden="true" />
                                <div className="related-reminder-main">
                                  <span>{reminder.title}</span>
                                  <small>
                                    {relativeDay(reminder.at, today, timezone)}
                                    {" · "}
                                    {formatTime(reminder.at.toISOString(), timezone)}
                                    {reminder.status === "answered" ? " · 已完成" : ""}
                                  </small>
                                  <p>{reminder.question}</p>
                                </div>
                                <ItemActionButtons
                                  className="hide-in-display compact-actions"
                                  target={reminder.target}
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
                  <li className="calendar-empty">暂无安排</li>
                )}
                {cardItems.length > 4 ? <li className="calendar-more">+{cardItems.length - 4} 条</li> : null}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
