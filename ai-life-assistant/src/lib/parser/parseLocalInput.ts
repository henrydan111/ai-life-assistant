import type {
  AssistantCheckIn,
  AssistantState,
  LifeEvent,
  ParseFeedback,
  RecurrenceCandidate,
  RoutineGoal,
  ShoppingItem,
  Task
} from "@/types/domain";
import { createId } from "@/lib/id";
import { dayBeforeAt, isSameLocalDay, nowIso, parseDueDate } from "@/lib/time/parseTime";
import { resolveRecurringSleepTarget } from "@/lib/ai/agentPlan/temporalPolicy";

type ParseResult = {
  state: AssistantState;
  feedback: ParseFeedback;
};

type ParseOptions = {
  inputId?: string;
  appendInput?: boolean;
};

const shoppingVerbs = /\b(buy|get|pick up|order)\b|买|采购|下单|没了|没有了|用完了|缺|不够/;
const tiredWords = /\b(tired|exhausted|low energy|overwhelmed)\b|累|疲惫|没睡好|低能量|压力大/;
const doneWords = /\b(done|finished|completed|bought|ordered)\b|完成了|做完了|搞定了|买好了|已买|下单了|已经下单/;
const travelWords = /\b(go to|travel to|trip to|visit)\b|去|出差|出游|旅行/;
const classWords = /class|lesson|兴趣班|补习|课程|接送/;
const taskIntentWords = /\b(send|finish|call|email|review|remind|complete|prepare|write)\b|完成|发送|打电话|整理|准备|写/;
const noOpWords = /^(谢谢|谢了|谢啦|好的|好|收到|嗯|嗯嗯|行|可以|没问题|不用了|不用|没事了|算了|先不用|先别|刚才说错了|说错了|不是这个意思|ok|okay|ok好的|thanks|thank you|never mind|nevermind|cancel that)$/i;
const noOpTokens = /^(谢谢|谢了|谢啦|好的|好|收到|嗯|嗯嗯|行|可以|没问题|不用了|不用|没事了|算了|ok|okay|thanks)$/i;

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[，。,.!?！？]/g, " ");
}

function findShoppingItems(text: string) {
  const lower = normalize(text);
  const known = [
    ["milk", "milk"],
    ["牛奶", "牛奶"],
    ["paper towels", "paper towels"],
    ["纸巾", "纸巾"],
    ["detergent", "detergent"],
    ["洗衣液", "洗衣液"],
    ["eggs", "eggs"],
    ["鸡蛋", "鸡蛋"],
    ["coffee", "coffee"],
    ["咖啡", "咖啡"]
  ];
  const found = known.filter(([needle]) => lower.includes(needle)).map(([, item]) => item);
  if (found.length > 0) return Array.from(new Set(found));

  const buyMatch = lower.match(/(?:buy|get|pick up|order)\s+([a-zA-Z][a-zA-Z\s-]{1,36})/);
  if (buyMatch) return [buyMatch[1].trim().replace(/\s+(tonight|today|tomorrow)$/i, "")];

  const chineseBuy = text.match(/(?:买|采购|下单)([^，。,.!?！？]{1,18})/);
  if (chineseBuy) {
    return chineseBuy[1]
      .split(/和|、|,|，/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function taskTitleFromInput(text: string) {
  return text
    .replace(/\b(i need to|need to|please|remind me to|tomorrow|today)\b/gi, "")
    .replace(/我需要|帮我|提醒我|今天|明天/g, "")
    .trim()
    .replace(/[。.!！?？]$/, "");
}

function titleCase(text: string) {
  if (/[\u4e00-\u9fa5]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isRecurringSleepInput(text: string) {
  return /(每天|每日|天天|每晚|daily|every day|every night)/i.test(text) && /(睡觉|睡|上床|休息)/.test(text);
}

function shoppingTaskTitle(itemName: string) {
  return /[\u4e00-\u9fa5]/.test(itemName) ? `买${itemName}` : `Buy ${itemName}`;
}

function similar(a: string, b: string) {
  const left = normalize(a);
  const right = normalize(b);
  return left.includes(right) || right.includes(left);
}

function sameDueWindow(left?: string, right?: string) {
  if (!left || !right) return true;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return left === right;
  return isSameLocalDay(leftDate, rightDate);
}

function findOpenTask(tasks: Task[], title: string, dueAt?: string) {
  return tasks.find(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      similar(task.title, title) &&
      sameDueWindow(task.dueAt, dueAt)
  );
}

function shouldCloseShoppingTask(task: Task, itemName: string) {
  if (task.status === "done" || task.status === "cancelled") return false;
  return (
    similar(task.title, itemName) &&
    (similar(task.title, shoppingTaskTitle(itemName)) || /\b(buy|get|pick up|order)\b|买|采购|下单/.test(normalize(task.title)))
  );
}

function closeShoppingTasks(tasks: Task[], itemNames: string[], now: string) {
  if (!itemNames.length) return tasks;
  return tasks.map((task) =>
    itemNames.some((itemName) => shouldCloseShoppingTask(task, itemName))
      ? { ...task, status: "done" as const, updatedAt: now }
      : task
  );
}

function findSimilarLifeEvent(events: LifeEvent[], title: string, location?: string, startsAt?: string) {
  return events.find((event) => {
    if (event.status === "cancelled") return false;
    const sameTitleOrPlace = similar(event.title, title) || Boolean(location && event.location && similar(event.location, location));
    if (!sameTitleOrPlace) return false;
    if (!event.startsAt || !startsAt) return true;
    return isSameLocalDay(new Date(event.startsAt), new Date(startsAt));
  });
}

function findSimilarRoutineGoal(goals: RoutineGoal[], title: string, cadence: RoutineGoal["cadence"], targetTime?: string) {
  return goals.find((goal) => {
    if (goal.status === "cancelled" || goal.status === "done") return false;
    if (goal.cadence !== cadence) return false;
    if (targetTime && goal.targetTime && goal.targetTime !== targetTime) return false;
    return similar(goal.title, title);
  });
}

function hasSimilarCheckIn(
  checkIns: AssistantCheckIn[],
  title: string,
  question: string,
  relatedType: AssistantCheckIn["relatedType"],
  relatedId: string
) {
  return checkIns.some(
    (checkIn) =>
      checkIn.status !== "dismissed" &&
      checkIn.relatedType === relatedType &&
      checkIn.relatedId === relatedId &&
      (similar(checkIn.title, title) || similar(checkIn.question, question))
  );
}

function upsertRecurrence(
  candidates: RecurrenceCandidate[],
  normalizedTitle: string,
  relatedType: RecurrenceCandidate["relatedType"]
) {
  const now = nowIso();
  const existing = candidates.find((candidate) => candidate.normalizedTitle === normalizedTitle);
  if (!existing) {
    return [
      ...candidates,
      {
        id: createId("repeat"),
        normalizedTitle,
        relatedType,
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        status: "watching" as const
      }
    ];
  }

  return candidates.map((candidate) =>
    candidate.id === existing.id
      ? {
          ...candidate,
          seenCount: candidate.seenCount + 1,
          lastSeenAt: now,
          suggestedRule: candidate.seenCount + 1 >= 2 ? "weekly" : candidate.suggestedRule,
          status: candidate.seenCount + 1 >= 2 ? "suggested" : candidate.status
        }
      : candidate
  );
}

function maybeRecurrencePrompt(
  candidates: RecurrenceCandidate[],
  itemName: string,
  relatedId: string,
  existingPrompts: AssistantCheckIn[]
) {
  const candidate = candidates.find((item) => item.normalizedTitle === normalize(itemName));
  const alreadyAsked = existingPrompts.some((prompt) => prompt.relatedId === relatedId && prompt.title.includes("Recurring"));
  if (!candidate || candidate.seenCount < 2 || alreadyAsked) return [];

  return [
    {
      id: createId("check"),
      title: "Recurring suggestion",
      question: `看起来你经常需要买 ${itemName}。要把它设成每周提醒吗？`,
      relatedType: "shopping_item" as const,
      relatedId,
      askAt: nowIso(),
      status: "pending" as const,
      createdAt: nowIso()
    }
  ];
}

function createShoppingTask(itemName: string, sourceInputId: string, dueAt?: string): Task {
  const now = nowIso();
  return {
    id: createId("task"),
    title: titleCase(shoppingTaskTitle(itemName)),
    type: "task",
    horizon: "today",
    dueAt,
    energyRequired: "low",
    priority: "medium",
    status: "todo",
    sourceInputId,
    confidence: 0.88,
    createdAt: now,
    updatedAt: now
  };
}

function parseLocation(text: string) {
  const english = text.match(/(?:go to|travel to|trip to|visit)\s+([A-Z][a-zA-Z\s-]{1,30})/);
  if (english) return english[1].trim();
  const chinese = text.match(/去([^，。,.!?！？\s]{1,12})/);
  return chinese?.[1]?.trim();
}

function travelTitle(text: string, location: string) {
  if (!/[\u4e00-\u9fa5]/.test(text)) return `Trip to ${location}`;
  if (/这周末|本周末|周末/.test(text)) return `本周末去${location}`;
  return `去${location}`;
}

function travelDateQuestion(text: string, location: string) {
  if (!/[\u4e00-\u9fa5]/.test(text)) return `When are you planning to go to ${location}?`;
  if (/这周末|本周末|周末/.test(text)) return `这周末去${location}，具体是哪天、几点出发？`;
  return `你打算哪天去${location}？`;
}

function isNoOpInput(text: string) {
  const normalized = normalize(text).trim().replace(/\s+/g, " ");
  return noOpWords.test(normalized) || normalized.split(/\s+/).every((token) => noOpTokens.test(token));
}

export function parseLocalInput(rawText: string, state: AssistantState, inputType: "text" | "voice", options: ParseOptions = {}): ParseResult {
  const text = rawText.trim();
  const lower = normalize(text);
  const now = nowIso();
  const inputId = options.inputId ?? createId("input");
  let next: AssistantState =
    options.appendInput === false
      ? state
      : {
          ...state,
          inputs: [
            {
              id: inputId,
              rawText: text,
              inputType,
              parsedSummary: "Saved",
              createdAt: now
            },
            ...state.inputs
          ].slice(0, 60)
        };

  if (!text) {
    return {
      state,
      feedback: { title: "没有需要添加的内容", detail: "可以直接说或输入想让我记下的事。" }
    };
  }

  if (isNoOpInput(text)) {
    return {
      state: next,
      feedback: { title: "没有更改", detail: "我没有保存或修改任何事项。" }
    };
  }

  if (isRecurringSleepInput(text)) {
    const resolution = resolveRecurringSleepTarget(text);
    const targetTime = resolution.targetTime;
    const isRecent = /最近|近期|这段时间/.test(text);
    const title = targetTime ? `每天 ${targetTime} 前睡觉` : "每天按时睡觉";
    const existing = findSimilarRoutineGoal(next.routineGoals, title, "daily", targetTime);
    const goal: RoutineGoal = {
      id: existing?.id ?? createId("routine"),
      title,
      cadence: "daily",
      targetTime,
      targetTimeRelation: targetTime ? (resolution.targetTimeRelation ?? "before") : undefined,
      scope: isRecent ? "recent" : "ongoing",
      scopeLabel: isRecent ? "最近" : undefined,
      priority: "medium",
      status: "active",
      sourceInputId: inputId,
      confidence: targetTime ? 0.84 : 0.72,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const routineGoals = existing
      ? next.routineGoals.map((item) => (item.id === existing.id ? { ...item, ...goal } : item))
      : [goal, ...next.routineGoals];
    const question =
      resolution.ambiguity === "ampm"
        ? (resolution.question ?? "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？")
        : undefined;
    const checkIn: AssistantCheckIn | undefined = question
      ? {
          id: createId("check"),
          title: resolution.ambiguity === "ampm" ? "确认睡眠目标时间" : "确认睡眠目标范围",
          question,
          relatedType: "routine_goal",
          relatedId: goal.id,
          clarification:
            resolution.ambiguity === "ampm"
              ? { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
              : undefined,
          askAt: now,
          status: "pending",
          createdAt: now
        }
      : undefined;

    next = {
      ...next,
      routineGoals,
      checkIns:
        checkIn && !hasSimilarCheckIn(next.checkIns, checkIn.title, checkIn.question, "routine_goal", goal.id)
          ? [checkIn, ...next.checkIns]
          : next.checkIns
    };
    return {
      state: next,
      feedback: {
        title: "节奏目标已记录",
        detail: targetTime
          ? `我已把每天 ${targetTime} 前睡觉保存为节奏目标。`
          : "我已把每天按时睡觉保存为节奏目标。",
        question
      }
    };
  }

  if (doneWords.test(lower)) {
    let updatedTasks = next.tasks.map((task) =>
      lower.includes("report") && task.title.toLowerCase().includes("report")
        ? { ...task, status: "done" as const, updatedAt: now }
        : lower.includes(normalize(task.title))
          ? { ...task, status: "done" as const, updatedAt: now }
          : task
    );
    const items = findShoppingItems(text);
    updatedTasks = closeShoppingTasks(updatedTasks, items, now);
    const updatedShopping = next.shoppingItems.map((item) => {
      if (!items.some((name) => similar(name, item.itemName))) return item;
      return {
        ...item,
        status: /下单|ordered/.test(lower) ? ("ordered" as const) : ("bought" as const),
        expectedAt: /明早|tomorrow morning/.test(lower) ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : item.expectedAt,
        updatedAt: now
      };
    });
    const missingOrderedItems: ShoppingItem[] = items
      .filter((name) => !next.shoppingItems.some((item) => similar(item.itemName, name)))
      .map((itemName) => ({
        id: createId("shop"),
        itemName,
        status: /下单|ordered/.test(lower) ? ("ordered" as const) : ("bought" as const),
        expectedAt: /明早|tomorrow morning/.test(lower) ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined,
        category: "household",
        createdAt: now,
        updatedAt: now
      }));

    next = { ...next, tasks: updatedTasks, shoppingItems: [...missingOrderedItems, ...updatedShopping] };
    return {
      state: next,
      feedback: { title: "已更新", detail: "我已把匹配的待办或购物项标记为已处理。" }
    };
  }

  if (tiredWords.test(lower)) {
    next = {
      ...next,
      moodLogs: [
        {
          id: createId("mood"),
          moodLabel: /压力|overwhelmed/.test(lower) ? "overwhelmed" : "tired",
          energyLevel: "low",
          note: "User asked for a lighter plan.",
          createdAt: now
        },
        ...next.moodLogs
      ]
    };

    const hasOtherIntent =
      shoppingVerbs.test(lower) ||
      classWords.test(lower) ||
      (travelWords.test(lower) && Boolean(parseLocation(text))) ||
      taskIntentWords.test(lower);

    if (!hasOtherIntent) {
      return {
        state: next,
        feedback: {
          title: "状态已更新",
          detail: "我会把今天的安排放轻一点。"
        }
      };
    }
  }

  if (classWords.test(lower)) {
    const prompt: AssistantCheckIn = {
      id: createId("check"),
      title: "Class details",
      question: "兴趣班持续多久？需要提前多久出门？",
      relatedType: "project",
      relatedId: "class-planning",
      askAt: now,
      status: "pending",
      createdAt: now
    };
    next = {
      ...next,
      checkIns: hasSimilarCheckIn(next.checkIns, prompt.title, prompt.question, prompt.relatedType, prompt.relatedId)
        ? next.checkIns
        : [prompt, ...next.checkIns]
    };
    return {
      state: next,
      feedback: {
        title: "还差一个细节",
        detail: "我先把它作为家庭日程事项保存。",
        question: prompt.question
      }
    };
  }

  if (travelWords.test(lower) && parseLocation(text)) {
    const location = parseLocation(text)!;
    const startsAt = parseDueDate(text);
    const title = travelTitle(text, location);
    const existingEvent = findSimilarLifeEvent(next.lifeEvents, title, location, startsAt);
    const event: LifeEvent = {
      id: existingEvent?.id ?? createId("event"),
      title,
      category: "travel",
      startsAt,
      location,
      priority: startsAt ? "high" : "medium",
      participants: [],
      status: "planned",
      sourceInputId: inputId,
      createdAt: existingEvent?.createdAt ?? now,
      updatedAt: now
    };
    const lifeEvents = existingEvent
      ? next.lifeEvents.map((item) => (item.id === existingEvent.id ? { ...item, ...event } : item))
      : [event, ...next.lifeEvents];
    const prepAskAt = startsAt ? dayBeforeAt(startsAt, 20) : now;
    const checkInCandidates: AssistantCheckIn[] = startsAt
      ? [
          {
            id: createId("check"),
            title: /[\u4e00-\u9fa5]/.test(text) ? "确认车票" : "Confirm tickets",
            question: /[\u4e00-\u9fa5]/.test(text) ? `去${location}的票买好了吗？` : `Do you have tickets handled for ${location}?`,
            relatedType: "life_event",
            relatedId: event.id,
            askAt: prepAskAt,
            status: "pending",
            createdAt: now
          },
          {
            id: createId("check"),
            title: /[\u4e00-\u9fa5]/.test(text) ? "收拾行李" : "Pack luggage",
            question: /[\u4e00-\u9fa5]/.test(text) ? `去${location}的行李收拾好了吗？` : `Is packing handled for ${location}?`,
            relatedType: "life_event",
            relatedId: event.id,
            askAt: prepAskAt,
            status: "pending",
            createdAt: now
          }
        ]
      : [
          {
            id: createId("check"),
            title: /[\u4e00-\u9fa5]/.test(text) ? "确认出行时间" : "Confirm trip date",
            question: travelDateQuestion(text, location),
            relatedType: "life_event",
            relatedId: event.id,
            clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" },
            askAt: now,
            status: "pending",
            createdAt: now
          }
        ];
    const checkIns = checkInCandidates.reduce(
      (items, checkIn) =>
        hasSimilarCheckIn(items, checkIn.title, checkIn.question, "life_event", event.id) ? items : [checkIn, ...items],
      next.checkIns
    );
    next = {
      ...next,
      lifeEvents,
      checkIns
    };
    return {
      state: next,
      feedback: startsAt
        ? { title: "出行已记录", detail: `我已为${location}加上独立的行前确认。` }
        : {
            title: "出行已暂存",
            detail: `我先记下去${location}，但没有编造日期。`,
            question: travelDateQuestion(text, location)
          }
    };
  }

  if (shoppingVerbs.test(lower)) {
    const items = findShoppingItems(text);
    if (items.length > 0) {
      let recurrenceCandidates = next.recurrenceCandidates;
      const newShopping: ShoppingItem[] = [];
      const newTasks: Task[] = [];
      const prompts: AssistantCheckIn[] = [];
      const dueAt = parseDueDate(text);

      items.forEach((itemName) => {
        const existing = next.shoppingItems.find((item) => similar(item.itemName, itemName) && item.status !== "removed");
        const itemId = existing?.id ?? createId("shop");
        const taskTitle = titleCase(shoppingTaskTitle(itemName));
        if (!existing) {
          newShopping.push({
            id: itemId,
            itemName,
            status: "needed",
            category: "household",
            createdAt: now,
            updatedAt: now
          });
        }
        if (!findOpenTask(next.tasks, taskTitle, dueAt)) {
          newTasks.push(createShoppingTask(itemName, inputId, dueAt));
        }
        recurrenceCandidates = upsertRecurrence(recurrenceCandidates, normalize(itemName), "shopping_item");
        prompts.push(...maybeRecurrencePrompt(recurrenceCandidates, itemName, itemId, next.checkIns));
      });

      next = {
        ...next,
        shoppingItems: [
          ...newShopping,
          ...next.shoppingItems.map((item) =>
            items.some((name) => similar(item.itemName, name)) && item.status === "bought"
              ? { ...item, status: "needed" as const, updatedAt: now }
              : item
          )
        ],
        tasks: [...newTasks, ...next.tasks],
        checkIns: [...prompts, ...next.checkIns],
        recurrenceCandidates
      };
      return {
        state: next,
        feedback: {
          title: "已加入家务清单",
          detail: `已把 ${items.join("、")} 加入清单和今日队列。`
        }
      };
    }
  }

  const dueAt = parseDueDate(text);
  const title = titleCase(taskTitleFromInput(text) || text);
  const existingTask = findOpenTask(next.tasks, title, dueAt);
  if (existingTask) {
    return {
      state: next,
      feedback: {
        title: "已保留原事项",
        detail: "我找到了相同的未完成事项，先保留原来的安排。"
      }
    };
  }
  const task: Task = {
    id: createId("task"),
    title,
    type: "task",
    horizon: dueAt ? "today" : /week|这周|本周/.test(lower) ? "this_week" : "today",
    dueAt,
    energyRequired: tiredWords.test(lower) ? "low" : "medium",
    priority: dueAt ? "high" : "medium",
    status: "todo",
    sourceInputId: inputId,
    confidence: dueAt ? 0.78 : 0.55,
    createdAt: now,
    updatedAt: now
  };

  next = { ...next, tasks: [task, ...next.tasks] };
  return {
    state: next,
    feedback: {
      title: "已加入今日",
      detail: dueAt ? "我识别到了时间，会先放进今日队列。" : "我已把它保存为待办。"
    }
  };
}
