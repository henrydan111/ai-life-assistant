const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

const jiti = require("jiti")(__filename, {
  alias: {
    "@": path.join(root, "src")
  }
});

const { applyInterpretation } = jiti("../src/lib/ai/applyInterpretation.ts");
const { canUseAgentPlan, interpretWithAgentPlan, resolveAgentPlanLanguageModel } = jiti("../src/lib/ai/agentPlan.ts");
const { defaultAgentPlanLanguageModel } = jiti("../src/lib/ai/modelCatalog.ts");
const { resolvePendingConfirmations } = jiti("../src/lib/confirmation/resolvePendingConfirmations.ts");
const { generateVisibleDashboardSnapshot } = jiti("../src/lib/dashboard/visibleDashboardSnapshot.ts");

const originalFetch = global.fetch;
const requestTimeoutMs = Number(process.env.EVAL_AGENT_PLAN_REQUEST_TIMEOUT_MS ?? 45000);
global.fetch = async (input, init = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await originalFetch(input, {
      ...init,
      signal: init.signal ?? controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const args = process.argv.slice(2);

function argValue(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasArg(name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function normalize(text) {
  return String(text ?? "").trim().toLowerCase().replace(/[，。,.!?！？；;]/g, " ");
}

function similar(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  return a.includes(b) || b.includes(a);
}

function createState(overrides = {}) {
  return {
    version: 1,
    preferences: {
      displayName: "Dan",
      preferredLanguage: "zh",
      languageModel: process.env.EVAL_AGENT_PLAN_MODEL ?? process.env.ARK_AGENT_PLAN_CHAT_MODEL ?? defaultAgentPlanLanguageModel,
      modelChoiceVersion: 2,
      timezone: "Asia/Shanghai",
      wakeTime: "07:30",
      sleepTime: "23:30",
      planningStyle: "balanced",
      informationInterests: []
    },
    tasks: [],
    projects: [],
    shoppingItems: [],
    routineGoals: [],
    moodLogs: [],
    lifeEvents: [],
    checkIns: [],
    recurrenceCandidates: [],
    memoryItems: [],
    inputs: [],
    ...overrides,
    preferences: {
      displayName: "Dan",
      preferredLanguage: "zh",
      languageModel: process.env.EVAL_AGENT_PLAN_MODEL ?? process.env.ARK_AGENT_PLAN_CHAT_MODEL ?? defaultAgentPlanLanguageModel,
      modelChoiceVersion: 2,
      timezone: "Asia/Shanghai",
      wakeTime: "07:30",
      sleepTime: "23:30",
      planningStyle: "balanced",
      informationInterests: [],
      ...(overrides.preferences ?? {})
    }
  };
}

function memory(overrides) {
  const now = "2026-01-01T08:00:00.000Z";
  return {
    id: overrides.id,
    type: overrides.type ?? "household",
    summary: overrides.summary,
    tags: overrides.tags ?? [],
    entities: overrides.entities ?? [],
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? "active",
    sensitivity: overrides.sensitivity ?? "low",
    evidence: [{ text: overrides.summary, createdAt: now }],
    useCount: 0,
    createdAt: now,
    updatedAt: now
  };
}

function actionText(action) {
  if (action.type === "add_task") return [action.title, action.description].filter(Boolean).join(" ");
  if (action.type === "add_life_event") return [action.title, action.description, action.location].filter(Boolean).join(" ");
  if (action.type === "add_routine_goal") return [action.title, action.description, action.cadence, action.targetTime, action.scopeLabel].filter(Boolean).join(" ");
  if (action.type === "add_check_in") return [action.title, action.question].join(" ");
  if (action.type === "add_shopping_item") return [action.itemName, action.quantity].filter(Boolean).join(" ");
  if (action.type === "update_shopping_status") return [action.itemName, action.status].filter(Boolean).join(" ");
  if (action.type === "add_mood_log") return [action.moodLabel, action.note].filter(Boolean).join(" ");
  if (action.type === "mark_task_done") return action.matchTitle;
  return JSON.stringify(action);
}

function itemText(item) {
  return [
    item.title,
    item.description,
    item.question,
    item.location,
    item.itemName,
    item.summary,
    item.cadence,
    item.targetTime,
    item.scopeLabel,
    item.status,
    item.dueAt,
    item.startsAt,
    item.expectedAt
  ]
    .filter(Boolean)
    .join(" ");
}

function activeTasks(state, pattern) {
  return state.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled" && pattern.test(itemText(task)));
}

function activeCheckIns(state, pattern) {
  return state.checkIns.filter((checkIn) => checkIn.status === "pending" && pattern.test(itemText(checkIn)));
}

function activeRoutineGoals(state, pattern) {
  return state.routineGoals.filter((goal) => goal.status !== "done" && goal.status !== "cancelled" && pattern.test(itemText(goal)));
}

function plannedEvents(state, pattern) {
  return state.lifeEvents.filter((event) => event.status !== "cancelled" && pattern.test(itemText(event)));
}

function activeShoppingItems(state, pattern) {
  return state.shoppingItems.filter((item) => item.status !== "removed" && pattern.test(itemText(item)));
}

function relatedCheckIns(state, relatedType, relatedId, pattern) {
  return state.checkIns.filter(
    (checkIn) =>
      checkIn.status === "pending" &&
      checkIn.relatedType === relatedType &&
      checkIn.relatedId === relatedId &&
      pattern.test(itemText(checkIn))
  );
}

function travelPrepCategoryCount(text) {
  return [
    /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返|ticket/i,
    /行李|收拾|pack|luggage/i,
    /餐馆|餐厅|饭店|餐位|订位|订座|restaurant/i
  ].filter((pattern) => pattern.test(text)).length;
}

function shanghaiHour(iso) {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false
  }).format(date);
}

function summarizeActions(actions) {
  return actions.map((action) => {
    if (action.type === "add_task") return `task:${action.title}${action.dueAt ? ` @ ${action.dueAt}` : ""}`;
    if (action.type === "add_life_event") return `event:${action.title}${action.startsAt ? ` @ ${action.startsAt}` : ""}`;
    if (action.type === "add_routine_goal") return `routine:${action.title}:${action.cadence ?? "custom"}${action.targetTime ? ` @ ${action.targetTime}` : ""}`;
    if (action.type === "add_check_in") return `check:${action.relatedType}:${action.title} -> ${action.question}`;
    if (action.type === "add_shopping_item") return `shopping:${action.itemName}:${action.status ?? "needed"}`;
    if (action.type === "update_shopping_status") return `shopping_update:${action.itemName}:${action.status}`;
    if (action.type === "add_mood_log") return `mood:${action.moodLabel}`;
    return `${action.type}:${actionText(action)}`;
  });
}

function summarizeState(state) {
  return {
    tasks: state.tasks.map((task) => ({ title: task.title, status: task.status, dueAt: task.dueAt })),
    lifeEvents: state.lifeEvents.map((event) => ({ title: event.title, location: event.location, startsAt: event.startsAt })),
    routineGoals: state.routineGoals.map((goal) => ({
      title: goal.title,
      cadence: goal.cadence,
      targetTime: goal.targetTime,
      targetTimeRelation: goal.targetTimeRelation,
      scope: goal.scope,
      scopeLabel: goal.scopeLabel,
      status: goal.status
    })),
    shoppingItems: state.shoppingItems.map((item) => ({ itemName: item.itemName, status: item.status, expectedAt: item.expectedAt })),
    checkIns: state.checkIns.map((checkIn) => ({
      title: checkIn.title,
      relatedType: checkIn.relatedType,
      question: checkIn.question,
      askAt: checkIn.askAt
    })),
    moodLogs: state.moodLogs.map((mood) => ({ moodLabel: mood.moodLabel, energyLevel: mood.energyLevel })),
    memoryItems: state.memoryItems.map((item) => ({ summary: item.summary, type: item.type, status: item.status }))
  };
}

function summarizeDashboard(dashboard) {
  return {
    today: dashboard.today.map((item) => ({
      title: item.title,
      meta: item.meta,
      reminders: item.reminders.map((reminder) => reminder.question)
    })),
    shopping: dashboard.shopping.map((item) => ({
      itemName: item.itemName,
      status: item.status,
      expectedAt: item.expectedAt
    })),
    routineGoals: dashboard.routineGoals.map((item) => ({
      title: item.title,
      meta: item.meta,
      reminders: item.reminders.map((reminder) => reminder.question)
    })),
    openConfirmations: dashboard.openConfirmations.map((item) => item.question),
    suggestedMemories: dashboard.suggestedMemories.map((item) => item.summary),
    upcoming: dashboard.upcoming.map((item) => ({
      title: item.title,
      meta: item.meta,
      reminders: item.reminders.map((reminder) => reminder.question)
    })),
    dashboardPrompts: dashboard.dashboardPrompts.map((item) => item.question),
    visibleText: dashboard.visibleText
  };
}

function expect(name, points, check, options = {}) {
  return {
    name,
    points,
    required: options.required !== false,
    check
  };
}

function normalizeCheckResult(result) {
  if (result === true) return { pass: true };
  if (result === false) return { pass: false };
  if (typeof result === "string") return { pass: false, detail: result };
  if (result && typeof result === "object") return { pass: Boolean(result.pass), detail: result.detail };
  return { pass: false, detail: "Expectation returned an unsupported value." };
}

function mergeFeedback(confirmation, next) {
  return {
    title: "已更新确认信息，也整理了新事项",
    detail: [confirmation.detail, next.detail].filter(Boolean).join(" "),
    question: next.question ?? confirmation.question
  };
}

const scenarios = [
  {
    id: "pending_confirmation_followup_dashboard",
    title: "多轮确认：补充信息后 dashboard 不显示旧追问",
    tags: ["smoke", "dashboard", "clarification", "state-update"],
    minScoreRatio: 1,
    state: () =>
      createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: "2026-01-01T08:00:00.000Z",
            updatedAt: "2026-01-01T08:00:00.000Z"
          }
        ],
        routineGoals: [
          {
            id: "routine_sleep",
            title: "每天12点前睡觉",
            cadence: "daily",
            scope: "unspecified",
            priority: "medium",
            status: "active",
            confidence: 0.9,
            createdAt: "2026-01-01T08:00:00.000Z",
            updatedAt: "2026-01-01T08:00:00.000Z"
          }
        ],
        checkIns: [
          {
            id: "check_trip_time",
            title: "确认出行时间",
            question: "你这周末计划去上海，请问具体出行开始时间是什么时候？",
            relatedType: "life_event",
            relatedId: "event_shanghai",
            askAt: "2026-01-01T08:00:00.000Z",
            status: "pending",
            createdAt: "2026-01-01T08:00:00.000Z"
          },
          {
            id: "check_sleep_scope",
            title: "确认日常目标",
            question: "你想把每天12点前睡觉设置为短期目标还是长期目标？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: "2026-01-01T08:00:00.000Z",
            status: "pending",
            createdAt: "2026-01-01T08:00:00.000Z"
          }
        ]
      }),
    steps: [
      {
        rawText: "周日下午2点去上海。每天12点前睡是短期目标",
        expectations: [
          expect("上海活动回填到周日下午 2 点", 3, ({ after }) => {
            const event = plannedEvents(after, /上海/)[0];
            if (!event) return "缺少上海 life_event";
            if (!event.startsAt) return "上海 life_event 缺少 startsAt";
            return shanghaiHour(event.startsAt) === "14" || `startsAt=${event.startsAt}`;
          }),
          expect("睡眠目标范围已回填为短期/最近", 2, ({ after }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠 routine goal";
            return goal.scope === "recent" || /短期|最近/.test(goal.scopeLabel ?? "") || `scope=${goal.scope}, scopeLabel=${goal.scopeLabel}`;
          }),
          expect("dashboard 不再显示上海出行时间旧追问", 3, ({ dashboard }) => {
            return !/上海.*(具体出行|出行开始|什么时候|哪天|时间)|具体出行.*上海|出行开始时间/.test(dashboard.visibleText)
              ? true
              : dashboard.visibleText;
          }),
          expect("dashboard 不再显示短期/长期旧追问", 2, ({ dashboard }) => {
            return !/(短期目标还是长期目标|长期目标|确认日常目标)/.test(dashboard.visibleText) ? true : dashboard.visibleText;
          })
        ]
      }
    ]
  },
  {
    id: "pending_confirmation_with_new_intent",
    title: "多轮确认：补充确认时不吞掉同句新事项",
    tags: ["smoke", "dashboard", "clarification", "state-update"],
    minScoreRatio: 1,
    state: () =>
      createState({
        routineGoals: [
          {
            id: "routine_sleep",
            title: "每天12点前睡觉",
            cadence: "daily",
            scope: "recent",
            scopeLabel: "最近",
            priority: "medium",
            status: "active",
            confidence: 0.9,
            createdAt: "2026-01-01T08:00:00.000Z",
            updatedAt: "2026-01-01T08:00:00.000Z"
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: "2026-01-01T08:00:00.000Z",
            status: "pending",
            createdAt: "2026-01-01T08:00:00.000Z"
          }
        ]
      }),
    steps: [
      {
        rawText: "晚上12点，另外明天买牛奶",
        expectations: [
          expect("睡眠目标时间已回填为午夜 00:00", 3, ({ after }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠 routine goal";
            return goal.targetTime === "00:00" || `targetTime=${goal.targetTime}`;
          }),
          expect("同句新事项买牛奶也被保存", 4, ({ after }) => {
            return after.shoppingItems.some((item) => /牛奶/.test(item.itemName)) || "缺少牛奶购物项";
          }),
          expect("dashboard 不再显示 12 点含义旧追问", 2, ({ dashboard }) => {
            return !/(中午12点|午夜12点|确认睡眠目标时间)/.test(dashboard.visibleText) ? true : dashboard.visibleText;
          })
        ]
      }
    ]
  },
  {
    id: "routine_sleep_goal",
    title: "节奏目标：最近每天半夜 12 点前睡觉",
    tags: ["smoke", "routine", "clarification"],
    minScoreRatio: 1,
    state: () => createState(),
    steps: [
      {
        rawText: "我最近希望能够每天半夜12点前睡觉。",
        expectations: [
          expect("模型使用 routine goal 而不是一次性待办", 3, ({ interpretation, after }) => {
            const hasRoutineAction = interpretation.actions.some((action) => action.type === "add_routine_goal" && /睡觉|睡|休息/.test(actionText(action)));
            const goals = activeRoutineGoals(after, /睡觉|睡|休息/);
            const sleepTasks = activeTasks(after, /睡觉|睡|休息/);
            if (!hasRoutineAction) return `actions=${summarizeActions(interpretation.actions).join("; ")}`;
            if (goals.length !== 1) return `routineGoals=${goals.length}`;
            return sleepTasks.length === 0 || `不应创建一次性睡觉任务：${sleepTasks.map(itemText).join(" | ")}`;
          }),
          expect("承接每天和 0 点前语义", 3, ({ after }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠节奏目标";
            if (goal.cadence !== "daily") return `cadence=${goal.cadence}`;
            if (goal.targetTime !== "00:00") return `targetTime=${goal.targetTime}`;
            return goal.targetTimeRelation === "before" || `targetTimeRelation=${goal.targetTimeRelation}`;
          }),
          expect("最近语义变成可确认的范围", 2, ({ after, feedback }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠节奏目标";
            if (goal.scope !== "recent" && !/最近/.test(goal.scopeLabel ?? "")) {
              return `scope=${goal.scope}, scopeLabel=${goal.scopeLabel}`;
            }
            if (goal.scopeLabel && !/最近/.test(goal.scopeLabel)) {
              return `前端范围标签应保留“最近”，当前 scopeLabel=${goal.scopeLabel}`;
            }
            const text = [feedback.question, ...after.checkIns.map(itemText)].filter(Boolean).join(" ");
            const hasRoutineCheck = after.checkIns.some(
              (checkIn) =>
                checkIn.relatedType === "routine_goal" &&
                checkIn.relatedId === goal.id &&
                /(从今天|开始|试|多久|持续)/.test(itemText(checkIn))
            );
            return hasRoutineCheck && /(从今天|开始|试|多久|持续)/.test(text) ? true : "缺少 routine_goal 范围确认";
          })
        ]
      }
    ]
  },
  {
    id: "routine_sleep_bare_12_ambiguous",
    title: "节奏目标：最近每天 12 点前睡觉需要确认上午/午夜",
    tags: ["smoke", "routine", "clarification", "temporal"],
    minScoreRatio: 1,
    state: () => createState(),
    steps: [
      {
        rawText: "我最近希望能够每天12点前睡觉。",
        expectations: [
          expect("保存为 routine goal，不生成一次性睡觉任务", 3, ({ after }) => {
            const goals = activeRoutineGoals(after, /睡觉|睡|休息/);
            const sleepTasks = activeTasks(after, /睡觉|睡|休息/);
            if (goals.length !== 1) return `routineGoals=${goals.length}`;
            return sleepTasks.length === 0 || `不应创建一次性睡觉任务：${sleepTasks.map(itemText).join(" | ")}`;
          }),
          expect("不能静默保存为 12:00", 3, ({ after }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠节奏目标";
            return !goal.targetTime || goal.targetTime !== "12:00" || `targetTime=${goal.targetTime}`;
          }),
          expect("追问 12 点是中午还是晚上/午夜", 2, ({ after, feedback }) => {
            const text = [feedback.question, ...after.checkIns.map(itemText)].filter(Boolean).join(" ");
            const hasRoutineCheck = after.checkIns.some(
              (checkIn) => checkIn.relatedType === "routine_goal" && /(中午|晚上|午夜|半夜|12点|十二点)/.test(itemText(checkIn))
            );
            return hasRoutineCheck && /(中午|晚上|午夜|半夜|12点|十二点)/.test(text) ? true : "缺少 12 点歧义确认";
          })
        ]
      }
    ]
  },
  {
    id: "complex_life_admin",
    title: "复合生活输入：睡觉、请假、上海行程与行前提醒",
    tags: ["smoke", "multi-intent", "travel", "clarification"],
    minScoreRatio: 0.85,
    state: () => createState(),
    steps: [
      {
        rawText:
          "我今天想做到12点前睡觉，然后我这周四和周五希望请假，提醒我要提前和老板说，然后我周日晚上计划去上海吃个晚饭，准备高铁往返，到时候提醒我要订高铁票和收拾行李。",
        expectations: [
          expect("保留睡觉目标但不写入歧义 dueAt", 2, ({ after }) => {
            const tasks = activeTasks(after, /睡觉|睡|休息/);
            if (tasks.length !== 1) return `睡觉目标数量=${tasks.length}`;
            return !tasks[0].dueAt || "睡觉目标不应在语义歧义时写 dueAt";
          }),
          expect("追问睡觉时间歧义", 1, ({ after, feedback }) => {
            const text = [feedback.question, ...after.checkIns.map(itemText)].filter(Boolean).join(" ");
            return /(中午|今晚|几点|24|提醒|十二点|12点)/.test(text) || "没有看到睡觉时间澄清";
          }),
          expect("周四周五请假合并成一个主待办", 2, ({ after }) => {
            const leaveTasks = activeTasks(after, /请假/);
            if (leaveTasks.length !== 1) return `请假任务数量=${leaveTasks.length}`;
            return /(周四|星期四|四)/.test(itemText(leaveTasks[0])) && /(周五|星期五|五)/.test(itemText(leaveTasks[0]));
          }),
          expect("老板沟通是请假相关 check-in", 1, ({ after }) => {
            return activeCheckIns(after, /老板|领导|提前/).some((checkIn) => checkIn.relatedType === "task") || "缺少 task 关联的老板沟通 check-in";
          }),
          expect("上海是一个主 life_event", 2, ({ after }) => {
            const events = plannedEvents(after, /上海/);
            if (events.length !== 1) return `上海 event 数量=${events.length}`;
            return /晚饭|吃饭|晚/.test(itemText(events[0])) || "上海 event 没有晚饭语义";
          }),
          expect("高铁票和行李是独立行前 check-in", 2, ({ after }) => {
            const event = plannedEvents(after, /上海/)[0];
            if (!event) return "缺少上海 event";
            const ticket = relatedCheckIns(after, "life_event", event.id, /高铁|车票|票/);
            const luggage = relatedCheckIns(after, "life_event", event.id, /行李|收拾/);
            const combined = relatedCheckIns(after, "life_event", event.id, /高铁|车票|票|行李|收拾/).filter(
              (checkIn) => travelPrepCategoryCount(itemText(checkIn)) > 1
            );
            if (!ticket.length || !luggage.length) return `ticket=${ticket.length}, luggage=${luggage.length}`;
            return combined.length === 0 || `存在合并行前提醒：${combined.map(itemText).join(" | ")}`;
          })
        ]
      }
    ]
  },
  {
    id: "no_op_acknowledgement",
    title: "无状态变更：谢谢/不用了不能变成任务",
    tags: ["smoke", "no-op", "safety"],
    minScoreRatio: 1,
    state: () => createState(),
    steps: [
      {
        rawText: "谢谢！",
        expectations: [
          expect("模型输出 zero-action", 2, ({ interpretation }) => {
            return interpretation.actions.length === 0 || `actions=${summarizeActions(interpretation.actions).join("; ")}`;
          }),
          expect("落库后没有创建事项", 2, ({ before, after }) => {
            const unchanged =
              after.tasks.length === before.tasks.length &&
              after.lifeEvents.length === before.lifeEvents.length &&
              after.shoppingItems.length === before.shoppingItems.length &&
              after.checkIns.length === before.checkIns.length &&
              after.memoryItems.length === before.memoryItems.length;
            return unchanged || `state changed: ${JSON.stringify(summarizeState(after))}`;
          })
        ]
      },
      {
        rawText: "好的，收到。",
        expectations: [
          expect("模型输出 zero-action", 2, ({ interpretation }) => {
            return interpretation.actions.length === 0 || `actions=${summarizeActions(interpretation.actions).join("; ")}`;
          }),
          expect("落库后没有创建事项", 2, ({ before, after }) => {
            const unchanged =
              after.tasks.length === before.tasks.length &&
              after.lifeEvents.length === before.lifeEvents.length &&
              after.shoppingItems.length === before.shoppingItems.length &&
              after.checkIns.length === before.checkIns.length &&
              after.memoryItems.length === before.memoryItems.length;
            return unchanged || `state changed: ${JSON.stringify(summarizeState(after))}`;
          })
        ]
      }
    ]
  },
  {
    id: "ambiguous_travel_date",
    title: "无日期出行：暂存并追问，不能编造 startsAt",
    tags: ["smoke", "travel", "clarification"],
    minScoreRatio: 0.8,
    state: () => createState(),
    steps: [
      {
        rawText: "我要去苏州，帮我先记一下。",
        expectations: [
          expect("生成苏州出行主活动", 1, ({ after }) => plannedEvents(after, /苏州/).length === 1 || "缺少苏州 life_event"),
          expect("没有编造出行日期", 2, ({ after }) => {
            const event = plannedEvents(after, /苏州/)[0];
            return event && !event.startsAt ? true : `startsAt=${event?.startsAt}`;
          }),
          expect("追问具体日期", 1, ({ after, feedback }) => {
            const text = [feedback.question, ...after.checkIns.map(itemText)].filter(Boolean).join(" ");
            return /(哪天|什么时候|日期|时间|when)/i.test(text) || "没有日期追问";
          })
        ]
      }
    ]
  },
  {
    id: "travel_prep_split",
    title: "出行准备：票、行李、餐馆必须拆成独立 check-in",
    tags: ["smoke", "travel", "policy"],
    minScoreRatio: 1,
    state: () => createState(),
    steps: [
      {
        rawText: "周日晚上去上海吃饭，准备高铁往返。提醒我订高铁票、收拾行李、订餐馆位置。",
        expectations: [
          expect("上海只有一个主活动", 2, ({ after }) => plannedEvents(after, /上海/).length === 1 || `events=${plannedEvents(after, /上海/).length}`),
          expect("三个准备项均为独立 check-in", 3, ({ after }) => {
            const event = plannedEvents(after, /上海/)[0];
            if (!event) return "缺少上海 event";
            const checks = after.checkIns.filter((checkIn) => checkIn.status === "pending" && checkIn.relatedType === "life_event" && checkIn.relatedId === event.id);
            const ticket = checks.filter((checkIn) => /高铁|车票|票/.test(itemText(checkIn)) && travelPrepCategoryCount(itemText(checkIn)) === 1);
            const luggage = checks.filter((checkIn) => /行李|收拾/.test(itemText(checkIn)) && travelPrepCategoryCount(itemText(checkIn)) === 1);
            const restaurant = checks.filter((checkIn) => /餐馆|餐厅|饭店|订位|订座/.test(itemText(checkIn)) && travelPrepCategoryCount(itemText(checkIn)) === 1);
            if (!ticket.length || !luggage.length || !restaurant.length) {
              return `ticket=${ticket.length}, luggage=${luggage.length}, restaurant=${restaurant.length}`;
            }
            return true;
          })
        ]
      }
    ]
  },
  {
    id: "shopping_status_update",
    title: "购物状态：下单/明早送到应更新状态而不是再创建购买任务",
    tags: ["smoke", "shopping", "state-update"],
    minScoreRatio: 0.85,
    state: () =>
      createState({
        shoppingItems: [
          {
            id: "shop_milk",
            itemName: "牛奶",
            status: "needed",
            category: "household",
            createdAt: "2026-01-01T08:00:00.000Z",
            updatedAt: "2026-01-01T08:00:00.000Z"
          }
        ],
        tasks: [
          {
            id: "task_milk",
            title: "买牛奶",
            type: "task",
            horizon: "today",
            energyRequired: "low",
            priority: "medium",
            status: "todo",
            confidence: 0.9,
            createdAt: "2026-01-01T08:00:00.000Z",
            updatedAt: "2026-01-01T08:00:00.000Z"
          }
        ]
      }),
    steps: [
      {
        rawText: "牛奶已经下单了，明早送到。",
        expectations: [
          expect("牛奶状态更新为 ordered 或 bought", 2, ({ after }) => {
            const milk = activeShoppingItems(after, /牛奶/);
            if (milk.length !== 1) return `牛奶购物项数量=${milk.length}`;
            return /ordered|bought/.test(milk[0].status) || `status=${milk[0].status}`;
          }),
          expect("原购买任务已闭环", 2, ({ after }) => activeTasks(after, /买牛奶/).length === 0 || "买牛奶任务仍未关闭")
        ]
      }
    ]
  },
  {
    id: "memory_context_safety",
    title: "记忆安全：pending memory 不应当作事实使用",
    tags: ["smoke", "memory", "safety"],
    minScoreRatio: 0.75,
    state: () =>
      createState({
        memoryItems: [
          memory({
            id: "mem_active_class",
            summary: "用户确认孩子周三有美术课。",
            tags: ["孩子", "兴趣班"],
            entities: ["孩子", "美术课"],
            status: "active"
          }),
          memory({
            id: "mem_pending_children",
            summary: "用户家里有三个孩子。",
            tags: ["孩子", "家庭"],
            entities: ["孩子"],
            status: "suggested"
          })
        ]
      }),
    steps: [
      {
        rawText: "明天孩子有兴趣班，提醒我确认持续多久和提前多久出门。",
        expectations: [
          expect("覆盖兴趣班安排或追问", 1, ({ after, feedback }) => {
            const text = [feedback.detail, feedback.question, ...after.tasks.map(itemText), ...after.lifeEvents.map(itemText), ...after.checkIns.map(itemText)].join(" ");
            return /兴趣班|持续|多久|出门/.test(text) || "没有覆盖兴趣班语义";
          }),
          expect("没有把未确认的三个孩子当作事实写入反馈或事项", 2, ({ after, feedback }) => {
            const text = [feedback.title, feedback.detail, feedback.question, ...after.tasks.map(itemText), ...after.lifeEvents.map(itemText), ...after.checkIns.map(itemText)].join(" ");
            return !/三个孩子/.test(text) || "出现未确认的“三个孩子”";
          })
        ]
      }
    ]
  }
];

function selectedScenarios() {
  const scenarioId = argValue("--scenario");
  const tag = argValue("--tag");
  let selected = scenarios;
  if (scenarioId) selected = selected.filter((scenario) => scenario.id === scenarioId);
  if (tag) selected = selected.filter((scenario) => scenario.tags.includes(tag));
  const max = Number(argValue("--max") ?? 0);
  if (max > 0) selected = selected.slice(0, max);
  return selected;
}

function printScenarioList() {
  scenarios.forEach((scenario) => {
    console.log(`${scenario.id}\t[${scenario.tags.join(", ")}]\t${scenario.title}`);
  });
}

async function runStep({ scenario, step, state, model, repeatIndex, stepIndex }) {
  const progress = [];
  const started = performance.now();
  const before = state;
  const stepLabel = `${scenario.id}#${stepIndex + 1}${repeatIndex > 0 ? `/repeat${repeatIndex + 1}` : ""}`;

  try {
    const confirmation = resolvePendingConfirmations(step.rawText, step.inputType ?? "text", state);
    if (confirmation && !confirmation.unhandledText) {
      const after = confirmation.state;
      const dashboard = generateVisibleDashboardSnapshot(after);
      const interpretation = { actions: [], memoryWrites: [], planTrace: [] };
      const ctx = {
        scenario,
        step,
        before,
        after,
        dashboard,
        interpretation,
        feedback: confirmation.feedback,
        progress
      };
      const expectationResults = step.expectations.map((item) => {
        try {
          const check = normalizeCheckResult(item.check(ctx));
          return {
            name: item.name,
            points: item.points,
            required: item.required,
            pass: check.pass,
            detail: check.detail
          };
        } catch (error) {
          return {
            name: item.name,
            points: item.points,
            required: item.required,
            pass: false,
            detail: error instanceof Error ? error.message : String(error)
          };
        }
      });
      const earned = expectationResults.filter((item) => item.pass).reduce((total, item) => total + item.points, 0);
      const total = expectationResults.reduce((sum, item) => sum + item.points, 0);
      const requiredFailed = expectationResults.some((item) => item.required && !item.pass);

      return {
        ok: !requiredFailed,
        state: after,
        result: {
          id: stepLabel,
          ok: !requiredFailed,
          durationMs: Math.round(performance.now() - started),
          score: total ? Number((earned / total).toFixed(3)) : 1,
          earned,
          total,
          rawText: step.rawText,
          feedback: confirmation.feedback,
          provider: "local_confirmation_resolver",
          actions: [],
          memoryWrites: [],
          planTrace: [],
          progress,
          expectations: expectationResults,
          finalState: summarizeState(after),
          finalDashboard: summarizeDashboard(dashboard)
        }
      };
    }

    const planningText = confirmation?.unhandledText ?? step.rawText;
    const planningState = confirmation?.state ?? state;
    const interpretation = await interpretWithAgentPlan({
      rawText: planningText,
      inputType: step.inputType ?? "text",
      state: planningState,
      model,
      onProgress(update) {
        progress.push({ ...update, atMs: Math.round(performance.now() - started) });
      }
    });
    const applied = applyInterpretation(planningText, step.inputType ?? "text", planningState, interpretation);
    if (confirmation) {
      applied.feedback = mergeFeedback(confirmation.feedback, applied.feedback);
    }
    const after = applied.state;
    const dashboard = generateVisibleDashboardSnapshot(after);
    const ctx = {
      scenario,
      step,
      before,
      after,
      dashboard,
      interpretation,
      feedback: applied.feedback,
      progress
    };
    const expectationResults = step.expectations.map((item) => {
      try {
        const check = normalizeCheckResult(item.check(ctx));
        return {
          name: item.name,
          points: item.points,
          required: item.required,
          pass: check.pass,
          detail: check.detail
        };
      } catch (error) {
        return {
          name: item.name,
          points: item.points,
          required: item.required,
          pass: false,
          detail: error instanceof Error ? error.message : String(error)
        };
      }
    });
    const earned = expectationResults.filter((item) => item.pass).reduce((total, item) => total + item.points, 0);
    const total = expectationResults.reduce((sum, item) => sum + item.points, 0);
    const requiredFailed = expectationResults.some((item) => item.required && !item.pass);

    return {
      ok: !requiredFailed,
      state: after,
      result: {
        id: stepLabel,
        ok: !requiredFailed,
        durationMs: Math.round(performance.now() - started),
        score: total ? Number((earned / total).toFixed(3)) : 1,
        earned,
        total,
        rawText: step.rawText,
        feedback: applied.feedback,
        actions: summarizeActions(interpretation.actions),
        memoryWrites: interpretation.memoryWrites,
        planTrace: interpretation.planTrace ?? [],
        progress,
        expectations: expectationResults,
        finalState: summarizeState(after),
        finalDashboard: summarizeDashboard(dashboard)
      }
    };
  } catch (error) {
    return {
      ok: false,
      state,
      result: {
        id: stepLabel,
        ok: false,
        durationMs: Math.round(performance.now() - started),
        score: 0,
        rawText: step.rawText,
        error: error instanceof Error ? error.message.replace(process.env.ARK_AGENT_PLAN_API_KEY ?? "", "[redacted]") : String(error),
        progress
      }
    };
  }
}

async function runScenario(scenario, model, repeatIndex) {
  let state = scenario.state();
  state.preferences = {
    ...state.preferences,
    languageModel: model
  };
  const steps = [];
  const started = performance.now();

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const { state: nextState, result } = await runStep({
      scenario,
      step: scenario.steps[index],
      state,
      model,
      repeatIndex,
      stepIndex: index
    });
    steps.push(result);
    state = nextState;
    if (!result.ok && hasArg("--fail-fast")) break;
  }

  const earned = steps.reduce((sum, step) => sum + (step.earned ?? 0), 0);
  const total = steps.reduce((sum, step) => sum + (step.total ?? 0), 0);
  const score = total ? Number((earned / total).toFixed(3)) : 0;
  const ok = steps.every((step) => step.ok) && score >= scenario.minScoreRatio;

  return {
    id: scenario.id,
    title: scenario.title,
    tags: scenario.tags,
    model,
    repeat: repeatIndex + 1,
    ok,
    score,
    minScoreRatio: scenario.minScoreRatio,
    durationMs: Math.round(performance.now() - started),
    steps
  };
}

function ensureConfigured() {
  if (canUseAgentPlan()) return;
  throw new Error(
    [
      "Agent Plan runtime is not configured.",
      "Set AI_PROVIDER=volcengine_agent_plan_runtime, ALLOW_AGENT_PLAN_RUNTIME=true, and ARK_AGENT_PLAN_API_KEY in .env.local before running live evals."
    ].join(" ")
  );
}

function writeReport(report) {
  const outputPath = argValue("--out");
  const dir = outputPath ? path.dirname(path.resolve(root, outputPath)) : path.join(root, "eval-results");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = outputPath
    ? path.resolve(root, outputPath)
    : path.join(dir, `agent-plan-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return filePath;
}

async function main() {
  if (hasArg("--help")) {
    console.log([
      "Usage: node scripts/agent-plan-live-evals.cjs [--list] [--dry-run] [--scenario id] [--tag tag] [--model id] [--repeat n] [--max n] [--out path] [--fail-fast]",
      "",
      "Examples:",
      "  pnpm run eval:agent-plan:list",
      "  pnpm run eval:agent-plan:smoke -- --model doubao-seed-2.0-pro",
      "  pnpm run eval:agent-plan -- --scenario travel_prep_split --repeat 3"
    ].join("\n"));
    return;
  }

  const selected = selectedScenarios();
  if (hasArg("--list")) {
    printScenarioList();
    return;
  }
  if (!selected.length) {
    throw new Error("No live eval scenarios matched the requested filters.");
  }
  if (hasArg("--dry-run")) {
    console.table(
      selected.map((scenario) => ({
        id: scenario.id,
        tags: scenario.tags.join(","),
        steps: scenario.steps.length,
        expectations: scenario.steps.reduce((sum, step) => sum + step.expectations.length, 0),
        minScoreRatio: scenario.minScoreRatio
      }))
    );
    return;
  }

  ensureConfigured();

  const model = resolveAgentPlanLanguageModel(argValue("--model") ?? process.env.EVAL_AGENT_PLAN_MODEL);
  const repeat = Math.max(1, Number(argValue("--repeat") ?? 1));
  const report = {
    kind: "agent-plan-live-eval",
    createdAt: new Date().toISOString(),
    model,
    provider: process.env.AI_PROVIDER,
    requestTimeoutMs,
    filters: {
      scenario: argValue("--scenario"),
      tag: argValue("--tag"),
      repeat
    },
    results: []
  };

  for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
    for (const scenario of selected) {
      console.log(`Running ${scenario.id} (${scenario.title}) on ${model}, repeat ${repeatIndex + 1}/${repeat}...`);
      const result = await runScenario(scenario, model, repeatIndex);
      report.results.push(result);
      const seconds = (result.durationMs / 1000).toFixed(1);
      console.log(`${result.ok ? "ok" : "not ok"} - ${scenario.id} score=${result.score} duration=${seconds}s`);
      if (!result.ok && hasArg("--fail-fast")) break;
    }
  }

  const total = report.results.length;
  const passed = report.results.filter((result) => result.ok).length;
  const averageScore = total
    ? Number((report.results.reduce((sum, result) => sum + result.score, 0) / total).toFixed(3))
    : 0;
  report.summary = {
    passed,
    total,
    failed: total - passed,
    averageScore
  };

  console.table(
    report.results.map((result) => ({
      id: result.id,
      ok: result.ok,
      score: result.score,
      seconds: Number((result.durationMs / 1000).toFixed(1))
    }))
  );
  const reportPath = writeReport(report);
  console.log(`Report written to ${path.relative(root, reportPath)}`);
  console.log(`${passed}/${total} scenarios passed, average score ${averageScore}.`);

  if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
