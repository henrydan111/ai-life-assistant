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
const { postProcessAgentPlanInterpretation, postProcessAgentPlanInterpretationWithTrace } = jiti("../src/lib/ai/agentPlan/postProcess.ts");
const { confirmationTraceMeta, withoutConfirmationTrace } = jiti("../src/lib/ai/agentPlan/debugTrace.ts");
const { buildSafePlanningFailureResult } = jiti("../src/lib/ai/agentPlan/safeFailure.ts");
const { resolveRecurringSleepTarget } = jiti("../src/lib/ai/agentPlan/temporalPolicy.ts");
const { applyShoppingPolicy } = jiti("../src/lib/ai/productCompiler/policies/shoppingPolicy.ts");
const { applyTravelPolicy, ensureMentionedTravelDraft } = jiti("../src/lib/ai/productCompiler/policies/travelPolicy.ts");
const { repairFeedbackCopy } = jiti("../src/lib/ai/productCompiler/responseRepair.ts");
const { parseJsonObject } = jiti("../src/lib/ai/agentPlan/validatedJson.ts");
const {
  applyInterpretResultIfFresh,
  buildStaleInterpretResultFeedback,
  getInterpretStateUpdateBlockReason,
  isStaleInterpretResult,
  safePlanningFailureProvider,
  shouldApplyInterpretResult,
  shouldSkipInterpretStateUpdate
} = jiti("../src/lib/store/interpretResult.ts");
const { applyMemoryWrites } = jiti("../src/lib/memory/applyMemoryWrites.ts");
const { parseLocalInput } = jiti("../src/lib/parser/parseLocalInput.ts");
const { applyTravelPrepPolicy, splitCombinedTravelPrepCheckIns } = jiti("../src/lib/ai/productCompiler/policies/travelPrepPolicy.ts");
const { selectRelevantMemories, selectRelevantMemoryItems } = jiti("../src/lib/memory/selectRelevantMemories.ts");
const { generateDashboard } = jiti("../src/lib/dashboard/generateDashboard.ts");
const { generateVisibleDashboardSnapshot } = jiti("../src/lib/dashboard/visibleDashboardSnapshot.ts");
const { resolvePendingConfirmations } = jiti("../src/lib/confirmation/resolvePendingConfirmations.ts");

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
    routineGoals: [],
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
  return state.checkIns.filter((checkIn) => checkIn.status === "pending" && pattern.test(`${checkIn.title} ${checkIn.question}`));
}

function activeRoutineGoals(state, pattern) {
  return state.routineGoals.filter((goal) => goal.status !== "cancelled" && goal.status !== "done" && pattern.test(`${goal.title} ${goal.description ?? ""}`));
}

function productStateSnapshot(state) {
  return {
    tasks: state.tasks,
    projects: state.projects,
    shoppingItems: state.shoppingItems,
    routineGoals: state.routineGoals,
    moodLogs: state.moodLogs,
    lifeEvents: state.lifeEvents,
    checkIns: state.checkIns,
    recurrenceCandidates: state.recurrenceCandidates,
    memoryItems: state.memoryItems
  };
}

function assertFeedbackStateConsistency(before, after, feedback) {
  const feedbackText = [feedback.title, feedback.detail, feedback.question].filter(Boolean).join(" ");
  if (/没有保存|没有修改|没有更改/.test(feedbackText)) {
    assert.deepEqual(productStateSnapshot(after), productStateSnapshot(before));
  }
  if (feedback.question) {
    assert.equal(
      after.checkIns.some((checkIn) => {
        const text = `${checkIn.title} ${checkIn.question}`;
        return checkIn.status === "pending" && (text.includes(feedback.question) || similar(text, feedback.question));
      }),
      true
    );
  }
}

const evals = [
  {
    name: "dashboard snapshot exposes confirmation text users can see",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          },
          {
            id: "check_trip_time",
            title: "确认出行时间",
            question: "你这周末计划去上海，请问具体出行开始时间是什么时候？",
            relatedType: "life_event",
            relatedId: "missing_trip",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const dashboard = generateVisibleDashboardSnapshot(state);

      assert.match(dashboard.visibleText, /确认睡眠目标时间/);
      assert.match(dashboard.visibleText, /中午12点|午夜12点/);
      assert.match(dashboard.visibleText, /具体出行开始时间/);
    }
  },
  {
    name: "dashboard snapshot keeps undated weekend travel visible",
    run() {
      const state = createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ]
      });

      const dashboard = generateVisibleDashboardSnapshot(state);

      assert.match(dashboard.visibleText, /本周末去上海/);
      assert.match(dashboard.visibleText, /时间待确认|待确认/);
    }
  },
  {
    name: "dashboard snapshot hides answered confirmations",
    run() {
      const state = createState({
        routineGoals: [
          {
            id: "routine_sleep",
            title: "每天12点前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近",
            priority: "medium",
            status: "active",
            confidence: 0.9,
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "answered",
            createdAt: fixedNow
          }
        ]
      });

      const dashboard = generateVisibleDashboardSnapshot(state);

      assert.doesNotMatch(dashboard.visibleText, /确认睡眠目标时间|中午12点|午夜12点/);
      assert.equal(dashboard.routineGoals[0].reminders.length, 0);
    }
  },
  {
    name: "pending confirmation resolver updates event time and routine scope",
    run() {
      const state = createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: fixedNow,
            updatedAt: fixedNow
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_trip_time",
            title: "确认出行时间",
            question: "你这周末计划去上海，请问具体出行开始时间是什么时候？",
            relatedType: "life_event",
            relatedId: "event_shanghai",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          },
          {
            id: "check_sleep_scope",
            title: "确认日常目标",
            question: "你想把每天12点前睡觉设置为短期目标还是长期目标？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = resolvePendingConfirmations("周日下午2点去上海。每天12点前睡是短期目标", "text", state);
      assert.ok(result);
      const event = result.state.lifeEvents.find((item) => item.id === "event_shanghai");
      const goal = result.state.routineGoals.find((item) => item.id === "routine_sleep");
      const dashboard = generateVisibleDashboardSnapshot(result.state);

      assert.ok(event.startsAt);
      assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(new Date(event.startsAt)), "14");
      assert.equal(goal.scope, "recent");
      assert.equal(result.state.checkIns.every((checkIn) => checkIn.status !== "pending"), true);
      assert.doesNotMatch(dashboard.visibleText, /具体出行开始时间|短期目标还是长期目标/);
      assert.deepEqual(
        result.confirmationTrace.map((item) => item.rule),
        ["confirmation.life_event_time", "confirmation.routine_goal_scope"]
      );
      assert.equal(result.confirmationTrace.every((item) => item.outcome === "matched" && item.confidence > 0), true);
    }
  },
  {
    name: "pending confirmation resolver updates routine target time",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = resolvePendingConfirmations("晚上12点", "text", state);
      assert.ok(result);
      const goal = result.state.routineGoals.find((item) => item.id === "routine_sleep");

      assert.equal(goal.targetTime, "00:00");
      assert.equal(goal.targetTimeRelation, "before");
      assert.equal(result.state.checkIns[0].status, "answered");
      assert.equal(result.confirmationTrace[0].rule, "confirmation.routine_goal_target_time");
      assert.equal(result.confirmationTrace[0].checkInId, "check_sleep_time");
      assert.equal(result.confirmationTrace[0].confidence, 0.68);
    }
  },
  {
    name: "pending confirmation resolver uses clarification metadata for generic wording",
    run() {
      const state = createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        routineGoals: [
          {
            id: "routine_sleep",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近",
            priority: "medium",
            status: "active",
            confidence: 0.9,
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_trip_time",
            title: "补充一个细节",
            question: "这个还需要你确认一下。",
            relatedType: "life_event",
            relatedId: "event_shanghai",
            clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" },
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          },
          {
            id: "check_sleep_scope",
            title: "补充一个细节",
            question: "这个还需要你确认一下。",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_scope", targetField: "scope", expectedAnswerKind: "choice" },
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = resolvePendingConfirmations("周日下午2点去上海。睡觉目标先试一周", "text", state);
      assert.ok(result);
      const event = result.state.lifeEvents.find((item) => item.id === "event_shanghai");
      const goal = result.state.routineGoals.find((item) => item.id === "routine_sleep");

      assert.ok(event.startsAt);
      assert.equal(goal.scope, "recent");
      assert.equal(goal.scopeLabel, "先试一周");
      assert.equal(result.state.checkIns.every((checkIn) => checkIn.status === "answered"), true);
      assert.equal(
        result.confirmationTrace.some(
          (item) =>
            item.rule === "confirmation.life_event_time" &&
            item.slot === "life_event_time" &&
            item.checkInId === "check_trip_time" &&
            item.targetId === "event_shanghai" &&
            item.confidence === 0.92
        ),
        true
      );
      assert.equal(
        result.confirmationTrace.some(
          (item) =>
            item.rule === "confirmation.routine_goal_scope" &&
            item.slot === "routine_goal_scope" &&
            item.checkInId === "check_sleep_scope" &&
            item.targetId === "routine_sleep" &&
            item.confidence === 0.92
        ),
        true
      );
    }
  },
  {
    name: "routine target answer does not close unresolved scope clarification",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" },
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          },
          {
            id: "check_sleep_scope",
            title: "确认睡眠目标范围",
            question: "这个睡眠目标你想先从今天开始试一段时间，还是长期保持？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_scope", targetField: "scope", expectedAnswerKind: "choice" },
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = resolvePendingConfirmations("晚上12点", "text", state);
      assert.ok(result);

      assert.equal(result.state.routineGoals[0].targetTime, "00:00");
      assert.equal(result.state.checkIns.find((checkIn) => checkIn.id === "check_sleep_time").status, "answered");
      assert.equal(result.state.checkIns.find((checkIn) => checkIn.id === "check_sleep_scope").status, "pending");
    }
  },
  {
    name: "pending confirmation resolver preserves unhandled new intent",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const confirmation = resolvePendingConfirmations("晚上12点，另外明天买牛奶", "text", state);
      assert.ok(confirmation);
      assert.match(confirmation.unhandledText ?? "", /买牛奶/);
      assert.equal(confirmation.state.routineGoals[0].targetTime, "00:00");
      assert.equal(confirmation.state.checkIns[0].status, "answered");
      assert.equal(confirmation.confirmationTrace.some((item) => item.rule === "confirmation.routine_goal_target_time"), true);
      assert.equal(
        confirmation.confirmationTrace.some(
          (item) => item.rule === "confirmation.unhandled_text" && item.outcome === "unhandled" && /买牛奶/.test(item.segment)
        ),
        true
      );

      const parsed = parseLocalInput(confirmation.unhandledText ?? "", confirmation.state, "text", {
        inputId: confirmation.sourceInputId,
        appendInput: false
      }).state;
      assert.equal(parsed.shoppingItems.some((item) => item.itemName === "牛奶"), true);
      assert.equal(parsed.inputs.length, 1);
      assert.equal(parsed.inputs[0].rawText, "晚上12点，另外明天买牛奶");
      assert.equal(parsed.shoppingItems.find((item) => item.itemName === "牛奶").sourceInputId, undefined);
      assert.equal(activeTasks(parsed, /买牛奶/)[0].sourceInputId, confirmation.sourceInputId);
    }
  },
  {
    name: "pending confirmation resolver splits connector without punctuation",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const confirmation = resolvePendingConfirmations("晚上12点顺便明天买牛奶", "text", state);
      assert.ok(confirmation);
      assert.equal(confirmation.state.routineGoals[0].targetTime, "00:00");
      assert.match(confirmation.unhandledText ?? "", /买牛奶/);
    }
  },
  {
    name: "pending confirmation resolver does not bind long unrelated time sentence",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = resolvePendingConfirmations("晚上12点给妈妈打电话", "text", state);

      assert.equal(result, null);
    }
  },
  {
    name: "pending confirmation resolver does not apply bare time to unrelated event",
    run() {
      const state = createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_trip_time",
            title: "确认出行时间",
            question: "你这周末计划去上海，请问具体出行开始时间是什么时候？",
            relatedType: "life_event",
            relatedId: "event_shanghai",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          },
          {
            id: "check_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的12点前，是中午12点，还是晚上/午夜12点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = resolvePendingConfirmations("晚上12点", "text", state);
      assert.ok(result);
      const event = result.state.lifeEvents.find((item) => item.id === "event_shanghai");
      const goal = result.state.routineGoals.find((item) => item.id === "routine_sleep");

      assert.equal(event.startsAt, undefined);
      assert.equal(goal.targetTime, "00:00");
      assert.equal(result.state.checkIns.find((checkIn) => checkIn.id === "check_trip_time").status, "pending");
      assert.equal(result.state.checkIns.find((checkIn) => checkIn.id === "check_sleep_time").status, "answered");
    }
  },
  {
    name: "pending confirmation resolver does not bind unrelated life event time sentence",
    run() {
      const state = createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_trip_time",
            title: "确认出行时间",
            question: "你这周末计划去上海，请问具体出行开始时间是什么时候？",
            relatedType: "life_event",
            relatedId: "event_shanghai",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const confirmation = resolvePendingConfirmations("明天下午2点买牛奶", "text", state);
      assert.equal(confirmation, null);

      const parsed = parseLocalInput("明天下午2点买牛奶", state, "text").state;
      assert.equal(parsed.lifeEvents.find((item) => item.id === "event_shanghai").startsAt, undefined);
      assert.equal(parsed.shoppingItems.some((item) => item.itemName === "牛奶"), true);
    }
  },
  {
    name: "pending confirmation resolver binds standalone life event time answer",
    run() {
      const state = createState({
        lifeEvents: [
          {
            id: "event_shanghai",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            priority: "medium",
            participants: [],
            status: "planned",
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "check_trip_time",
            title: "确认出行时间",
            question: "你这周末计划去上海，请问具体出行开始时间是什么时候？",
            relatedType: "life_event",
            relatedId: "event_shanghai",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const confirmation = resolvePendingConfirmations("周日下午2点", "text", state);
      assert.ok(confirmation);
      const event = confirmation.state.lifeEvents.find((item) => item.id === "event_shanghai");

      assert.ok(event.startsAt);
      assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(new Date(event.startsAt)), "14");
      assert.equal(confirmation.state.checkIns[0].status, "answered");
    }
  },
  {
    name: "local fallback treats depleted known item as shopping need",
    run() {
      const result = parseLocalInput("牛奶没了", createState(), "text").state;

      assert.equal(result.shoppingItems.some((item) => item.itemName === "牛奶"), true);
      assert.equal(activeTasks(result, /买牛奶/).length, 1);
    }
  },
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
      const before = createState();
      const parsed = parseLocalInput("谢谢！", before, "text");
      const result = parsed.state;

      assert.equal(result.tasks.length, 0);
      assert.equal(result.lifeEvents.length, 0);
      assert.equal(result.shoppingItems.length, 0);
      assert.equal(result.checkIns.length, 0);
      assert.equal(result.inputs.length, 1);
      assertFeedbackStateConsistency(before, result, parsed.feedback);
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
    name: "safe planning failure keeps state unchanged and hides validation diagnostics",
    run() {
      const state = createState();
      const result = buildSafePlanningFailureResult(state, "deepseek-v4-flash");

      assert.equal(result.provider, safePlanningFailureProvider);
      assert.equal(result.state, state);
      assert.equal(result.safeFailure, true);
      assert.equal(result.stateUnchanged, true);
      assert.equal(shouldSkipInterpretStateUpdate(result), true);
      assert.match(result.feedback.detail, /没有修改|避免记错/);
      assert.doesNotMatch(result.feedback.title, /validation|schema|failed/i);
      assert.doesNotMatch(result.feedback.detail, /validation|schema|failed|actions\[/i);
      assertFeedbackStateConsistency(state, result.state, result.feedback);
    }
  },
  {
    name: "stale interpretation results are detected before overwriting state",
    run() {
      assert.equal(isStaleInterpretResult({ baseRevision: 3 }, 3), false);
      assert.equal(isStaleInterpretResult({ baseRevision: 3 }, 4), true);
      assert.equal(isStaleInterpretResult({}, 4, 3), true);
      assert.equal(isStaleInterpretResult({}, 3, 3), false);
      assert.equal(
        getInterpretStateUpdateBlockReason({ clientRequestId: "other", baseRevision: 3 }, 3, {
          clientRequestId: "request_a",
          baseRevision: 3
        }),
        "request_mismatch"
      );

      const feedback = buildStaleInterpretResultFeedback();
      assert.match(`${feedback.title} ${feedback.detail}`, /没有覆盖|总览已经更新过|避免覆盖/);
    }
  },
  {
    name: "same-base interpretation race drops the second whole-state result",
    run() {
      let currentRevision = 0;
      let committedState = createState();
      const requestA = { clientRequestId: "request_a", baseRevision: currentRevision };
      const requestB = { clientRequestId: "request_b", baseRevision: currentRevision };
      const stateA = createState({ tasks: [{ id: "task_a", title: "买牛奶" }] });
      const stateB = createState({ tasks: [{ id: "task_b", title: "买鸡蛋" }] });
      const commitState = (nextState) => {
        if (nextState !== committedState) {
          currentRevision += 1;
          committedState = nextState;
        }
      };

      assert.equal(shouldApplyInterpretResult({ clientRequestId: "request_a", baseRevision: 0 }, currentRevision, requestA), true);
      assert.equal(
        applyInterpretResultIfFresh({ clientRequestId: "request_a", baseRevision: 0, state: stateA }, currentRevision, requestA, commitState),
        null
      );
      assert.equal(currentRevision, 1);
      assert.equal(committedState.tasks[0].id, "task_a");

      assert.equal(shouldApplyInterpretResult({ clientRequestId: "request_b", baseRevision: 0 }, currentRevision, requestB), false);
      assert.equal(
        applyInterpretResultIfFresh({ clientRequestId: "request_b", baseRevision: 0, state: stateB }, currentRevision, requestB, commitState),
        "stale"
      );
      assert.equal(currentRevision, 1);
      assert.equal(committedState.tasks[0].id, "task_a");
    }
  },
  {
    name: "local fallback saves recent daily sleep as a routine goal",
    run() {
      const result = parseLocalInput("我最近希望能够每天半夜12点前睡觉。", createState(), "text");
      const goals = activeRoutineGoals(result.state, /睡觉|睡|休息/);

      assert.equal(goals.length, 1);
      assert.equal(goals[0].cadence, "daily");
      assert.equal(goals[0].targetTime, "00:00");
      assert.equal(goals[0].targetTimeRelation, "before");
      assert.equal(goals[0].scope, "recent");
      assert.equal(goals[0].scopeLabel, "最近");
      assert.equal(activeTasks(result.state, /睡觉|睡|休息/).length, 0);
      assert.equal(
        result.state.checkIns.some(
          (checkIn) =>
            checkIn.relatedType === "routine_goal" &&
            checkIn.relatedId === goals[0].id &&
            /(从今天|试|多久|开始|长期|保持|短期|范围)/.test(`${checkIn.title} ${checkIn.question}`)
        ),
        false
      );
      assert.equal(result.feedback.question, undefined);
    }
  },
  {
    name: "temporal policy treats bare recurring sleep 12 as ambiguous",
    run() {
      const resolution = resolveRecurringSleepTarget("我最近希望每天12点前睡觉。");

      assert.equal(resolution.ambiguity, "ampm");
      assert.equal(resolution.targetTime, undefined);
      assert.match(resolution.question, /中午|晚上|午夜/);
    }
  },
  {
    name: "temporal policy maps explicit evening sleep hours to 24-hour time",
    run() {
      const resolution = resolveRecurringSleepTarget("我最近希望每晚11点前睡觉。");

      assert.equal(resolution.ambiguity, "none");
      assert.equal(resolution.evidence, "explicit_evening");
      assert.equal(resolution.targetTime, "23:00");
      assert.equal(resolution.targetTimeRelation, "before");
    }
  },
  {
    name: "temporal policy handles evening and early-morning minute sleep times",
    run() {
      const evening = resolveRecurringSleepTarget("我最近希望每晚11点半前睡觉。");
      const digital = resolveRecurringSleepTarget("我最近希望每天23:30前睡觉。");
      const early = resolveRecurringSleepTarget("我最近希望每天凌晨1点前睡觉。");
      const ambiguous = resolveRecurringSleepTarget("我最近希望每天11点半前睡觉。");
      const ambiguousHour = resolveRecurringSleepTarget("我最近希望每天11点前睡觉。");
      const morning = resolveRecurringSleepTarget("我最近希望每天上午11点前休息。");

      assert.equal(evening.targetTime, "23:30");
      assert.equal(digital.targetTime, "23:30");
      assert.equal(early.targetTime, "01:00");
      assert.equal(ambiguous.ambiguity, "ampm");
      assert.equal(ambiguous.targetTime, undefined);
      assert.equal(ambiguousHour.ambiguity, "ampm");
      assert.equal(ambiguousHour.targetTime, undefined);
      assert.equal(morning.targetTime, "11:00");
    }
  },
  {
    name: "local fallback asks before saving bare recurring sleep target time",
    run() {
      const before = createState();
      const result = parseLocalInput("我最近希望每天12点前睡觉。", before, "text");
      const goals = activeRoutineGoals(result.state, /睡觉|睡|休息/);

      assert.equal(goals.length, 1);
      assert.equal(goals[0].targetTime, undefined);
      assert.equal(goals[0].targetTimeRelation, undefined);
      assert.equal(activeTasks(result.state, /睡觉|睡|休息/).length, 0);
      assert.match(result.feedback.question, /中午|晚上|午夜/);
      assert.equal(
        result.state.checkIns.some(
          (checkIn) =>
            checkIn.relatedType === "routine_goal" &&
            checkIn.relatedId === goals[0].id &&
            checkIn.clarification?.slot === "routine_goal_target_time" &&
            /中午|晚上|午夜/.test(`${checkIn.title} ${checkIn.question}`)
        ),
        true
      );
      assertFeedbackStateConsistency(before, result.state, result.feedback);
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
    name: "travel draft policy preserves coarse weekend travel wording",
    run() {
      const result = ensureMentionedTravelDraft("我这周末计划要去上海", {
        feedback: { title: "已识别", detail: "需要确认时间。" },
        actions: [],
        memoryWrites: []
      });
      const event = result.actions.find((action) => action.type === "add_life_event");
      const checkIn = result.actions.find((action) => action.type === "add_check_in");

      assert.ok(event);
      assert.match(actionText(event), /本周末.*上海/);
      assert.ok(checkIn);
      assert.match(actionText(checkIn), /具体是哪天|几点|上海/);
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
    name: "TravelPolicy removes coarse weekend default times",
    run() {
      const rawText = "我这周末计划要去上海";
      const trace = [];
      const result = applyTravelPolicy(rawText, {
        feedback: { title: "已识别", detail: "需要确认时间。" },
        actions: [
          {
            type: "add_life_event",
            ref: "shanghai_trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            startsAt: "2026-07-12T14:00:00+08:00"
          },
          {
            type: "add_check_in",
            title: "确认上海时间",
            question: "你本周日14点去上海对吗？",
            relatedType: "life_event",
            relatedRef: "shanghai_trip"
          }
        ],
        memoryWrites: []
      }, trace);
      const event = result.actions.find((action) => action.type === "add_life_event" && /上海/.test(actionText(action)));
      const checkIn = result.actions.find((action) => action.type === "add_check_in" && /具体|哪天|几点|出发/.test(actionText(action)));

      assert.ok(event);
      assert.equal(event.startsAt, undefined);
      assert.ok(checkIn);
      assert.equal(result.actions.some((action) => /本周日14点|周日下午2点/.test(actionText(action))), false);
      assert.equal(trace.some((item) => item.rule === "temporal.repair.remove_unsupported_weekend_travel_time"), true);
      assert.equal(trace.some((item) => item.rule === "temporal.repair.remove_unsupported_weekend_travel_check_in_time"), true);
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
    name: "TravelPrepPolicy owns mentioned prep check-ins",
    run() {
      const result = applyTravelPrepPolicy("周末去上海，提醒我订高铁票和收拾行李", {
        feedback: { title: "已整理", detail: "已整理上海出行。" },
        actions: [{ type: "add_life_event", ref: "trip", title: "本周末去上海", category: "travel", location: "上海" }],
        memoryWrites: []
      });

      assert.equal(result.actions.filter((action) => action.type === "add_check_in" && /高铁票|车票|订票/.test(actionText(action))).length, 1);
      assert.equal(result.actions.filter((action) => action.type === "add_check_in" && /行李|收拾/.test(actionText(action))).length, 1);
      assert.equal(
        result.actions.every((action) => action.type !== "add_check_in" || action.relatedType !== "life_event" || action.relatedRef === "trip"),
        true
      );
    }
  },
  {
    name: "TravelPrepPolicy dedupes relatedId-only prep check-ins",
    run() {
      const result = postProcessAgentPlanInterpretationWithTrace("周末去上海，提醒我订高铁票和收拾行李", createState(), {
        feedback: { title: "已整理", detail: "已整理上海出行。" },
        actions: [
          { type: "add_life_event", ref: "trip", title: "本周末去上海", category: "travel", location: "上海" },
          {
            type: "add_check_in",
            title: "确认高铁票",
            question: "高铁票订好了吗？",
            relatedType: "life_event",
            relatedId: "trip"
          }
        ],
        memoryWrites: []
      });

      const checkIns = result.interpretation.actions.filter((action) => action.type === "add_check_in");
      assert.equal(checkIns.filter((action) => /高铁票|车票|订票/.test(actionText(action))).length, 1);
      assert.equal(checkIns.filter((action) => /行李|收拾/.test(actionText(action))).length, 1);
      assert.equal(checkIns.some((action) => action.relatedId === "trip"), false);
      assert.equal(result.trace.some((item) => item.rule === "references.repair.related_id_action_ref"), true);

      const applied = applyInterpretation("周末去上海，提醒我订高铁票和收拾行李", "text", createState(), result.interpretation).state;
      const trip = applied.lifeEvents.find((event) => /上海/.test(event.title));
      assert.ok(trip);
      assert.equal(applied.checkIns.filter((checkIn) => /高铁票|车票|订票/.test(`${checkIn.title} ${checkIn.question}`)).length, 1);
      assert.equal(
        applied.checkIns.every((checkIn) => !/高铁票|车票|订票|行李|收拾/.test(`${checkIn.title} ${checkIn.question}`) || checkIn.relatedId === trip.id),
        true
      );
    }
  },
  {
    name: "TravelPrepPolicy asks before attaching prep to an ambiguous travel event",
    run() {
      const trace = [];
      const result = applyTravelPrepPolicy("提醒我订高铁票", {
        feedback: { title: "已整理", detail: "已整理行前准备。" },
        actions: [
          { type: "add_life_event", ref: "shanghai_trip", title: "去上海", category: "travel", location: "上海" },
          { type: "add_life_event", ref: "tokyo_trip", title: "去东京", category: "travel", location: "东京" }
        ],
        memoryWrites: []
      }, trace);

      assert.equal(result.actions.some((action) => action.type === "add_check_in" && action.relatedType === "life_event" && /高铁票|车票|订票/.test(actionText(action))), false);
      assert.equal(result.actions.some((action) => action.type === "add_check_in" && action.relatedType === "project" && /哪次出行/.test(actionText(action))), true);
      assert.match([result.feedback.detail, result.feedback.question].filter(Boolean).join(" "), /没把它挂到具体行程|哪次出行/);
      assert.equal(trace.some((item) => item.rule === "travel_prep.clarification.ambiguous_travel_event"), true);

      const before = createState();
      const after = applyInterpretation("提醒我订高铁票", "text", before, result).state;
      assertFeedbackStateConsistency(before, after, result.feedback);
    }
  },
  {
    name: "TravelPrepPolicy attaches prep to the explicitly mentioned travel event",
    run() {
      const result = applyTravelPrepPolicy("上海行程提醒我订高铁票", {
        feedback: { title: "已整理", detail: "已整理上海出行。" },
        actions: [
          { type: "add_life_event", ref: "shanghai_trip", title: "去上海", category: "travel", location: "上海" },
          { type: "add_life_event", ref: "tokyo_trip", title: "去东京", category: "travel", location: "东京" }
        ],
        memoryWrites: []
      });

      const ticketCheckIns = result.actions.filter((action) => action.type === "add_check_in" && /高铁票|车票|订票/.test(actionText(action)));
      assert.equal(ticketCheckIns.length, 1);
      assert.equal(ticketCheckIns[0].relatedRef, "shanghai_trip");
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
    name: "Agent Plan post-processing saves recurring sleep as a routine goal",
    run() {
      const rawText = "我最近希望能够每天半夜12点前睡觉。";
      const result = postProcessAgentPlanInterpretation(rawText, createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠目标。" },
        actions: [],
        memoryWrites: []
      });
      const goal = result.actions.find((action) => action.type === "add_routine_goal" && /睡觉|睡|休息/.test(actionText(action)));

      assert.ok(goal);
      assert.equal(goal.cadence, "daily");
      assert.equal(goal.targetTime, "00:00");
      assert.equal(goal.targetTimeRelation, "before");
      assert.equal(goal.scope, "recent");
      const checkIn = result.actions.find((action) => action.type === "add_check_in" && action.relatedType === "routine_goal");
      assert.equal(checkIn, undefined);
      assert.deepEqual(validateFinalInterpretation(rawText, result), []);
    }
  },
  {
    name: "Agent Plan post-processing removes duplicate recurring sleep task",
    run() {
      const rawText = "我最近希望能够每天半夜12点前睡觉。";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠目标。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天半夜12点前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent"
          },
          { type: "add_task", title: "半夜12点前睡觉" }
        ],
        memoryWrites: []
      });

      assert.equal(result.interpretation.actions.filter((action) => action.type === "add_task" && /睡觉|睡/.test(actionText(action))).length, 0);
      assert.equal(
        result.interpretation.actions.filter((action) => action.type === "add_routine_goal" && /睡觉|睡/.test(actionText(action))).length,
        1
      );
      assert.equal(result.trace.some((item) => item.rule === "routine.repair.remove_duplicate_task"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "Agent Plan post-processing removes redundant routine confirmation without adding scope slot",
    run() {
      const rawText = "我最近希望能够每天半夜12点前睡觉。";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: {
          title: "识别出日常早睡目标意图",
          detail: "识别到你希望最近每天半夜12点前睡觉。"
        },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_goal",
            title: "每天半夜12点前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近"
          },
          {
            type: "add_check_in",
            title: "确认日常目标",
            question: "你要设置的日常目标是最近每天午夜12点前睡觉，对吗？",
            relatedType: "routine_goal",
            relatedRef: "sleep_goal"
          }
        ],
        memoryWrites: []
      });
      const routineCheckIns = result.interpretation.actions.filter(
        (action) => action.type === "add_check_in" && action.relatedType === "routine_goal"
      );

      assert.equal(routineCheckIns.length, 0);
      assert.equal(result.trace.some((item) => item.rule === "clarification.repair.remove_redundant_routine_scope_question"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "Agent Plan post-processing repairs explicit midnight routine time",
    run() {
      const rawText = "我最近希望能够每天半夜12点前睡觉。";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠目标。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天半夜12点前睡觉",
            cadence: "daily",
            targetTime: "12:00",
            targetTimeRelation: "before",
            scope: "unspecified"
          }
        ],
        memoryWrites: []
      });
      const goal = result.interpretation.actions.find((action) => action.type === "add_routine_goal");

      assert.ok(goal);
      assert.equal(goal.targetTime, "00:00");
      assert.equal(goal.scope, "recent");
      assert.equal(result.trace.some((item) => item.rule === "temporal.sleep.explicit_midnight_repair"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "AI final validation rejects invented confirmation defaults",
    run() {
      const rawText = "我最近都希望每天能晚上12点前睡觉，然后家里牛奶快没了，提醒我要买牛奶，我这周末另外要计划去上海";
      const parsed = parseAiInterpretation({
        feedback: {
          title: "周日下午2点待确认",
          detail: "我已帮你设置明天中午提醒买牛奶，并把上海行程暂定为周日下午2点。",
          question:
            "请问以下信息是否正确：1. 你要设置的日常目标是【最近每天午夜12点前睡觉】对吗？2. 是否需要创建明天中午提醒你买牛奶的任务？3. 你本次去上海的开始时间为2026年7月12日周日下午2点对吗？"
        },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近"
          },
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed",
            createTask: true,
            dueAt: "2026-07-08T12:00:00+08:00"
          },
          {
            type: "add_life_event",
            ref: "shanghai_trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            startsAt: "2026-07-12T14:00:00+08:00"
          }
        ],
        memoryWrites: []
      });

      assert.equal(parsed.errors.length, 0);
      const errors = validateFinalInterpretation(rawText, parsed.value).join(" ");
      assert.match(errors, /日常目标|短期\/长期|最近/);
      assert.match(errors, /明天中午|提醒时间/);
      assert.match(errors, /周日下午2点|startsAt|具体日期/);
    }
  },
  {
    name: "ResponseRepair owns unsafe feedback sanitization",
    run() {
      const rawText = "明天买牛奶";
      const trace = [];
      const result = repairFeedbackCopy(rawText, {
        feedback: {
          title: "明天中午买牛奶",
          detail: "我已帮你安排明天中午买牛奶。",
          question: "是否需要明天中午提醒你买牛奶？"
        },
        actions: [],
        memoryWrites: []
      }, trace);

      const visibleFeedback = [result.feedback.title, result.feedback.detail, result.feedback.question].filter(Boolean).join(" ");
      assert.doesNotMatch(visibleFeedback, /明天中午|午饭前|午餐前/);
      assert.equal(result.feedback.title, "已整理事项");
      assert.equal(result.feedback.detail, "我已按已确认的信息整理，并把不确定的部分留作确认。");
      assert.equal(result.feedback.question, undefined);
      assert.equal(trace.some((item) => item.rule === "feedback.repair.remove_unsafe_default_confirmation"), true);
    }
  },
  {
    name: "ResponseRepair clears redundant routine goal confirmation copy",
    run() {
      const rawText = "我最近希望每天半夜12点前睡觉";
      const trace = [];
      const result = repairFeedbackCopy(rawText, {
        feedback: {
          title: "确认日常目标",
          detail: "短期目标还是长期目标，我先帮你确认。",
          question: "你要设置的日常目标是最近每天午夜12点前睡觉，对吗？短期目标还是长期目标？"
        },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近"
          }
        ],
        memoryWrites: []
      }, trace);

      const visibleFeedback = [result.feedback.title, result.feedback.detail, result.feedback.question].filter(Boolean).join(" ");
      assert.doesNotMatch(visibleFeedback, /确认日常目标|你要设置的日常目标|短期目标|长期目标|对吗/);
      assert.equal(result.feedback.title, "已整理事项");
      assert.equal(result.feedback.detail, "我已按已确认的信息整理，并把不确定的部分留作确认。");
      assert.equal(result.feedback.question, undefined);
      assert.equal(trace.some((item) => item.rule === "feedback.repair.remove_unsafe_default_confirmation"), true);
    }
  },
  {
    name: "ResponseRepair uses TravelPolicy feedback predicate by default",
    run() {
      const rawText = "这周末计划去上海";
      const unsafeFeedback = {
        feedback: {
          title: "周日下午2点去上海",
          detail: "我已把上海行程暂定为周日下午2点。",
          question: "上海行程是本周日14点吗？"
        },
        actions: [
          {
            type: "add_check_in",
            title: "确认出行时间",
            question: "这周末去上海，具体是哪天、几点出发？",
            relatedType: "life_event",
            relatedRef: "shanghai_trip",
            clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" }
          }
        ],
        memoryWrites: []
      };

      const trace = [];
      const result = repairFeedbackCopy(rawText, unsafeFeedback, trace);
      const visibleFeedback = [result.feedback.title, result.feedback.detail, result.feedback.question].filter(Boolean).join(" ");

      assert.doesNotMatch(visibleFeedback, /周日下午2点|本周日14点/);
      assert.equal(result.feedback.question, "这周末去上海，具体是哪天、几点出发？");
      assert.equal(trace.some((item) => item.rule === "feedback.repair.remove_unsafe_default_confirmation"), true);
    }
  },
  {
    name: "Agent Plan post-processing sanitizes unsafe default confirmation feedback",
    run() {
      const rawText = "我最近都希望每天能晚上12点前睡觉，然后家里牛奶快没了，提醒我要买牛奶，我这周末另外要计划去上海";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: {
          title: "周日下午2点待确认",
          detail: "我已帮你设置明天中午提醒买牛奶，并把上海行程暂定为周日下午2点。",
          question:
            "请问以下信息是否正确：1. 你要设置的日常目标是【最近每天午夜12点前睡觉】对吗？2. 是否需要创建明天中午提醒你买牛奶的任务？3. 你本次去上海的开始时间为2026年7月12日周日下午2点对吗？"
        },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近"
          },
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed",
            createTask: true,
            dueAt: "2026-07-08T12:00:00+08:00"
          },
          {
            type: "add_life_event",
            ref: "shanghai_trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            startsAt: "2026-07-12T14:00:00+08:00"
          }
        ],
        memoryWrites: []
      });
      const event = result.interpretation.actions.find((action) => action.type === "add_life_event" && /上海/.test(actionText(action)));
      const shopping = result.interpretation.actions.find((action) => action.type === "add_shopping_item" && /牛奶/.test(actionText(action)));

      assert.ok(event);
      assert.equal(event.startsAt, undefined);
      assert.ok(shopping);
      assert.equal(shopping.dueAt, undefined);
      assert.match(result.interpretation.feedback.question ?? "", /上海|具体|哪天|几点|出发/);
      assert.doesNotMatch(
        [result.interpretation.feedback.title, result.interpretation.feedback.detail, result.interpretation.feedback.question]
          .filter(Boolean)
          .join(" "),
        /明天中午|周日下午2点|日常目标.*对吗/
      );
      assert.equal(result.trace.some((item) => item.rule === "feedback.repair.remove_unsafe_default_confirmation"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "Agent Plan post-processing sanitizes unsafe default confirmation variants",
    run() {
      const rawText = "家里牛奶快没了，提醒我要买牛奶。我这周末计划要去上海";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: {
          title: "本周日14点半待确认",
          detail: "我已帮你设置明天12点买牛奶，并把上海行程暂定为7月12日下午两点。",
          question: "是否需要明天午饭前提醒买牛奶？上海行程是本周日14点吗？"
        },
        actions: [
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed",
            createTask: true,
            dueAt: "2026-07-08T12:00:00+08:00"
          },
          {
            type: "add_life_event",
            ref: "shanghai_trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海",
            startsAt: "2026-07-12T14:30:00+08:00"
          },
          {
            type: "add_check_in",
            title: "确认上海时间",
            question: "你本周日14点去上海对吗？",
            relatedType: "life_event",
            relatedRef: "shanghai_trip"
          },
          {
            type: "add_check_in",
            title: "确认出行时间",
            question: "这周末去上海，具体是哪天、几点出发？",
            relatedType: "life_event",
            relatedRef: "shanghai_trip",
            clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" }
          }
        ],
        memoryWrites: []
      });
      const visibleFeedback = [
        result.interpretation.feedback.title,
        result.interpretation.feedback.detail,
        result.interpretation.feedback.question
      ]
        .filter(Boolean)
        .join(" ");
      const event = result.interpretation.actions.find((action) => action.type === "add_life_event" && /上海/.test(actionText(action)));
      const shopping = result.interpretation.actions.find((action) => action.type === "add_shopping_item" && /牛奶/.test(actionText(action)));

      assert.ok(event);
      assert.equal(event.startsAt, undefined);
      assert.ok(shopping);
      assert.equal(shopping.dueAt, undefined);
      assert.match(result.interpretation.feedback.question ?? "", /上海|具体|哪天|几点|出发/);
      assert.equal(result.interpretation.actions.some((action) => /本周日14点|下午两点|7月12日/.test(actionText(action))), false);
      assert.doesNotMatch(visibleFeedback, /明天12点|午饭前|下午两点|14点半|7月12日|本周日14点/);
      assert.equal(result.trace.some((item) => item.rule === "temporal.repair.remove_unsupported_weekend_travel_check_in_time"), true);
      assert.equal(result.trace.some((item) => item.rule === "feedback.repair.remove_unsafe_default_confirmation"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "ShoppingPolicy owns purchase task repair",
    run() {
      const rawText = "家里牛奶快没了，提醒我要买牛奶";
      const trace = [];
      const result = applyShoppingPolicy(rawText, {
        feedback: { title: "已记录", detail: "已记录买牛奶。" },
        actions: [
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed"
          }
        ],
        memoryWrites: []
      }, trace);
      const shopping = result.actions.find((action) => action.type === "add_shopping_item" && /牛奶/.test(action.itemName));

      assert.ok(shopping);
      assert.equal(shopping.createTask, true);
      assert.equal(trace.some((item) => item.rule === "shopping.repair.ensure_purchase_task"), true);
    }
  },
  {
    name: "ShoppingPolicy moves date-only milk tasks out of today",
    run() {
      const rawText = "明天买牛奶";
      const trace = [];
      const result = applyShoppingPolicy(rawText, {
        feedback: { title: "已记录", detail: "已记录买牛奶。" },
        actions: [
          {
            type: "add_task",
            ref: "milk_task",
            title: "买牛奶",
            dueAt: "2026-01-02T12:00:00+08:00",
            horizon: "today"
          }
        ],
        memoryWrites: []
      }, trace);
      const task = result.actions.find((action) => action.type === "add_task" && /牛奶/.test(actionText(action)));
      const applied = applyInterpretation(rawText, "text", createState(), result).state;
      const dashboard = generateDashboard(applied);

      assert.ok(task);
      assert.equal(task.dueAt, undefined);
      assert.equal(task.horizon, "later");
      assert.equal(trace.some((item) => item.rule === "temporal.repair.remove_unsupported_milk_due_at"), true);
      assert.equal(dashboard.today.some((item) => /牛奶/.test(item.title)), false);
    }
  },
  {
    name: "Agent Plan post-processing keeps shopping reminders actionable",
    run() {
      const rawText = "家里牛奶快没了，提醒我要买牛奶";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: { title: "已记录", detail: "已记录买牛奶。" },
        actions: [
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed"
          }
        ],
        memoryWrites: []
      });
      const shopping = result.interpretation.actions.find((action) => action.type === "add_shopping_item" && /牛奶/.test(action.itemName));

      assert.ok(shopping);
      assert.equal(shopping.createTask, true);
      assert.equal(shopping.dueAt, undefined);
      assert.equal(result.trace.some((item) => item.rule === "shopping.repair.ensure_purchase_task"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "Agent Plan post-processing does not turn date-only milk into noon",
    run() {
      const rawText = "明天买牛奶";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: {
          title: "明天中午买牛奶",
          detail: "我已帮你安排明天中午买牛奶。",
          question: "是否需要明天中午提醒你买牛奶？"
        },
        actions: [
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed",
            createTask: true,
            dueAt: "2026-01-02T12:00:00+08:00"
          },
          {
            type: "add_task",
            ref: "milk_task",
            title: "买牛奶",
            dueAt: "2026-01-02T12:00:00+08:00",
            horizon: "today"
          }
        ],
        memoryWrites: []
      });
      const visibleFeedback = [
        result.interpretation.feedback.title,
        result.interpretation.feedback.detail,
        result.interpretation.feedback.question
      ]
        .filter(Boolean)
        .join(" ");
      const shopping = result.interpretation.actions.find((action) => action.type === "add_shopping_item" && /牛奶/.test(action.itemName));
      const task = result.interpretation.actions.find((action) => action.type === "add_task" && /牛奶/.test(actionText(action)));

      assert.ok(shopping);
      assert.equal(shopping.dueAt, undefined);
      assert.ok(task);
      assert.equal(task.dueAt, undefined);
      assert.doesNotMatch(visibleFeedback, /明天中午|12点|十二点|午饭前/);
      assert.equal(result.trace.some((item) => item.rule === "temporal.repair.remove_unsupported_milk_due_at"), true);
      assert.equal(result.trace.some((item) => item.rule === "temporal.repair.remove_unsupported_milk_shopping_due_at"), true);
      assert.equal(result.trace.some((item) => item.rule === "feedback.repair.remove_unsafe_default_confirmation"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);

      const applied = applyInterpretation(rawText, "text", createState(), result.interpretation).state;
      const shoppingTask = applied.tasks.find((item) => /牛奶/.test(item.title));
      const dashboard = generateDashboard(applied);

      assert.ok(shoppingTask);
      assert.equal(shoppingTask.horizon, "later");
      assert.equal(dashboard.today.some((item) => /牛奶/.test(item.title)), false);
      assert.equal(dashboard.shopping.some((item) => /牛奶/.test(item.itemName)), true);
    }
  },
  {
    name: "Agent Plan post-processing does not force weak shopping intent into purchase task",
    run() {
      const rawText = "提醒我问室友要不要买牛奶";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: { title: "已整理", detail: "已记录需要确认牛奶。" },
        actions: [
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed"
          }
        ],
        memoryWrites: []
      });
      const shopping = result.interpretation.actions.find((action) => action.type === "add_shopping_item" && /牛奶/.test(action.itemName));

      assert.ok(shopping);
      assert.equal(shopping.createTask, undefined);
      assert.equal(result.trace.some((item) => item.rule === "shopping.repair.ensure_purchase_task"), false);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "confirmation trace is omitted unless debugTrace is requested",
    run() {
      const result = {
        state: createState(),
        feedback: { title: "已更新确认信息", detail: "已更新。" },
        confirmationTrace: [
          {
            rule: "confirmation.routine_goal_target_time",
            outcome: "matched",
            segment: "晚上12点",
            confidence: 0.9
          }
        ]
      };

      assert.equal("confirmationTrace" in confirmationTraceMeta({}, result), false);
      assert.deepEqual(confirmationTraceMeta({ debugTrace: true }, result).confirmationTrace, result.confirmationTrace);
      assert.equal("confirmationTrace" in withoutConfirmationTrace(result), false);
    }
  },
  {
    name: "AI final validation allows sleep 12 clarification alongside coarse weekend travel",
    run() {
      const rawText = "我最近都希望每天能12点前睡觉，然后家里牛奶快没了，提醒我要买牛奶。我这周末计划要去上海";
      const parsed = parseAiInterpretation({
        feedback: { title: "已整理", detail: "已记录睡眠目标、买牛奶和上海出行。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天按时睡觉",
            cadence: "daily",
            scope: "recent",
            scopeLabel: "最近"
          },
          {
            type: "add_check_in",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedRef: "sleep_routine",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          },
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed",
            createTask: true
          },
          {
            type: "add_life_event",
            ref: "shanghai_trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海"
          },
          {
            type: "add_check_in",
            title: "确认出行时间",
            question: "这周末去上海，具体是哪天、几点出发？",
            relatedType: "life_event",
            relatedRef: "shanghai_trip",
            clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" }
          }
        ],
        memoryWrites: []
      });

      assert.equal(parsed.errors.length, 0);
      assert.deepEqual(validateFinalInterpretation(rawText, parsed.value), []);
    }
  },
  {
    name: "Agent Plan post-processing clarifies bare recurring sleep 12 instead of saving noon",
    run() {
      const rawText = "我最近希望能够每天12点前睡觉。";
      const result = postProcessAgentPlanInterpretationWithTrace(rawText, createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠目标。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天12点前睡觉",
            cadence: "daily",
            targetTime: "12:00",
            targetTimeRelation: "before",
            scope: "recent"
          }
        ],
        memoryWrites: []
      });
      const goal = result.interpretation.actions.find((action) => action.type === "add_routine_goal");
      const checkIn = result.interpretation.actions.find((action) => action.type === "add_check_in" && action.relatedType === "routine_goal");

      assert.ok(goal);
      assert.equal(goal.targetTime, undefined);
      assert.equal(goal.targetTimeRelation, undefined);
      assert.ok(checkIn);
      assert.equal(checkIn.clarification?.slot, "routine_goal_target_time");
      assert.match(actionText(checkIn), /中午|晚上|午夜/);
      assert.equal(result.trace.some((item) => item.rule === "temporal.sleep.bare_12_requires_clarification"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, result.interpretation), []);
    }
  },
  {
    name: "Agent Plan post-processing normalizes recent routine scope labels",
    run() {
      const rawText = "我最近希望能够每天半夜12点前睡觉。";
      const result = postProcessAgentPlanInterpretation(rawText, createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠目标。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天半夜12点前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "unspecified",
            scopeLabel: "待确认"
          },
          {
            type: "add_check_in",
            title: "确认睡眠目标信息",
            question: "请问这个目标是最近还是长期？",
            relatedType: "routine_goal",
            relatedRef: "sleep_routine"
          }
        ],
        memoryWrites: []
      });
      const goal = result.actions.find((action) => action.type === "add_routine_goal");

      assert.ok(goal);
      assert.equal(goal.scope, "recent");
      assert.equal(goal.scopeLabel, "最近");
      assert.equal(result.actions.some((action) => action.type === "add_check_in" && action.relatedType === "routine_goal"), false);
      assert.deepEqual(validateFinalInterpretation(rawText, result), []);
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
    name: "AI interpretation apply layer persists routine goals without redundant scope check-ins",
    run() {
      const result = applyInterpretation("我最近希望能够每天半夜12点前睡觉。", "text", createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠节奏目标。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近"
          }
        ],
        memoryWrites: []
      }).state;
      const goals = activeRoutineGoals(result, /睡觉|睡|休息/);

      assert.equal(goals.length, 1);
      assert.equal(goals[0].cadence, "daily");
      assert.equal(goals[0].targetTime, "00:00");
      assert.equal(goals[0].scope, "recent");
      assert.equal(result.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.relatedId === goals[0].id).length, 0);
      assert.equal(activeTasks(result, /睡觉|睡|休息/).length, 0);
    }
  },
  {
    name: "AI interpretation apply layer only dedupes pending check-ins",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "answered_sleep_time",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" },
            askAt: fixedNow,
            status: "answered",
            createdAt: fixedNow
          }
        ]
      });

      const first = applyInterpretation("重新确认睡眠时间", "text", state, {
        feedback: { title: "需要确认", detail: "需要重新确认睡眠时间。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          }
        ],
        memoryWrites: []
      }).state;

      assert.equal(first.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.status === "answered").length, 1);
      assert.equal(first.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.status === "pending").length, 1);

      const second = applyInterpretation("重复生成同一个确认", "text", first, {
        feedback: { title: "需要确认", detail: "仍需确认睡眠时间。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          }
        ],
        memoryWrites: []
      }).state;

      assert.equal(second.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.status === "pending").length, 1);
    }
  },
  {
    name: "AI interpretation apply layer keeps different clarification slots",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ]
      });

      const first = applyInterpretation("需要补充睡眠目标信息", "text", state, {
        feedback: { title: "需要确认", detail: "需要补充睡眠目标信息。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认睡眠目标",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          },
          {
            type: "add_check_in",
            title: "确认睡眠目标",
            question: "这个睡眠目标是先试一段时间，还是长期保持？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_scope", targetField: "scope", expectedAnswerKind: "choice" }
          }
        ],
        memoryWrites: []
      }).state;

      assert.equal(first.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.status === "pending").length, 2);
      assert.equal(first.checkIns.some((checkIn) => checkIn.clarification?.slot === "routine_goal_target_time"), true);
      assert.equal(first.checkIns.some((checkIn) => checkIn.clarification?.slot === "routine_goal_scope"), true);

      const second = applyInterpretation("重复生成睡眠目标时间确认", "text", first, {
        feedback: { title: "需要确认", detail: "仍需确认睡眠目标时间。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认睡眠目标",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          }
        ],
        memoryWrites: []
      }).state;

      assert.equal(second.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.status === "pending").length, 2);
    }
  },
  {
    name: "AI interpretation apply layer dedupes legacy and metadata clarification slots",
    run() {
      const state = createState({
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
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ],
        checkIns: [
          {
            id: "legacy_target_time_check",
            title: "确认睡眠目标",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            askAt: fixedNow,
            status: "pending",
            createdAt: fixedNow
          }
        ]
      });

      const result = applyInterpretation("重复生成带 metadata 的睡眠目标时间确认", "text", state, {
        feedback: { title: "需要确认", detail: "仍需确认睡眠目标时间。" },
        actions: [
          {
            type: "add_check_in",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedId: "routine_sleep",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          }
        ],
        memoryWrites: []
      }).state;

      assert.equal(result.checkIns.filter((checkIn) => checkIn.relatedType === "routine_goal" && checkIn.status === "pending").length, 1);
      assert.equal(result.checkIns[0].id, "legacy_target_time_check");
    }
  },
  {
    name: "AI interpretation suppresses routine goal duplicate memory writes",
    run() {
      const result = applyInterpretation("我最近希望能够每天半夜12点前睡觉。", "text", createState(), {
        feedback: { title: "已记录", detail: "已记录睡眠节奏目标。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近"
          }
        ],
        memoryWrites: [
          {
            type: "recurring_pattern",
            summary: "用户最近希望每天半夜12点前睡觉。",
            tags: ["睡觉", "作息"],
            entities: ["睡觉"],
            confidence: 0.9,
            requiresConfirmation: true,
            evidence: "用户说最近希望每天半夜12点前睡觉。"
          }
        ]
      }).state;

      assert.equal(activeRoutineGoals(result, /睡觉|睡|休息/).length, 1);
      assert.equal(result.memoryItems.length, 0);
      assert.equal(result.checkIns.filter((checkIn) => checkIn.relatedType === "memory").length, 0);
    }
  },
  {
    name: "AI interpretation suppresses memory writes duplicated by existing routine goals",
    run() {
      const state = createState({
        routineGoals: [
          {
            id: "routine_sleep",
            title: "每天 00:00 前睡觉",
            cadence: "daily",
            targetTime: "00:00",
            targetTimeRelation: "before",
            scope: "recent",
            scopeLabel: "最近",
            priority: "medium",
            status: "active",
            confidence: 0.9,
            createdAt: fixedNow,
            updatedAt: fixedNow
          }
        ]
      });
      const result = applyInterpretation("这个睡眠目标先保持。", "text", state, {
        feedback: { title: "已了解", detail: "会继续关注睡眠目标。" },
        actions: [],
        memoryWrites: [
          {
            type: "recurring_pattern",
            summary: "用户最近希望每天半夜12点前睡觉。",
            tags: ["睡觉", "作息"],
            entities: ["睡觉"],
            confidence: 0.9,
            requiresConfirmation: true,
            evidence: "用户提到继续保持睡眠目标。"
          }
        ]
      }).state;

      assert.equal(result.routineGoals.length, 1);
      assert.equal(result.memoryItems.length, 0);
      assert.equal(result.checkIns.filter((checkIn) => checkIn.relatedType === "memory").length, 0);
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
    name: "Agent Plan JSON parser repairs bare identifier string values",
    run() {
      const parsed = parseJsonObject(`{
        "feedback": {"title":"已整理","detail":"已整理。"},
        "actions": [
          {"type":add_life_event, "ref":shanghai_trip, "title":"本周末去上海", "category":travel}
        ],
        "memoryWrites": []
      }`);

      assert.equal(parsed.actions[0].type, "add_life_event");
      assert.equal(parsed.actions[0].ref, "shanghai_trip");
      assert.equal(parsed.actions[0].category, "travel");
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
    name: "AI final validation ignores invalid memory writes after dropping them",
    run() {
      const rawText = "我最近都希望每天能12点前睡觉，然后家里牛奶快没了，提醒我要买牛奶。我这周末计划要去上海";
      const raw = {
        feedback: { title: "已整理", detail: "已记录睡眠目标、牛奶和上海安排。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天按时睡觉",
            cadence: "daily",
            scope: "recent",
            scopeLabel: "最近"
          },
          {
            type: "add_check_in",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedRef: "sleep_routine",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          },
          {
            type: "add_shopping_item",
            ref: "milk",
            itemName: "牛奶",
            status: "needed",
            createTask: true
          },
          {
            type: "add_life_event",
            ref: "shanghai_trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海"
          },
          {
            type: "add_check_in",
            title: "确认出行时间",
            question: "这周末去上海，具体是哪天、几点出发？",
            relatedType: "life_event",
            relatedRef: "shanghai_trip",
            clarification: { slot: "life_event_time", targetField: "startsAt", expectedAnswerKind: "date_time" }
          }
        ],
        memoryWrites: [
          {
            type: "routine_goal",
            summary: "用户希望最近每天按时睡觉。",
            confidence: 0.8,
            evidence: "用户说最近都希望每天能12点前睡觉"
          }
        ]
      };
      const parsed = parseAiInterpretation(raw);
      assert.match(parsed.errors.join(" "), /memoryWrites\[0\]\.type/);
      assert.equal(parsed.value.memoryWrites.length, 0);
      assert.equal(parsed.value.planTrace?.some((item) => item.rule === "memory.validation.drop_invalid_write"), true);
      assert.deepEqual(validateFinalInterpretation(rawText, parsed.value, raw), []);
    }
  },
  {
    name: "AI interpretation schema accepts routine goals and time clarification check-ins",
    run() {
      const raw = {
        feedback: { title: "已记录", detail: "已记录睡眠节奏。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天按时睡觉",
            cadence: "daily",
            scope: "recent",
            scopeLabel: "最近",
            priority: "medium"
          },
          {
            type: "add_check_in",
            title: "确认睡眠目标时间",
            question: "你说的 12 点前，是中午 12 点，还是晚上/午夜 12 点？",
            relatedType: "routine_goal",
            relatedRef: "sleep_routine",
            clarification: { slot: "routine_goal_target_time", targetField: "targetTime", expectedAnswerKind: "time" }
          }
        ],
        memoryWrites: []
      };

      const parsed = parseAiInterpretation(raw);
      assert.equal(parsed.errors.length, 0);
      assert.equal(parsed.value.actions[1].clarification?.slot, "routine_goal_target_time");
      assert.deepEqual(validateAiInterpretationSchema(raw), []);
      assert.deepEqual(validateFinalInterpretation("我最近希望能够每天12点前睡觉。", parsed.value, raw), []);
    }
  },
  {
    name: "AI final validation rejects invalid normalized routine targetTime",
    run() {
      const raw = {
        feedback: { title: "已记录", detail: "已记录睡眠节奏。" },
        actions: [
          {
            type: "add_routine_goal",
            ref: "sleep_routine",
            title: "每天睡觉",
            cadence: "daily",
            targetTime: "midnight",
            targetTimeRelation: "before",
            scope: "ongoing"
          }
        ],
        memoryWrites: []
      };

      const parsed = parseAiInterpretation(raw);
      assert.equal(parsed.errors.length, 0);
      const errors = validateFinalInterpretation("我希望每天睡觉。", parsed.value, raw).join(" ");
      assert.match(errors, /targetTime.*HH:mm/);
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
    name: "AI final validation rejects relatedId values that are action refs",
    run() {
      const raw = {
        feedback: { title: "已整理", detail: "已整理上海行程。" },
        actions: [
          {
            type: "add_life_event",
            ref: "trip",
            title: "本周末去上海",
            category: "travel",
            location: "上海"
          },
          {
            type: "add_check_in",
            title: "确认高铁票",
            question: "高铁票订好了吗？",
            relatedType: "life_event",
            relatedId: "trip"
          }
        ],
        memoryWrites: []
      };

      const parsed = parseAiInterpretation(raw);
      assert.equal(parsed.errors.length, 0);
      const errors = validateFinalInterpretation("周末去上海，提醒我订高铁票", parsed.value, raw).join(" ");
      assert.match(errors, /relatedId="trip".*action ref/);
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
