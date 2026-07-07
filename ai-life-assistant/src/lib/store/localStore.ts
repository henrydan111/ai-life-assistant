"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AiProcessingUpdate,
  AssistantItemRef,
  AssistantState,
  MemoryItem,
  ParseFeedback,
  Task,
  TranscriptRepair,
  UserPreferences
} from "@/types/domain";
import { nowIso } from "@/lib/time/parseTime";
import { createId } from "@/lib/id";
import { defaultAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import { compactMemoryItems } from "@/lib/memory/compactMemoryItems";

const STORAGE_KEY = "ai-life-assistant-state-v1";
const legacyDefaultLanguageModel = "doubao-seed-2.0-lite";
const previousDefaultLanguageModel = "deepseek-v4-flash";
const modelChoiceVersion = 2;

type LegacyUserPreferences = UserPreferences & {
  maxDailyTasks?: number;
};

type LegacyAssistantState = AssistantState & {
  memoryItems?: MemoryItem[];
};

type SubmitInputOptions = {
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
};

type ProgressReporter = (update: AiProcessingUpdate) => void;

type InterpretStreamMessage =
  | ({ type: "progress" } & AiProcessingUpdate)
  | {
      type: "result";
      state?: AssistantState;
      feedback?: ParseFeedback;
      error?: string;
    };

function normalizePreferences(preferences: LegacyUserPreferences): UserPreferences {
  const { maxDailyTasks: _maxDailyTasks, ...currentPreferences } = preferences;
  const shouldUseCurrentDefault =
    !currentPreferences.languageModel ||
    currentPreferences.languageModel === legacyDefaultLanguageModel ||
    (!currentPreferences.modelChoiceVersion && currentPreferences.languageModel === previousDefaultLanguageModel);

  return {
    ...currentPreferences,
    languageModel: shouldUseCurrentDefault ? defaultAgentPlanLanguageModel : currentPreferences.languageModel,
    modelChoiceVersion
  };
}

const travelPrepCategories = [
  {
    key: "ticket",
    pattern: /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返/,
    title: "确认高铁票",
    question: "高铁票订好了吗？"
  },
  {
    key: "luggage",
    pattern: /行李|收拾/,
    title: "收拾行李",
    question: "行李收拾好了吗？"
  },
  {
    key: "restaurant",
    pattern: /餐馆|餐厅|饭店|餐位|订位|定位置|订位置|定座|订座|定座位|订座位/,
    title: "预订餐馆位置",
    question: "餐馆位置订好了吗？"
  }
] as const;

function travelPrepCategoriesIn(text: string) {
  return travelPrepCategories.filter((category) => category.pattern.test(text));
}

function hasSeparateTravelPrepCheckIn(
  checkIns: AssistantState["checkIns"],
  relatedId: string,
  category: (typeof travelPrepCategories)[number]
) {
  return checkIns.some((checkIn) => {
    if (checkIn.status !== "pending" || checkIn.relatedType !== "life_event" || checkIn.relatedId !== relatedId) {
      return false;
    }
    const text = `${checkIn.title} ${checkIn.question}`;
    return category.pattern.test(text) && travelPrepCategoriesIn(text).length === 1;
  });
}

function askAtForTravelPrep(
  state: AssistantState,
  checkIn: AssistantState["checkIns"][number],
  category: (typeof travelPrepCategories)[number]
) {
  if (category.key !== "restaurant") return checkIn.askAt;
  const text = `${checkIn.title} ${checkIn.question}`;
  const event = state.lifeEvents.find((item) => item.id === checkIn.relatedId);
  const eventDay = event?.startsAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (eventDay && /(周日|周天|当天|下午|餐馆|餐厅|饭店|订位|定位置|订位置)/.test(text)) {
    return `${eventDay}T15:00:00+08:00`;
  }
  return checkIn.askAt;
}

function splitCombinedTravelPrepCheckIns(state: AssistantState): AssistantState {
  const additions: AssistantState["checkIns"] = [];
  const checkIns = state.checkIns.map((checkIn) => {
    if (checkIn.status !== "pending" || checkIn.relatedType !== "life_event") return checkIn;
    const categories = travelPrepCategoriesIn(`${checkIn.title} ${checkIn.question}`);
    if (categories.length <= 1) return checkIn;

    categories.forEach((category) => {
      const alreadyExists =
        hasSeparateTravelPrepCheckIn(state.checkIns, checkIn.relatedId, category) ||
        hasSeparateTravelPrepCheckIn(additions, checkIn.relatedId, category);
      if (alreadyExists) return;
      additions.push({
        id: createId("check"),
        title: category.title,
        question: category.question,
        relatedType: checkIn.relatedType,
        relatedId: checkIn.relatedId,
        askAt: askAtForTravelPrep(state, checkIn, category),
        status: "pending",
        createdAt: checkIn.createdAt
      });
    });

    return { ...checkIn, status: "dismissed" as const };
  });

  return additions.length ? { ...state, checkIns: [...additions, ...checkIns] } : { ...state, checkIns };
}

function normalizeAssistantState(state: LegacyAssistantState): AssistantState {
  const normalized: AssistantState = {
    ...state,
    preferences: normalizePreferences(state.preferences),
    lifeEvents: state.lifeEvents.map((event) => ({
      ...event,
      priority: event.priority ?? "medium"
    })),
    memoryItems: compactMemoryItems(state.memoryItems ?? [])
  };

  return splitCombinedTravelPrepCheckIns(normalized);
}

export function createDefaultState(): AssistantState {
  const now = nowIso();
  return {
    version: 1,
    preferences: {
      displayName: "Dan",
      preferredLanguage: "zh",
      languageModel: defaultAgentPlanLanguageModel,
      modelChoiceVersion,
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
    memoryItems: [],
    inputs: []
  };
}

export function loadAssistantState() {
  if (typeof window === "undefined") return createDefaultState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDefaultState();
  try {
    const parsed = JSON.parse(raw) as LegacyAssistantState;
    if (parsed.version !== 1) return createDefaultState();
    return normalizeAssistantState(parsed);
  } catch {
    return createDefaultState();
  }
}

export function saveAssistantState(state: AssistantState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dismissRelatedCheckIns(
  checkIns: AssistantState["checkIns"],
  relatedType: AssistantState["checkIns"][number]["relatedType"],
  relatedId: string
) {
  return checkIns.map((checkIn) =>
    checkIn.status === "pending" && checkIn.relatedType === relatedType && checkIn.relatedId === relatedId
      ? { ...checkIn, status: "dismissed" as const }
      : checkIn
  );
}

async function submitInputWithProgress(
  rawText: string,
  inputType: "text" | "voice",
  state: AssistantState,
  onProgress: ProgressReporter,
  options: SubmitInputOptions = {}
) {
  const response = await fetch("/api/ai/interpret-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawText,
      originalText: options.originalText,
      transcriptRepair: options.transcriptRepair,
      inputType,
      state,
      model: state.preferences.languageModel
    })
  });

  if (!response.ok || !response.body) {
    throw new Error("AI progress stream failed.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: { state: AssistantState; feedback: ParseFeedback } | undefined;
  let finalError: string | undefined;

  function handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message = JSON.parse(trimmed) as InterpretStreamMessage;
    if (message.type === "progress") {
      onProgress({
        stage: message.stage,
        status: message.status,
        title: message.title,
        detail: message.detail
      });
      return;
    }
    if (message.type === "result") {
      if (message.state && message.feedback) {
        finalResult = { state: message.state, feedback: message.feedback };
      } else if (message.error) {
        finalError = message.error;
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handleLine);
  }

  buffer += decoder.decode();
  handleLine(buffer);

  if (!finalResult && finalError) {
    throw new Error(finalError);
  }
  if (!finalResult) {
    throw new Error("AI progress stream finished without a result.");
  }

  return finalResult;
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
      async submitInput(
        rawText: string,
        inputType: "text" | "voice" = "text",
        onProgress?: ProgressReporter,
        options: SubmitInputOptions = {}
      ) {
        if (onProgress) {
          const result = await submitInputWithProgress(rawText, inputType, state, onProgress, options);
          setState(normalizeAssistantState(result.state));
          return result.feedback;
        }

        const response = await fetch("/api/ai/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawText,
            originalText: options.originalText,
            transcriptRepair: options.transcriptRepair,
            inputType,
            state,
            model: state.preferences.languageModel
          })
        });
        const result = (await response.json()) as { state?: AssistantState; feedback?: ParseFeedback; error?: string };
        if (!response.ok || !result.state || !result.feedback) {
          throw new Error(result.error ?? "AI interpretation failed.");
        }
        setState(normalizeAssistantState(result.state));
        return result.feedback;
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
      confirmMemory(memoryId: string) {
        const now = nowIso();
        setState((current) => ({
          ...current,
          memoryItems: current.memoryItems.map((memory) =>
            memory.id === memoryId ? { ...memory, status: "active", confidence: Math.max(memory.confidence, 0.85), updatedAt: now } : memory
          ),
          checkIns: current.checkIns.map((checkIn) =>
            checkIn.relatedId === memoryId && checkIn.status === "pending" ? { ...checkIn, status: "answered" } : checkIn
          )
        }));
      },
      updateMemorySummary(memoryId: string, summary: string) {
        const nextSummary = summary.trim();
        if (!nextSummary) return;
        const now = nowIso();
        setState((current) => ({
          ...current,
          memoryItems: current.memoryItems.map((memory) =>
            memory.id === memoryId ? { ...memory, summary: nextSummary.slice(0, 100), status: "active", updatedAt: now } : memory
          ),
          checkIns: current.checkIns.map((checkIn) =>
            checkIn.relatedId === memoryId && checkIn.status === "pending" ? { ...checkIn, status: "answered" } : checkIn
          )
        }));
      },
      forgetMemory(memoryId: string) {
        const now = nowIso();
        setState((current) => ({
          ...current,
          memoryItems: current.memoryItems.map((memory) =>
            memory.id === memoryId ? { ...memory, status: "rejected", updatedAt: now } : memory
          ),
          checkIns: current.checkIns.map((checkIn) =>
            checkIn.relatedId === memoryId && checkIn.status === "pending" ? { ...checkIn, status: "dismissed" } : checkIn
          )
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
      reopenItem(target: AssistantItemRef) {
        const now = nowIso();
        setState((current) => {
          if (target.kind === "task") {
            return {
              ...current,
              tasks: current.tasks.map((task) =>
                task.id === target.id ? { ...task, status: "todo", updatedAt: now } : task
              )
            };
          }
          if (target.kind === "life_event") {
            return {
              ...current,
              lifeEvents: current.lifeEvents.map((event) =>
                event.id === target.id ? { ...event, status: "planned", updatedAt: now } : event
              )
            };
          }
          if (target.kind === "shopping_item") {
            return {
              ...current,
              shoppingItems: current.shoppingItems.map((item) =>
                item.id === target.id ? { ...item, status: "needed", updatedAt: now } : item
              )
            };
          }
          return {
            ...current,
            checkIns: current.checkIns.map((checkIn) =>
              checkIn.id === target.id ? { ...checkIn, status: "pending" } : checkIn
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
              ),
              checkIns: dismissRelatedCheckIns(current.checkIns, "task", target.id)
            };
          }
          if (target.kind === "life_event") {
            return {
              ...current,
              lifeEvents: current.lifeEvents.map((event) =>
                event.id === target.id ? { ...event, status: "cancelled", updatedAt: now } : event
              ),
              checkIns: dismissRelatedCheckIns(current.checkIns, "life_event", target.id)
            };
          }
          if (target.kind === "shopping_item") {
            return {
              ...current,
              shoppingItems: current.shoppingItems.map((item) =>
                item.id === target.id ? { ...item, status: "removed", updatedAt: now } : item
              ),
              checkIns: dismissRelatedCheckIns(current.checkIns, "shopping_item", target.id)
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
        setState(normalizeAssistantState(result.state));
        return result.feedback;
      }
    }),
    [state]
  );

  return { state, hydrated, ...actions };
}
