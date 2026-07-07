const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const jiti = require("../node_modules/.pnpm/jiti@1.21.7/node_modules/jiti")(__filename, {
  alias: {
    "@": path.join(root, "src")
  }
});

const { interpretWithAgentPlan } = jiti("../src/lib/ai/agentPlan.ts");

const originalFetch = global.fetch;
const requestTimeoutMs = Number(process.env.BENCHMARK_REQUEST_TIMEOUT_MS ?? 30000);
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

const rawText =
  "我想做到今天12点前睡觉，然后我这周四和周五希望请假，提醒我要提前和老板说，然后我周日晚上计划去上海吃个晚饭准备高铁往返，提醒我要收拾行李和订高铁票。";

const defaultModels = [
  "doubao-seed-2.0-code",
  "doubao-seed-2.0-pro",
  "doubao-seed-2.0-lite",
  "doubao-seed-2.0-mini",
  "glm-5.2",
  "kimi-k2.7-code",
  "minimax-m3",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "minimax-m2.7",
  "kimi-k2.6"
];

const models = process.env.BENCHMARK_MODELS
  ? process.env.BENCHMARK_MODELS.split(",").map((model) => model.trim()).filter(Boolean)
  : defaultModels;

function createState(model) {
  return {
    version: 1,
    preferences: {
      displayName: "Dan",
      preferredLanguage: "zh",
      languageModel: model,
      wakeTime: "07:30",
      sleepTime: "23:30",
      planningStyle: "balanced",
      informationInterests: []
    },
    tasks: [],
    projects: [],
    shoppingItems: [],
    moodLogs: [],
    lifeEvents: [],
    checkIns: [],
    recurrenceCandidates: [],
    memoryItems: [],
    inputs: []
  };
}

function actionText(action) {
  if (action.type === "add_task") return [action.title, action.description].filter(Boolean).join(" ");
  if (action.type === "add_life_event") return [action.title, action.description, action.location].filter(Boolean).join(" ");
  if (action.type === "add_check_in") return [action.title, action.question].join(" ");
  if (action.type === "add_shopping_item") return action.itemName;
  return JSON.stringify(action);
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function quality(interpretation) {
  const actions = interpretation.actions ?? [];
  const tasks = actions.filter((action) => action.type === "add_task");
  const events = actions.filter((action) => action.type === "add_life_event");
  const checkIns = actions.filter((action) => action.type === "add_check_in");
  const allText = actions.map(actionText).join(" ");
  const issues = [];
  let score = 0;

  const sleepTask = tasks.find((action) => /(睡觉|睡|休息)/.test(actionText(action)));
  if (sleepTask) score += 1;
  else issues.push("缺少睡觉目标");

  if (sleepTask && !sleepTask.dueAt && /12点前|十二点前/.test(actionText(sleepTask))) score += 1;
  else issues.push("睡觉 12 点语义没有保持澄清状态");

  if (checkIns.some((action) => /(12:00|24:00|中午|今晚|睡觉|睡前)/.test(actionText(action)))) score += 1;
  else issues.push("缺少睡觉澄清问题");

  const leaveTasks = tasks.filter((action) => /请假/.test(actionText(action)));
  if (leaveTasks.length === 1 && /(周四|星期四)/.test(actionText(leaveTasks[0])) && /(周五|星期五)/.test(actionText(leaveTasks[0]))) {
    score += 2;
  } else {
    issues.push(`请假没有合并成一个主事项，数量=${leaveTasks.length}`);
  }

  if (checkIns.some((action) => /老板|提前/.test(actionText(action)))) score += 1;
  else issues.push("缺少提前和老板说的附属提醒");

  const shanghaiEvents = events.filter((action) => /上海/.test(actionText(action)));
  if (shanghaiEvents.length === 1 && /晚|晚饭|吃饭/.test(actionText(shanghaiEvents[0]))) score += 2;
  else issues.push(`上海没有作为一个主活动，数量=${shanghaiEvents.length}`);

  if (checkIns.some((action) => /行李/.test(actionText(action)) && /(高铁|订票|票)/.test(actionText(action)))) score += 2;
  else issues.push("缺少行李和高铁票的行前提醒");

  if (!includesAny(allText, [/7:59/, /2:00 AM/, /3:00 AM/])) score += 1;
  else issues.push("出现无来源的奇怪时间");

  return { score, issues };
}

function summarizeActions(actions) {
  return actions.map((action) => {
    if (action.type === "add_task") return `task:${action.title}${action.dueAt ? ` @ ${action.dueAt}` : ""}`;
    if (action.type === "add_life_event") return `event:${action.title}${action.startsAt ? ` @ ${action.startsAt}` : ""}`;
    if (action.type === "add_check_in") return `check:${action.title} -> ${action.question}${action.askAt ? ` @ ${action.askAt}` : ""}`;
    return `${action.type}:${actionText(action)}`;
  });
}

async function runModel(model) {
  const progress = [];
  const started = performance.now();
  const thinking = process.env.BENCHMARK_THINKING ?? "disabled";
  if (thinking === "default") {
    delete process.env.ARK_AGENT_PLAN_THINKING;
    process.env.ARK_AGENT_PLAN_DISABLE_THINKING = "false";
  } else if (thinking === "enabled") {
    process.env.ARK_AGENT_PLAN_THINKING = "enabled";
    process.env.ARK_AGENT_PLAN_DISABLE_THINKING = "false";
  } else {
    process.env.ARK_AGENT_PLAN_THINKING = "disabled";
    process.env.ARK_AGENT_PLAN_DISABLE_THINKING = "true";
  }

  try {
    const interpretation = await interpretWithAgentPlan({
      rawText,
      inputType: "text",
      state: createState(model),
      model,
      onProgress(update) {
        progress.push({ ...update, atMs: Math.round(performance.now() - started) });
      }
    });
    const durationMs = Math.round(performance.now() - started);
    const q = quality(interpretation);
    return {
      model,
      thinking,
      ok: true,
      durationMs,
      score: q.score,
      issues: q.issues,
      feedback: interpretation.feedback,
      actions: summarizeActions(interpretation.actions),
      progress
    };
  } catch (error) {
    return {
      model,
      thinking,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message.replace(process.env.ARK_AGENT_PLAN_API_KEY ?? "", "[redacted]") : String(error)
    };
  }
}

async function main() {
  const results = [];
  for (const model of models) {
    console.log(`Testing ${model} (${process.env.BENCHMARK_THINKING ?? "disabled"})...`);
    results.push(await runModel(model));
  }

  const table = results.map((result) => ({
    model: result.model,
    thinking: result.thinking,
    ok: result.ok,
    seconds: Number((result.durationMs / 1000).toFixed(2)),
    score: result.score ?? 0,
    issues: result.issues?.length ?? "-",
    error: result.error ? result.error.slice(0, 120) : ""
  }));

  console.table(table);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
