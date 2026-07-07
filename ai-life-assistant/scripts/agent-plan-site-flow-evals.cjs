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

const { defaultAgentPlanLanguageModel } = jiti("../src/lib/ai/modelCatalog.ts");
const { normalizeAssistantState } = jiti("../src/lib/store/localStore.ts");
const { shouldSkipInterpretStateUpdate } = jiti("../src/lib/store/interpretResult.ts");
const { generateVisibleDashboardSnapshot } = jiti("../src/lib/dashboard/visibleDashboardSnapshot.ts");

const args = process.argv.slice(2);
const requestTimeoutMs = Number(process.env.EVAL_AGENT_PLAN_REQUEST_TIMEOUT_MS ?? 90000);

function argValue(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasArg(name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
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

function activeRoutineGoals(state, pattern) {
  return state.routineGoals.filter((goal) => goal.status !== "done" && goal.status !== "cancelled" && pattern.test(itemText(goal)));
}

function plannedEvents(state, pattern) {
  return state.lifeEvents.filter((event) => event.status !== "cancelled" && pattern.test(itemText(event)));
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

function summarizeState(state) {
  return {
    tasks: state.tasks.map((task) => ({ title: task.title, status: task.status, dueAt: task.dueAt })),
    routineGoals: state.routineGoals.map((goal) => ({
      title: goal.title,
      cadence: goal.cadence,
      targetTime: goal.targetTime,
      targetTimeRelation: goal.targetTimeRelation,
      scope: goal.scope,
      scopeLabel: goal.scopeLabel,
      status: goal.status
    })),
    checkIns: state.checkIns.map((checkIn) => ({
      title: checkIn.title,
      relatedType: checkIn.relatedType,
      question: checkIn.question,
      askAt: checkIn.askAt
    }))
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

function expect(name, points, check) {
  return { name, points, check };
}

function normalizeCheckResult(result) {
  if (result === true) return { pass: true };
  if (result === false) return { pass: false };
  if (typeof result === "string") return { pass: false, detail: result };
  if (result && typeof result === "object") return { pass: Boolean(result.pass), detail: result.detail };
  return { pass: false, detail: "Expectation returned an unsupported value." };
}

const scenarios = [
  {
    id: "pending_confirmation_followup_dashboard",
    title: "网站流：补充确认后 dashboard 不显示旧追问",
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
    minScoreRatio: 1,
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
    title: "网站流：补充确认时不吞掉同句新事项",
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
    minScoreRatio: 1,
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
          }),
          expect("provider 标明确认解析后继续处理", 1, ({ result }) => {
            return /local_confirmation_resolver/.test(result.provider ?? "") || `provider=${result.provider}`;
          })
        ]
      }
    ]
  },
  {
    id: "routine_sleep_goal",
    title: "网站流：最近每天半夜 12 点前睡觉",
    state: () => createState(),
    minScoreRatio: 1,
    steps: [
      {
        rawText: "我最近希望能够每天半夜12点前睡觉。",
        expectations: [
          expect("保存为一个 routine goal", 3, ({ after }) => {
            const goals = activeRoutineGoals(after, /睡觉|睡|休息/);
            return goals.length === 1 || `routineGoals=${goals.length}`;
          }),
          expect("承接每天和 00:00 前语义", 3, ({ after }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠节奏目标";
            if (goal.cadence !== "daily") return `cadence=${goal.cadence}`;
            if (goal.targetTime !== "00:00") return `targetTime=${goal.targetTime}`;
            return goal.targetTimeRelation === "before" || `targetTimeRelation=${goal.targetTimeRelation}`;
          }),
          expect("不生成一次性睡觉 task", 2, ({ after }) => {
            const sleepTasks = activeTasks(after, /睡觉|睡|休息/);
            return sleepTasks.length === 0 || `sleepTasks=${sleepTasks.map(itemText).join(" | ")}`;
          }),
          expect("最近范围有 routine_goal 确认", 2, ({ after, feedback }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠节奏目标";
            const scopePattern = /(从今天|开始|试|多久|持续|生效范围|最近|长期|范围)/;
            const text = [feedback.question, ...after.checkIns.map(itemText)].filter(Boolean).join(" ");
            const hasCheckIn = after.checkIns.some(
              (checkIn) =>
                checkIn.relatedType === "routine_goal" &&
                checkIn.relatedId === goal.id &&
                scopePattern.test(itemText(checkIn))
            );
            return hasCheckIn && scopePattern.test(text) ? true : "缺少范围确认";
          })
        ]
      }
    ]
  },
  {
    id: "routine_sleep_bare_12_ambiguous",
    title: "网站流：最近每天 12 点前睡觉需要确认",
    state: () => createState(),
    minScoreRatio: 1,
    steps: [
      {
        rawText: "我最近希望能够每天12点前睡觉。",
        expectations: [
          expect("保存为一个 routine goal", 3, ({ after }) => {
            const goals = activeRoutineGoals(after, /睡觉|睡|休息/);
            return goals.length === 1 || `routineGoals=${goals.length}`;
          }),
          expect("不能静默保存为 12:00", 3, ({ after }) => {
            const goal = activeRoutineGoals(after, /睡觉|睡|休息/)[0];
            if (!goal) return "缺少睡眠节奏目标";
            return !goal.targetTime || goal.targetTime !== "12:00" || `targetTime=${goal.targetTime}`;
          }),
          expect("不生成一次性睡觉 task", 2, ({ after }) => {
            const sleepTasks = activeTasks(after, /睡觉|睡|休息/);
            return sleepTasks.length === 0 || `sleepTasks=${sleepTasks.map(itemText).join(" | ")}`;
          }),
          expect("追问中午还是晚上/午夜", 2, ({ after, feedback }) => {
            const text = [feedback.question, ...after.checkIns.map(itemText)].filter(Boolean).join(" ");
            const hasCheckIn = after.checkIns.some(
              (checkIn) => checkIn.relatedType === "routine_goal" && /(中午|晚上|午夜|半夜|12点|十二点)/.test(itemText(checkIn))
            );
            return hasCheckIn && /(中午|晚上|午夜|半夜|12点|十二点)/.test(text) ? true : "缺少 12 点歧义确认";
          })
        ]
      }
    ]
  }
];

function selectedScenarios() {
  const scenarioId = argValue("--scenario");
  return scenarioId ? scenarios.filter((scenario) => scenario.id === scenarioId) : scenarios;
}

async function postStream({ baseUrl, rawText, state, inputType = "text" }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const progress = [];
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ai/interpret-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText,
        inputType,
        state,
        model: state.preferences.languageModel
      }),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`interpret-stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result;
    let error;

    function handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      const message = JSON.parse(trimmed);
      if (message.type === "progress") {
        progress.push(message);
        return;
      }
      if (message.type === "result") {
        if (message.feedback && (message.state || shouldSkipInterpretStateUpdate(message))) {
          result = message;
        } else if (message.error) {
          error = message.error;
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

    if (!result && error) throw new Error(error);
    if (!result) throw new Error("interpret-stream finished without a result.");
    return { result, progress };
  } finally {
    clearTimeout(timeout);
  }
}

async function runStep({ baseUrl, scenario, step, state, repeatIndex, stepIndex }) {
  const started = performance.now();
  const before = state;
  const stepLabel = `${scenario.id}#${stepIndex + 1}${repeatIndex > 0 ? `/repeat${repeatIndex + 1}` : ""}`;
  try {
    const { result, progress } = await postStream({ baseUrl, rawText: step.rawText, state, inputType: step.inputType ?? "text" });
    const after = shouldSkipInterpretStateUpdate(result) ? before : normalizeAssistantState(result.state);
    const feedback = result.feedback;
    const dashboard = generateVisibleDashboardSnapshot(after);
    const ctx = { scenario, step, before, after, dashboard, feedback, result, progress };
    const expectationResults = step.expectations.map((item) => {
      try {
        const check = normalizeCheckResult(item.check(ctx));
        return { name: item.name, points: item.points, pass: check.pass, detail: check.detail };
      } catch (error) {
        return { name: item.name, points: item.points, pass: false, detail: error instanceof Error ? error.message : String(error) };
      }
    });
    const earned = expectationResults.filter((item) => item.pass).reduce((total, item) => total + item.points, 0);
    const total = expectationResults.reduce((sum, item) => sum + item.points, 0);
    const ok = expectationResults.every((item) => item.pass);
    return {
      ok,
      state: after,
      result: {
        id: stepLabel,
        ok,
        durationMs: Math.round(performance.now() - started),
        score: total ? Number((earned / total).toFixed(3)) : 1,
        earned,
        total,
        rawText: step.rawText,
        feedback,
        provider: result.provider,
        model: result.model,
        safeFailure: result.safeFailure,
        stateUnchanged: result.stateUnchanged,
        progress: progress.map((item) => ({ stage: item.stage, status: item.status, title: item.title })),
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
        error: error instanceof Error ? error.message.replace(process.env.ARK_AGENT_PLAN_API_KEY ?? "", "[redacted]") : String(error)
      }
    };
  }
}

async function runScenario({ baseUrl, scenario, repeatIndex }) {
  let state = scenario.state();
  const steps = [];
  const started = performance.now();
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const { state: nextState, result } = await runStep({
      baseUrl,
      scenario,
      step: scenario.steps[index],
      state,
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
  return {
    id: scenario.id,
    title: scenario.title,
    ok: steps.every((step) => step.ok) && score >= scenario.minScoreRatio,
    score,
    minScoreRatio: scenario.minScoreRatio,
    repeat: repeatIndex + 1,
    durationMs: Math.round(performance.now() - started),
    steps
  };
}

function writeReport(report) {
  const outputPath = argValue("--out");
  const dir = outputPath ? path.dirname(path.resolve(root, outputPath)) : path.join(root, "eval-results");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = outputPath
    ? path.resolve(root, outputPath)
    : path.join(dir, `agent-plan-site-flow-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return filePath;
}

async function main() {
  if (hasArg("--help")) {
    console.log([
      "Usage: node scripts/agent-plan-site-flow-evals.cjs [--base-url url] [--scenario id] [--repeat n] [--out path] [--fail-fast]",
      "",
      "This eval uses the same streaming API route and state update rule as the website client.",
      "Start the app first, for example: pnpm run dev"
    ].join("\n"));
    return;
  }
  const baseUrl = argValue("--base-url") ?? process.env.EVAL_SITE_BASE_URL ?? "http://localhost:3000";
  const selected = selectedScenarios();
  if (!selected.length) throw new Error("No site-flow eval scenarios matched the requested filters.");
  const repeat = Math.max(1, Number(argValue("--repeat") ?? 1));
  const report = {
    kind: "agent-plan-site-flow-eval",
    createdAt: new Date().toISOString(),
    baseUrl,
    requestTimeoutMs,
    filters: {
      scenario: argValue("--scenario"),
      repeat
    },
    results: []
  };

  for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
    for (const scenario of selected) {
      console.log(`Running site-flow ${scenario.id} (${scenario.title}), repeat ${repeatIndex + 1}/${repeat}...`);
      const result = await runScenario({ baseUrl, scenario, repeatIndex });
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
  report.summary = { passed, total, failed: total - passed, averageScore };

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
  console.log(`${passed}/${total} site-flow scenarios passed, average score ${averageScore}.`);

  if (passed !== total) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
