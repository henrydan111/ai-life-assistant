const assert = require("assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jiti = require("../node_modules/.pnpm/jiti@1.21.7/node_modules/jiti")(__filename, {
  alias: {
    "@": path.join(root, "src")
  }
});

const { applyInterpretation } = jiti("../src/lib/ai/applyInterpretation.ts");
const { applyMemoryWrites } = jiti("../src/lib/memory/applyMemoryWrites.ts");
const { parseLocalInput } = jiti("../src/lib/parser/parseLocalInput.ts");
const { selectRelevantMemories, selectRelevantMemoryItems } = jiti("../src/lib/memory/selectRelevantMemories.ts");

const fixedNow = "2026-01-01T08:00:00.000Z";

function createState(overrides = {}) {
  return {
    version: 1,
    preferences: {
      displayName: "Dan",
      preferredLanguage: "zh",
      languageModel: "deepseek-v4-flash",
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
    moodLogs: [],
    lifeEvents: [],
    checkIns: [],
    recurrenceCandidates: [],
    memoryItems: [],
    inputs: [],
    ...overrides
  };
}

function memory(overrides) {
  return {
    id: overrides.id,
    type: overrides.type ?? "household",
    summary: overrides.summary,
    tags: overrides.tags ?? [],
    entities: overrides.entities ?? [],
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? "active",
    sensitivity: overrides.sensitivity ?? "low",
    evidence: [{ text: overrides.summary, createdAt: fixedNow }],
    useCount: 0,
    createdAt: fixedNow,
    updatedAt: fixedNow
  };
}

function activeTasks(state, pattern) {
  return state.tasks.filter((task) => task.status !== "cancelled" && task.status !== "done" && pattern.test(task.title));
}

function activeCheckIns(state, pattern) {
  return state.checkIns.filter((checkIn) => checkIn.status !== "dismissed" && pattern.test(`${checkIn.title} ${checkIn.question}`));
}

const evals = [
  {
    name: "suggested memories are isolated from stable memory context",
    run() {
      const state = createState({
        memoryItems: [
          memory({
            id: "mem_active_child",
            summary: "用户确认孩子周三有美术课。",
            tags: ["孩子", "兴趣班"],
            status: "active"
          }),
          memory({
            id: "mem_suggested_children",
            summary: "用户家里有三个孩子。",
            tags: ["孩子", "家庭"],
            status: "suggested"
          })
        ]
      });

      const selected = selectRelevantMemoryItems("孩子兴趣班", state);
      assert.deepEqual(selected.map((item) => item.id), ["mem_active_child"]);

      const context = selectRelevantMemories("孩子兴趣班", state);
      const factText = [
        ...context.stableFacts,
        ...context.activePatterns,
        ...context.openLoops,
        ...context.assistantPreferences
      ].join(" ");
      assert.match(factText, /孩子周三有美术课/);
      assert.doesNotMatch(factText, /三个孩子/);
      assert.match(context.pendingConfirmations.join(" "), /不要当作事实：用户家里有三个孩子/);
    }
  },
  {
    name: "memory confirmations use the memory relationship type",
    run() {
      const result = applyMemoryWrites(
        createState(),
        [
          {
            type: "recurring_pattern",
            summary: "用户可能每周都需要买牛奶。",
            tags: ["牛奶", "recurring"],
            entities: ["牛奶"],
            confidence: 0.76,
            sensitivity: "low",
            requiresConfirmation: true,
            evidence: "用户又说要买牛奶"
          }
        ],
        "input_eval"
      );

      assert.equal(result.memoryItems.length, 1);
      assert.equal(result.memoryItems[0].status, "suggested");
      assert.equal(result.checkIns.length, 1);
      assert.equal(result.checkIns[0].relatedType, "memory");
      assert.equal(result.checkIns[0].relatedId, result.memoryItems[0].id);
    }
  },
  {
    name: "local fallback keeps repeated milk requests idempotent",
    run() {
      const first = parseLocalInput("买牛奶", createState(), "text").state;
      const second = parseLocalInput("买牛奶", first, "text").state;

      const milkItems = second.shoppingItems.filter((item) => item.itemName === "牛奶" && item.status !== "removed");
      assert.equal(milkItems.length, 1);
      assert.equal(activeTasks(second, /买牛奶/).length, 1);
    }
  },
  {
    name: "local fallback keeps repeated Suzhou trips idempotent",
    run() {
      const first = parseLocalInput("周五去苏州", createState(), "text").state;
      const second = parseLocalInput("周五去苏州", first, "text").state;

      const suzhouEvents = second.lifeEvents.filter((event) => /苏州/.test(event.title) && event.status !== "cancelled");
      assert.equal(suzhouEvents.length, 1);
      assert.equal(activeTasks(second, /苏州.*行李|行李.*苏州/).length, 1);
      assert.equal(activeCheckIns(second, /苏州|行李|票/).filter((checkIn) => checkIn.relatedType === "life_event").length, 1);
    }
  },
  {
    name: "AI interpretation apply layer dedupes duplicate shopping actions",
    run() {
      const interpretation = {
        feedback: { title: "已记录", detail: "已记录牛奶购买事项。" },
        actions: [
          { type: "add_shopping_item", itemName: "牛奶", status: "needed", createTask: true },
          { type: "add_shopping_item", itemName: "牛奶", status: "needed", createTask: true }
        ],
        memoryWrites: []
      };
      const result = applyInterpretation("买牛奶", "text", createState(), interpretation).state;

      assert.equal(result.shoppingItems.filter((item) => item.itemName === "牛奶").length, 1);
      assert.equal(activeTasks(result, /买牛奶/).length, 1);
    }
  }
];

let passed = 0;
for (const item of evals) {
  try {
    item.run();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(`\n${passed}/${evals.length} regression evals passed.`);
}
