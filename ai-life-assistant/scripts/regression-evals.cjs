const assert = require("assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: {
    "@": path.join(root, "src")
  }
});

const { applyInterpretation } = jiti("../src/lib/ai/applyInterpretation.ts");
const { parseAiInterpretation, validateAiInterpretationSchema } = jiti("../src/lib/ai/interpretation.ts");
const { validateCoverage, validateFinalInterpretation } = jiti("../src/lib/ai/agentPlan/validators.ts");
const { actionText } = jiti("../src/lib/ai/agentPlan/actionText.ts");
const { postProcessAgentPlanInterpretation } = jiti("../src/lib/ai/agentPlan/postProcess.ts");
const { applyMemoryWrites } = jiti("../src/lib/memory/applyMemoryWrites.ts");
const { parseLocalInput } = jiti("../src/lib/parser/parseLocalInput.ts");
const { ensureMentionedTravelDraft, splitCombinedTravelPrepCheckIns } = jiti("../src/lib/ai/agentPlan/travelPrepPolicy.ts");
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
    name: "local fallback treats no-op input as no state change",
    run() {
      const result = parseLocalInput("谢谢！", createState(), "text").state;

      assert.equal(result.tasks.length, 0);
      assert.equal(result.lifeEvents.length, 0);
      assert.equal(result.shoppingItems.length, 0);
      assert.equal(result.checkIns.length, 0);
      assert.equal(result.inputs.length, 1);
    }
  },
  {
    name: "local fallback treats common acknowledgement as no-op",
    run() {
      const result = parseLocalInput("好的，收到。", createState(), "text").state;

      assert.equal(result.tasks.length, 0);
      assert.equal(result.lifeEvents.length, 0);
      assert.equal(result.shoppingItems.length, 0);
      assert.equal(result.checkIns.length, 0);
      assert.equal(result.inputs.length, 1);
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
    name: "local fallback keeps repeated Suzhou trips idempotent with split prep check-ins",
    run() {
      const first = parseLocalInput("周五去苏州", createState(), "text").state;
      const second = parseLocalInput("周五去苏州", first, "text").state;

      const suzhouEvents = second.lifeEvents.filter((event) => /苏州/.test(event.title) && event.status !== "cancelled");
      assert.equal(suzhouEvents.length, 1);
      assert.equal(activeTasks(second, /苏州.*行李|行李.*苏州/).length, 0);
      assert.equal(activeCheckIns(second, /票/).filter((checkIn) => checkIn.relatedType === "life_event").length, 1);
      assert.equal(activeCheckIns(second, /行李/).filter((checkIn) => checkIn.relatedType === "life_event").length, 1);
      assert.equal(activeCheckIns(second, /票.*行李|行李.*票/).length, 0);
    }
  },
  {
    name: "local fallback does not invent travel dates",
    run() {
      const result = parseLocalInput("我要去苏州", createState(), "text");
      const suzhouEvents = result.state.lifeEvents.filter((event) => /苏州/.test(event.title) && event.status !== "cancelled");

      assert.equal(suzhouEvents.length, 1);
      assert.equal(suzhouEvents[0].startsAt, undefined);
      assert.equal(activeTasks(result.state, /苏州/).length, 0);
      assert.equal(activeCheckIns(result.state, /哪天|when/i).filter((checkIn) => checkIn.relatedType === "life_event").length, 1);
      assert.match(result.feedback.question, /哪天/);
    }
  },
  {
    name: "travel draft policy skips cancelled or third-party travel",
    run() {
      const base = {
        feedback: { title: "没有更改", detail: "没有保存出行。" },
        actions: [],
        memoryWrites: []
      };

      ["我不去苏州了，不用记。", "取消去苏州。", "我朋友去苏州，别记到我的行程里。"].forEach((rawText) => {
        const result = ensureMentionedTravelDraft(rawText, base);
        assert.equal(result.actions.filter((action) => action.type === "add_life_event").length, 0, rawText);
      });
    }
  },
  {
    name: "travel draft policy adds main event when only a clarification mentions the city",
    run() {
      const result = ensureMentionedTravelDraft("我要去苏州，帮我先记一下。", {
        feedback: { title: "还差一个细节", detail: "需要确认时间。", question: "你打算哪天去苏州？" },
        actions: [
          {
            type: "add_check_in",
            title: "确认出行时间",
            question: "你打算哪天去苏州？",
            relatedType: "project",
            relatedId: "assistant"
          }
        ],
        memoryWrites: []
      });

      const events = result.actions.filter((action) => action.type === "add_life_event" && /苏州/.test(actionText(action)));
      assert.equal(events.length, 1);
      assert.equal(events[0].startsAt, undefined);
    }
  },
  {
    name: "travel prep split does not duplicate generated check-ins",
    run() {
      const combined = {
        type: "add_check_in",
        title: "确认行前准备",
        question: "高铁票订好了吗？行李收拾好了吗？餐馆位置订好了吗？",
        relatedType: "life_event",
        relatedRef: "trip"
      };
      const result = splitCombinedTravelPrepCheckIns({
        feedback: { title: "已整理", detail: "已整理行前准备。" },
        actions: [
          { type: "add_life_event", ref: "trip", title: "去上海", category: "travel", location: "上海" },
          combined,
          { ...combined }
        ],
        memoryWrites: []
      });
      const checkIns = result.actions.filter((action) => action.type === "add_check_in");
      assert.equal(checkIns.filter((action) => /高铁票/.test(actionText(action))).length, 1);
      assert.equal(checkIns.filter((action) => /行李/.test(actionText(action))).length, 1);
      assert.equal(checkIns.filter((action) => /餐馆/.test(actionText(action))).length, 1);
    }
  },
  {
    name: "Agent Plan post-processing fills explicit leave and travel prep check-ins",
    run() {
      const rawText =
        "我这周四和周五希望请假，提醒我要提前和老板说，然后我周日晚上计划去上海，提醒我要订高铁票和收拾行李。";
      const result = postProcessAgentPlanInterpretation(rawText, createState(), {
        feedback: { title: "已整理", detail: "已整理请假和上海行程。" },
        actions: [
          { type: "add_task", title: "周四和周五请假" },
          { type: "add_life_event", title: "去上海", category: "travel", location: "上海" }
        ],
        memoryWrites: []
      });

      assert.equal(result.actions.some((action) => action.type === "add_check_in" && action.relatedType === "task" && /老板/.test(actionText(action))), true);
      assert.equal(result.actions.some((action) => action.type === "add_check_in" && action.relatedType === "life_event" && /高铁票/.test(actionText(action))), true);
      assert.equal(result.actions.some((action) => action.type === "add_check_in" && action.relatedType === "life_event" && /行李/.test(actionText(action))), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result).filter((error) => /relatedRef|relatedType/.test(error)), []);
    }
  },
  {
    name: "Agent Plan post-processing converts existing object relatedRef ids",
    run() {
      const state = createState({
        shoppingItems: [
          {
            id: "shop_milk",
            itemName: "牛奶",
            status: "needed",
            category: "household",
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ]
      });
      const result = postProcessAgentPlanInterpretation("牛奶已经下单了，明早送到。", state, {
        feedback: { title: "已更新", detail: "牛奶已下单。" },
        actions: [
          { type: "update_shopping_status", itemName: "牛奶", status: "ordered" },
          {
            type: "add_check_in",
            title: "确认收货",
            question: "明早牛奶送到了吗？",
            relatedType: "shopping_item",
            relatedRef: "shop_milk"
          }
        ],
        memoryWrites: []
      });
      const checkIn = result.actions.find((action) => action.type === "add_check_in");

      assert.equal(checkIn.relatedId, "shop_milk");
      assert.equal(checkIn.relatedRef, undefined);
      assert.deepEqual(validateFinalInterpretation("牛奶已经下单了，明早送到。", result).filter((error) => /relatedRef/.test(error)), []);
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
  },
  {
    name: "AI shopping status update closes matching purchase task",
    run() {
      const state = createState({
        shoppingItems: [
          {
            id: "shop_milk",
            itemName: "牛奶",
            status: "needed",
            category: "household",
            createdAt: fixedNow,
            updatedAt: fixedNow
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ]
      });
      const result = applyInterpretation("牛奶已经下单了，明早送到。", "text", state, {
        feedback: { title: "已更新", detail: "牛奶已标记为下单。" },
        actions: [{ type: "update_shopping_status", itemName: "牛奶", status: "ordered" }],
        memoryWrites: []
      }).state;

      assert.equal(result.shoppingItems[0].status, "ordered");
      assert.equal(result.tasks.find((task) => task.id === "task_milk").status, "done");
      assert.equal(activeTasks(result, /买牛奶/).length, 0);
    }
  },
  {
    name: "local fallback closes matching purchase task after order update",
    run() {
      const state = createState({
        shoppingItems: [
          {
            id: "shop_milk",
            itemName: "牛奶",
            status: "needed",
            category: "household",
            createdAt: fixedNow,
            updatedAt: fixedNow
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ]
      });
      const result = parseLocalInput("牛奶已经下单了，明早送到。", state, "text").state;

      assert.equal(result.shoppingItems[0].status, "ordered");
      assert.equal(result.tasks.find((task) => task.id === "task_milk").status, "done");
      assert.equal(activeTasks(result, /买牛奶/).length, 0);
    }
  },
  {
    name: "AI interpretation schema rejects malformed actions and memory writes",
    run() {
      const raw = {
        feedback: { title: "已记录", detail: "已记录。" },
        actions: [
          { type: "add_task", priority: "urgent" },
          { type: "update_shopping_status", itemName: "牛奶", status: "arriving" }
        ],
        memoryWrites: [
          {
            type: "recurring_pattern",
            summary: "用户可能定期买牛奶。",
            confidence: "high",
            requiresConfirmation: "yes",
            evidence: "用户又说要买牛奶"
          }
        ]
      };

      const parsed = parseAiInterpretation(raw);
      const errors = validateAiInterpretationSchema(raw).join(" ");
      assert.equal(parsed.value.actions.length, 0);
      assert.equal(parsed.value.memoryWrites.length, 0);
      assert.match(errors, /actions\[0\]\.title/);
      assert.match(errors, /actions\[0\]\.priority/);
      assert.match(errors, /actions\[1\]\.status/);
      assert.match(errors, /memoryWrites\[0\]\.confidence/);
      assert.match(errors, /memoryWrites\[0\]\.requiresConfirmation/);
    }
  },
  {
    name: "AI interpretation allows zero-action no-op outputs",
    run() {
      const raw = {
        feedback: { title: "没有更改", detail: "这次没有保存或修改任何事项。" },
        actions: [],
        memoryWrites: []
      };

      const parsed = parseAiInterpretation(raw);
      assert.equal(parsed.value.actions.length, 0);
      assert.equal(parsed.value.memoryWrites.length, 0);
      assert.deepEqual(validateAiInterpretationSchema(raw), []);
      assert.deepEqual(
        validateCoverage(
          "谢谢",
          {
            coverage: "complete",
            missingIntents: [],
            revisedActions: [],
            memoryCandidates: [],
            proactiveCheckins: []
          },
          { coverage: "complete", missing_intents: [], revised_actions: [] }
        ),
        []
      );
    }
  },
  {
    name: "AI final validation rejects unresolved check-in related refs",
    run() {
      const raw = {
        feedback: { title: "已整理", detail: "已整理提醒。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认车票",
            question: "车票订好了吗？",
            relatedType: "life_event",
            relatedRef: "missing_trip"
          }
        ],
        memoryWrites: []
      };

      const parsed = parseAiInterpretation(raw);
      assert.equal(parsed.errors.length, 0);
      const errors = validateFinalInterpretation("提醒我确认车票", parsed.value, raw).join(" ");
      assert.match(errors, /relatedRef="missing_trip"/);
    }
  },
  {
    name: "AI check-ins must declare a related type",
    run() {
      const raw = {
        feedback: { title: "已整理", detail: "已整理提醒。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认车票",
            question: "车票订好了吗？",
            relatedRef: "trip"
          }
        ],
        memoryWrites: []
      };

      assert.match(validateAiInterpretationSchema(raw).join(" "), /actions\[0\]\.relatedType/);
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
