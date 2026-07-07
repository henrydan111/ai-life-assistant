"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssistantItemRef, AssistantState, ParseFeedback, Task, UserPreferences } from "@/types/domain";
import { nowIso } from "@/lib/time/parseTime";
import { createId } from "@/lib/id";
import { defaultAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";

const STORAGE_KEY = "ai-life-assistant-state-v1";
const legacyDefaultLanguageModel = "doubao-seed-2.0-lite";

type LegacyUserPreferences = UserPreferences & {
  maxDailyTasks?: number;
};

type LocalResolution = {
  state: AssistantState;
  feedback: ParseFeedback;
};

function normalizePreferences(preferences: LegacyUserPreferences): UserPreferences {
  const { maxDailyTasks: _maxDailyTasks, ...currentPreferences } = preferences;
  return {
    ...currentPreferences,
    languageModel:
      !currentPreferences.languageModel || currentPreferences.languageModel === legacyDefaultLanguageModel
        ? defaultAgentPlanLanguageModel
        : currentPreferences.languageModel
  };
}

function dateAt(date: Date, hour: number, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next.toISOString();
}

function previousDayAt(iso: string, hour: number, minute = 0) {
  const date = new Date(iso);
  date.setDate(date.getDate() - 1);
  return dateAt(date, hour, minute);
}

function thisOrNextWeekday(target: number, base = new Date()) {
  const date = new Date(base);
  const current = date.getDay();
  let delta = target - current;
  if (delta < 0) delta += 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function todayAt(hour: number, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function tonightSleepDueAt() {
  return todayAt(23, 59);
}

function normalizeTonightSleepDueAt(existingDueAt?: string) {
  if (!existingDueAt) return tonightSleepDueAt();
  const date = new Date(existingDueAt);
  if (Number.isNaN(date.getTime())) return tonightSleepDueAt();
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    date.setMinutes(date.getMinutes() - 1);
  }
  return date.toISOString();
}

function sleepReminderAt(dueAt = tonightSleepDueAt()) {
  const due = new Date(dueAt);
  const reminder = new Date(due);
  reminder.setHours(reminder.getHours() - 2, reminder.getMinutes(), 0, 0);
  if (reminder.getTime() > Date.now() || due.getTime() <= Date.now()) return reminder.toISOString();

  const lateReminder = new Date(due);
  lateReminder.setHours(Math.max(0, lateReminder.getHours() - 1), lateReminder.getMinutes(), 0, 0);
  return lateReminder.toISOString();
}

function pendingCheckInExists(state: AssistantState, relatedId: string, pattern: RegExp) {
  return state.checkIns.some(
    (checkIn) =>
      checkIn.status === "pending" &&
      checkIn.relatedId === relatedId &&
      pattern.test(`${checkIn.title} ${checkIn.question}`)
  );
}

function sleepReminderExists(state: AssistantState, relatedId: string) {
  return state.checkIns.some(
    (checkIn) =>
      checkIn.status === "pending" &&
      checkIn.relatedType === "task" &&
      checkIn.relatedId === relatedId &&
      /睡前|准备睡觉|休息/.test(`${checkIn.title} ${checkIn.question}`)
  );
}

function addSleepReminderIfNeeded(state: AssistantState, taskId: string, dueAt = tonightSleepDueAt()) {
  if (sleepReminderExists(state, taskId)) return state;
  const now = nowIso();
  return {
    ...state,
    checkIns: [
      {
        id: createId("check"),
        title: "睡前提醒",
        question: "快到睡觉时间了，开始准备休息吗？",
        relatedType: "task" as const,
        relatedId: taskId,
        askAt: sleepReminderAt(dueAt),
        status: "pending" as const,
        createdAt: now
      },
      ...state.checkIns
    ]
  };
}

function isSleepClarification(checkIn: AssistantState["checkIns"][number]) {
  return (
    checkIn.status === "pending" &&
    checkIn.relatedType === "task" &&
    /确认睡觉提醒时间|今天12点前|12:00 前|24:00 前|睡前/.test(`${checkIn.title} ${checkIn.question}`)
  );
}

function isTonightSleepAnswer(rawText: string) {
  return /(今晚|晚上|24[:：]?00|24点|二十四点|零点|0点)/.test(rawText) && /(睡|休息|前)/.test(rawText);
}

function resolveSleepClarification(state: AssistantState, rawText: string, inputType: "text" | "voice"): LocalResolution | undefined {
  if (!isTonightSleepAnswer(rawText)) return undefined;
  const clarification = state.checkIns.find(isSleepClarification);
  if (!clarification) return undefined;
  const targetTask = state.tasks.find((task) => task.id === clarification.relatedId && task.status !== "cancelled");
  if (!targetTask || !/睡觉|睡|休息|12点/.test(targetTask.title)) return undefined;

  const now = nowIso();
  const inputId = createId("input");
  const dueAt = tonightSleepDueAt();
  const updated: AssistantState = {
    ...state,
    inputs: [
      {
        id: inputId,
        rawText,
        inputType,
        parsedSummary: "确认睡觉时间",
        createdAt: now
      },
      ...state.inputs
    ].slice(0, 60),
    tasks: state.tasks.map((task) =>
      task.id === targetTask.id
        ? {
            ...task,
            title: "今晚24:00前睡觉",
            horizon: "today",
            dueAt,
            priority: "medium",
            energyRequired: "low",
            updatedAt: now
          }
        : task
    ),
    checkIns: state.checkIns.map((checkIn) =>
      checkIn.id === clarification.id ? { ...checkIn, status: "answered" as const } : checkIn
    )
  };

  return {
    state: addSleepReminderIfNeeded(updated, targetTask.id, dueAt),
    feedback: {
      title: "已更新睡觉时间",
      detail: "我已把这条待办更新为今晚 24:00 前睡觉，并把睡前提醒放在事项下面。"
    }
  };
}

function repairStoredLifeSemantics(state: AssistantState): AssistantState {
  const now = nowIso();
  let next = state;
  const clarifiedSleepTask = next.tasks.find(
    (task) => task.status !== "cancelled" && /(今晚|24[:：]?00|24点|二十四点|零点|0点).*睡/.test(task.title)
  );

  if (clarifiedSleepTask) {
    const dueAt = normalizeTonightSleepDueAt(clarifiedSleepTask.dueAt);
    next = {
      ...next,
      tasks: next.tasks
        .filter((task) => task.id === clarifiedSleepTask.id || !/今天12点前睡觉/.test(task.title))
        .map((task) =>
          task.id === clarifiedSleepTask.id
            ? {
                ...task,
                title: "今晚24:00前睡觉",
                horizon: "today",
                dueAt,
                priority: "medium",
                energyRequired: "low",
                updatedAt: now
              }
            : task
        ),
      checkIns: next.checkIns.map((checkIn) =>
        isSleepClarification(checkIn) ? { ...checkIn, status: "answered" as const } : checkIn
      )
    };
    next = addSleepReminderIfNeeded(next, clarifiedSleepTask.id, dueAt);
  }

  if (!clarifiedSleepTask) {
    next = {
      ...next,
      tasks: next.tasks.map((task) => {
        if (task.status === "cancelled" || !/12点前睡觉/.test(task.title)) return task;
        const { dueAt: _dueAt, ...withoutDueAt } = task;
        return {
          ...withoutDueAt,
          title: "今天12点前睡觉",
          priority: "medium",
          updatedAt: now
        };
      })
    };
  }

  const sleepTask = next.tasks.find((task) => task.status !== "cancelled" && /12点前睡觉/.test(task.title));
  if (sleepTask && !pendingCheckInExists(next, sleepTask.id, /睡觉|睡前|12点|十二点/)) {
    next = {
      ...next,
      checkIns: [
        {
          id: createId("check"),
          title: "确认睡觉提醒时间",
          question: "你说的今天12点前，是今晚 24:00 前睡，还是中午 12:00 前休息？确认后我会把提醒放在睡前 1-2 小时。",
          relatedType: "task",
          relatedId: sleepTask.id,
          askAt: now,
          status: "pending",
          createdAt: now
        },
        ...next.checkIns
      ]
    };
  }

  const thursdayLeave = next.tasks.find((task) => task.status !== "cancelled" && /申请周四请假/.test(task.title));
  const fridayLeave = next.tasks.find((task) => task.status !== "cancelled" && /申请周五请假/.test(task.title));
  if (thursdayLeave && fridayLeave) {
    const firstLeaveIso = thursdayLeave.dueAt ?? dateAt(thisOrNextWeekday(4), 9);
    next = {
      ...next,
      tasks: next.tasks
        .filter((task) => task.id !== fridayLeave.id)
        .map((task) =>
          task.id === thursdayLeave.id
            ? {
                ...task,
                title: "申请周四和周五请假",
                description: "请假日期：周四至周五。提前和老板沟通并确认。",
                horizon: "this_week",
                dueAt: previousDayAt(firstLeaveIso, 17),
                priority: "high",
                updatedAt: now
              }
            : task
        )
    };
  }

  const leaveTask = next.tasks.find((task) => task.status !== "cancelled" && /申请周四和周五请假/.test(task.title));
  if (leaveTask && !pendingCheckInExists(next, leaveTask.id, /老板|请假前确认/)) {
    const firstLeaveIso = thursdayLeave?.dueAt ?? dateAt(thisOrNextWeekday(4), 9);
    next = {
      ...next,
      checkIns: [
        {
          id: createId("check"),
          title: "请假前确认",
          question: "已经提前和老板说周四、周五请假的事了吗？",
          relatedType: "task",
          relatedId: leaveTask.id,
          askAt: previousDayAt(firstLeaveIso, 10),
          status: "pending",
          createdAt: now
        },
        ...next.checkIns
      ]
    };
  }

  const shanghaiEvents = next.lifeEvents.filter(
    (event) => event.status !== "cancelled" && /上海/.test(`${event.title} ${event.location ?? ""}`)
  );
  const groupedShanghaiEvents = shanghaiEvents.filter(
    (event) =>
      event.sourceInputId &&
      shanghaiEvents.some((candidate) => candidate.id !== event.id && candidate.sourceInputId === event.sourceInputId)
  );
  const shanghaiTrip = groupedShanghaiEvents.find((event) => /去上海/.test(event.title)) ?? groupedShanghaiEvents[0];
  if (shanghaiTrip) {
    const startsAt = dateAt(shanghaiTrip.startsAt ? new Date(shanghaiTrip.startsAt) : thisOrNextWeekday(0), 19);
    const removedEventIds = groupedShanghaiEvents.filter((event) => event.id !== shanghaiTrip.id).map((event) => event.id);
    next = {
      ...next,
      lifeEvents: next.lifeEvents
        .filter((event) => !removedEventIds.includes(event.id))
        .map((event) =>
          event.id === shanghaiTrip.id
            ? {
                ...event,
                title: "周日晚上去上海吃晚饭",
                description: "高铁往返；到上海吃晚饭。",
                category: "travel",
                startsAt,
                location: "上海",
                updatedAt: now
              }
            : event
        ),
      tasks: next.tasks.filter(
        (task) =>
          !(
            task.status !== "cancelled" &&
            /高铁|订票|订高铁票/.test(task.title) &&
            (!task.sourceInputId || task.sourceInputId === shanghaiTrip.sourceInputId)
          )
      ),
      checkIns: next.checkIns.filter((checkIn) => {
        const text = `${checkIn.title} ${checkIn.question}`;
        return !(removedEventIds.includes(checkIn.relatedId) || /高铁票|订高铁票|上海行前/.test(text));
      })
    };

    if (!pendingCheckInExists(next, shanghaiTrip.id, /高铁票|行李|上海行前/)) {
      next = {
        ...next,
        checkIns: [
          {
            id: createId("check"),
            title: "上海行前确认",
            question: "高铁票订好了吗？行李收拾好了吗？",
            relatedType: "life_event",
            relatedId: shanghaiTrip.id,
            askAt: previousDayAt(startsAt, 20),
            status: "pending",
            createdAt: now
          },
          ...next.checkIns
        ]
      };
    }
  }

  return next;
}

function saveRawInputFallback(state: AssistantState, rawText: string, inputType: "text" | "voice") {
  const now = nowIso();
  const inputId = createId("input");
  return {
    state: {
      ...state,
      inputs: [
        {
          id: inputId,
          rawText,
          inputType,
          parsedSummary: "Saved raw input",
          createdAt: now
        },
        ...state.inputs
      ].slice(0, 60),
      tasks: [
        {
          id: createId("task"),
          title: rawText.length > 48 ? `${rawText.slice(0, 48)}...` : rawText,
          description: rawText,
          type: "task" as const,
          horizon: "today" as const,
          energyRequired: "low" as const,
          priority: "medium" as const,
          status: "todo" as const,
          sourceInputId: inputId,
          confidence: 0.35,
          createdAt: now,
          updatedAt: now
        },
        ...state.tasks
      ]
    },
    feedback: {
      title: "已暂存",
      detail: "AI 解析暂时失败，但我已经保存了你的原文，避免这次输入丢失。"
    }
  };
}

export function createDefaultState(): AssistantState {
  const now = nowIso();
  return {
    version: 1,
    preferences: {
      displayName: "Dan",
      preferredLanguage: "zh",
      languageModel: defaultAgentPlanLanguageModel,
      wakeTime: "07:30",
      sleepTime: "23:30",
      planningStyle: "balanced",
      informationInterests: ["AI life assistant", "personal productivity", "calm dashboard"]
    },
    tasks: [
      {
        id: createId("task"),
        title: "Sketch AI life assistant POC",
        type: "project_step",
        horizon: "today",
        energyRequired: "medium",
        priority: "high",
        status: "todo",
        confidence: 1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: createId("task"),
        title: "Test dashboard on a spare screen",
        type: "task",
        horizon: "this_week",
        energyRequired: "low",
        priority: "medium",
        status: "todo",
        confidence: 1,
        createdAt: now,
        updatedAt: now
      }
    ],
    projects: [
      {
        id: createId("project"),
        title: "AI life assistant POC",
        description: "Browser-first calm dashboard with universal capture.",
        status: "active",
        progressPercent: 30,
        createdAt: now,
        updatedAt: now
      }
    ],
    shoppingItems: [
      {
        id: createId("shop"),
        itemName: "paper towels",
        status: "needed",
        category: "household",
        createdAt: now,
        updatedAt: now
      }
    ],
    moodLogs: [],
    lifeEvents: [],
    checkIns: [],
    recurrenceCandidates: [],
    inputs: []
  };
}

export function loadAssistantState() {
  if (typeof window === "undefined") return createDefaultState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDefaultState();
  try {
    const parsed = JSON.parse(raw) as AssistantState;
    if (parsed.version !== 1) return createDefaultState();
    return repairStoredLifeSemantics({
      ...parsed,
      preferences: normalizePreferences(parsed.preferences)
    });
  } catch {
    return createDefaultState();
  }
}

export function saveAssistantState(state: AssistantState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function useAssistantStore() {
  const [state, setState] = useState<AssistantState>(() => createDefaultState());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadAssistantState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveAssistantState(state);
  }, [hydrated, state]);

  const actions = useMemo(
    () => ({
      async submitInput(rawText: string, inputType: "text" | "voice" = "text") {
        const localResolution = resolveSleepClarification(state, rawText, inputType);
        if (localResolution) {
          setState(localResolution.state);
          return localResolution.feedback;
        }

        try {
          const response = await fetch("/api/ai/interpret", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rawText, inputType, state, model: state.preferences.languageModel })
          });
          const result = (await response.json()) as { state?: AssistantState; feedback?: ParseFeedback; error?: string };
          if (!response.ok || !result.state || !result.feedback) {
            throw new Error(result.error ?? "AI interpretation failed.");
          }
          setState(result.state);
          return result.feedback;
        } catch {
          const fallback = saveRawInputFallback(state, rawText, inputType);
          setState(fallback.state);
          return fallback.feedback;
        }
      },
      completeTask(taskId: string) {
        const now = nowIso();
        setState((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId ? { ...task, status: "done", updatedAt: now } : task
          )
        }));
      },
      deferTask(taskId: string) {
        const now = nowIso();
        setState((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId ? { ...task, status: "deferred", horizon: "later", updatedAt: now } : task
          )
        }));
      },
      markShoppingBought(itemId: string) {
        const now = nowIso();
        setState((current) => ({
          ...current,
          shoppingItems: current.shoppingItems.map((item) =>
            item.id === itemId ? { ...item, status: "bought", updatedAt: now } : item
          )
        }));
      },
      dismissCheckIn(checkInId: string) {
        setState((current) => ({
          ...current,
          checkIns: current.checkIns.map((checkIn) =>
            checkIn.id === checkInId ? { ...checkIn, status: "dismissed" } : checkIn
          )
        }));
      },
      answerCheckIn(checkInId: string) {
        setState((current) => ({
          ...current,
          checkIns: current.checkIns.map((checkIn) =>
            checkIn.id === checkInId ? { ...checkIn, status: "answered" } : checkIn
          )
        }));
      },
      updatePreferences(preferences: AssistantState["preferences"]) {
        setState((current) => ({ ...current, preferences: normalizePreferences(preferences) }));
      },
      reset() {
        setState(createDefaultState());
      },
      updateTask(task: Task) {
        setState((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? task : item))
        }));
      },
      completeItem(target: AssistantItemRef) {
        const now = nowIso();
        setState((current) => {
          if (target.kind === "task") {
            return {
              ...current,
              tasks: current.tasks.map((task) =>
                task.id === target.id ? { ...task, status: "done", updatedAt: now } : task
              )
            };
          }
          if (target.kind === "life_event") {
            return {
              ...current,
              lifeEvents: current.lifeEvents.map((event) =>
                event.id === target.id ? { ...event, status: "done", updatedAt: now } : event
              )
            };
          }
          if (target.kind === "shopping_item") {
            return {
              ...current,
              shoppingItems: current.shoppingItems.map((item) =>
                item.id === target.id ? { ...item, status: "bought", updatedAt: now } : item
              )
            };
          }
          return {
            ...current,
            checkIns: current.checkIns.map((checkIn) =>
              checkIn.id === target.id ? { ...checkIn, status: "answered" } : checkIn
            )
          };
        });
      },
      deleteItem(target: AssistantItemRef) {
        const now = nowIso();
        setState((current) => {
          if (target.kind === "task") {
            return {
              ...current,
              tasks: current.tasks.map((task) =>
                task.id === target.id ? { ...task, status: "cancelled", updatedAt: now } : task
              )
            };
          }
          if (target.kind === "life_event") {
            return {
              ...current,
              lifeEvents: current.lifeEvents.map((event) =>
                event.id === target.id ? { ...event, status: "cancelled", updatedAt: now } : event
              )
            };
          }
          if (target.kind === "shopping_item") {
            return {
              ...current,
              shoppingItems: current.shoppingItems.map((item) =>
                item.id === target.id ? { ...item, status: "removed", updatedAt: now } : item
              )
            };
          }
          return {
            ...current,
            checkIns: current.checkIns.map((checkIn) =>
              checkIn.id === target.id ? { ...checkIn, status: "dismissed" } : checkIn
            )
          };
        });
      },
      async updateItemByConversation(
        target: AssistantItemRef,
        rawText: string,
        inputType: "text" | "voice" = "text"
      ): Promise<ParseFeedback> {
        const response = await fetch("/api/ai/update-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawText, inputType, target, state, model: state.preferences.languageModel })
        });
        const result = (await response.json()) as { state?: AssistantState; feedback?: ParseFeedback; error?: string };
        if (!response.ok || !result.state || !result.feedback) {
          throw new Error(result.error ?? "AI item update failed.");
        }
        setState(result.state);
        return result.feedback;
      }
    }),
    [state]
  );

  return { state, hydrated, ...actions };
}
