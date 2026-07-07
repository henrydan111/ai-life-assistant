# Agent Plan V3 Design

Status: design proposal for round 2 review

Round 2 decision record: see `docs/agent-plan-v3-round2-decisions.md` for the accepted revisions, especially the narrower migration plan: Phase 0 runtime safety first, Phase 1 IntentFrame shadow mode, Phase 2 ProductCompiler to current `AiInterpretation`, and `MutationPlan` only after compiler behavior is proven.

Baseline reviewed: `5ceeb7f Support routine goals in Agent Plan`

Date: 2026-07-07

## 1. Purpose

This document turns the GPT 5.5 Pro review of `5ceeb7f` into an implementable design plan.

The core product problem is not "make the current prompt stricter." The core problem is:

> Let AI use its natural language reasoning fully, while code owns product consistency, ambiguity handling, safe mutation, and user trust.

The current implementation made a correct product move by introducing `RoutineGoal` for inputs such as "我最近希望能够每天半夜12点前睡觉". But the pipeline is still action-first:

```text
LLM understanding
  -> LLM coverage
  -> LLM planning as product actions
  -> postProcess repairs / supplements actions
  -> validators
  -> applyInterpretation
```

That architecture works for a PoC, but it puts too much burden on the model:

- understand messy human language;
- decide product object type;
- fill product fields;
- create refs;
- choose clarification strategy;
- avoid memory pollution;
- satisfy schema and validators.

The long-term design should move toward:

```text
raw input
  -> semantic intent frames from AI
  -> deterministic product compiler
  -> repair with trace
  -> mutation validation
  -> partial apply / clarification
  -> calm user-facing response
```

## 2. Review Verdict

The GPT review is directionally right. The most important points to accept are:

1. `RoutineGoal` is the correct product model for user-declared life rhythm goals.
2. `postProcessAgentPlanInterpretation()` is already acting like an implicit product compiler.
3. Scenario-specific runtime validators are useful as guardrails today, but they should migrate into evals and compiler policies over time.
4. The user should never see raw validation errors.
5. The next architecture should separate semantic understanding from product mutation.

The review also identified concrete near-term risks that should be fixed before the bigger migration:

- recurring sleep goals can still duplicate as both `routineGoal` and `task`;
- "每天12点前睡觉" can be silently interpreted as `12:00` instead of becoming a clarification;
- if the model outputs `12:00` for "半夜12点", current post-process does not override it;
- `targetTime` is a string without HH:mm validation;
- validation failure can still punish the user rather than degrade to partial save or clarification.

## 3. Product Principles

These principles should drive implementation decisions.

1. AI should reason, not directly own state mutation.
2. Product objects must be source-backed.
3. Ambiguity should become a draft, missing slot, or clarification.
4. A validation problem is an internal contract issue, not a user error.
5. State mutation must be deterministic, idempotent, and explainable.
6. Memory should not duplicate active product state.
7. Habit and routine features must feel low-pressure and user-controlled.

## 4. Current Architecture Assessment

### Current Strengths

- `src/types/domain.ts` now has `RoutineGoal`.
- `src/lib/ai/interpretation.ts` supports `add_routine_goal`.
- `src/lib/ai/applyInterpretation.ts` persists routine goals and check-ins.
- `src/lib/dashboard/generateDashboard.ts` and `src/components/DashboardView.tsx` surface routine goals.
- `scripts/agent-plan-live-evals.cjs` has a `routine_sleep_goal` live scenario.
- `validateFinalInterpretation()` validates normalized actions after post-processing.

### Current Weak Points

`src/lib/ai/agentPlan/postProcess.ts` currently handles:

- travel prep split;
- routine sleep goal creation and normalization;
- travel draft creation;
- travel prep check-in creation;
- leave/boss check-in creation;
- relatedRef repair.

This is not just post-processing. It is a hidden compiler without:

- a typed semantic input;
- policy boundaries;
- trace output;
- error taxonomy;
- confidence handling;
- user-facing degradation strategy.

`src/lib/ai/agentPlan/scenarioCoverageGuards.ts` currently guards specific strings and situations:

- sleep at 12;
- recurring sleep;
- Thursday/Friday leave;
- Shanghai trip;
- Suzhou trip;
- milk;
- kids class.

Those cases are valuable as evals, but brittle as production validators.

## 5. Target Architecture

### 5.1 Data Flow

```text
RawInput
  -> TranscriptRepair
  -> IntentExtractor LLM
  -> IntentCoverage Critic LLM
  -> IntentContractValidator
  -> ProductCompiler
  -> PolicyRepair
  -> MutationValidator
  -> TransactionApplier
  -> ResponseComposer
```

### 5.2 Responsibility Split

| Layer | Owns | Must not own |
| --- | --- | --- |
| Prompt | semantic reasoning, source-backed interpretation, missing slots | final IDs, product refs, hidden business rules |
| Intent schema | source spans, kind, confidence, ambiguity, relations | database mutation shape |
| Compiler | product object selection, refs, idempotency, drafts, clarification | hallucinated semantic claims |
| Repair | safe normalization with trace | silently deciding user intent without evidence |
| Validator | universal invariants and mutation safety | hardcoded demo wording |
| Response composer | calm summary, partial success, next question | internal schema errors |

## 6. New Contracts

### 6.1 IntentFrame

Phase 1 should introduce `IntentFrame` in parallel with the current action pipeline. It does not have to replace `AiInterpretation` immediately.

```ts
export type IntentFrame = {
  id: string;
  kind:
    | "task"
    | "life_event"
    | "routine_goal"
    | "shopping_request"
    | "shopping_status_update"
    | "reminder_request"
    | "memory_candidate"
    | "clarification_answer"
    | "cancel"
    | "no_op";
  source: {
    quote: string;
    start?: number;
    end?: number;
  };
  actor: "user" | "household" | "other" | "unknown";
  polarity: "affirmed" | "negated" | "cancelled" | "hypothetical";
  title: string;
  confidence: number;
  entities: EntityMention[];
  temporal?: TemporalExpression;
  recurrence?: RecurrenceExpression;
  missingSlots: MissingSlot[];
  relations: IntentRelation[];
};
```

### 6.2 TemporalExpression

Time handling should be explicit. Do not encode uncertainty only by omitting `dueAt` or `targetTime`.

```ts
export type TemporalExpression = {
  rawText: string;
  resolved?: string;
  relation?: "before" | "at" | "after";
  granularity?: "date" | "time" | "datetime" | "range" | "fuzzy";
  ambiguity:
    | "none"
    | "ampm"
    | "missing_date"
    | "missing_time"
    | "fuzzy_scope"
    | "relative_date";
  clarificationQuestion?: string;
};
```

Temporal rules:

- "半夜12点", "午夜12点", "零点", "0点", "24点" resolve to `00:00`.
- "每天12点前睡觉" without night context must not silently resolve to `12:00`.
- If `rawText` says "半夜12点" but the model outputs `12:00`, repair to `00:00` with trace.
- Product `targetTime` must pass HH:mm validation.
- Ambiguous time can still create a draft routine goal, but the exact time stays unresolved until clarification.

### 6.3 RoutineGoalScope

Current `RoutineGoal.scope` is useful but too flat. Productization needs a richer scope object.

```ts
export type RoutineGoalScope =
  | { kind: "ongoing" }
  | {
      kind: "fuzzy";
      label: string;
      needsConfirmation: true;
      suggestedReviewAt?: string;
    }
  | {
      kind: "date_range";
      startDate?: string;
      endDate?: string;
      needsConfirmation?: boolean;
    };
```

Migration path:

- Keep existing `scope` and `scopeLabel` for compatibility.
- Add `scopeDetail?: RoutineGoalScope` in a later schema version.
- Render `scopeDetail.label` when present, otherwise existing `scopeLabel`.

### 6.4 PendingClarification

`AssistantCheckIn` is useful, but it does not fully model "the user is answering a missing slot from an existing plan."

Add a first-class clarification model:

```ts
export type PendingClarification = {
  id: string;
  sourceInputId: string;
  sourceIntentId?: string;
  targetType: "task" | "life_event" | "routine_goal" | "shopping_item" | "memory";
  targetId?: string;
  slot:
    | "target_time"
    | "scope"
    | "start_date"
    | "end_date"
    | "ask_at"
    | "duration"
    | "participant"
    | "location";
  question: string;
  options?: Array<{ label: string; value: string }>;
  status: "pending" | "answered" | "dismissed";
  createdAt: string;
  answeredAt?: string;
};
```

The existing `AssistantCheckIn` can continue to render these in the UI during migration, but user replies such as "先试一周" should update the target routine goal instead of creating a new task.

### 6.5 MutationPlan

Compiler output should eventually become explicit operations rather than current `InterpretAction`.

```ts
export type MutationPlan = {
  idempotencyKey: string;
  operations: MutationOperation[];
  clarifications: PendingClarification[];
  memoryProposals: MemoryProposal[];
  trace: PlanTrace[];
  response: {
    saved: string[];
    needsConfirmation: string[];
    skipped: string[];
  };
};
```

Phase 2 can compile into current `AiInterpretation` first. Phase 3 can introduce `MutationPlan` behind the same apply layer.

### 6.6 PlanTrace

Every repair or compiler decision should be explainable.

```ts
export type PlanTrace = {
  rule: string;
  severity: "info" | "repair" | "clarification" | "blocked";
  sourceQuote?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
};
```

Examples:

- `routine.sleep.midnight_repair`: model targetTime `12:00` repaired to `00:00` because source quote contains "半夜12点".
- `routine.sleep.remove_duplicate_task`: removed duplicate sleep task because same source quote compiled to routine goal.
- `travel.prep.split_check_in`: split one mixed travel prep check-in into separate ticket and luggage check-ins.

## 7. Immediate Phase 0 Fixes

Phase 0 should harden the current architecture before the larger migration. These are not optional.

### 7.1 Prevent Routine Sleep Duplicate Task

Problem:

`ensureRecurringSleepGoal()` can add an `add_routine_goal` while leaving a model-created `add_task` for the same sleep goal.

Design:

- In `postProcessAgentPlanInterpretation()`, when `rawHasRecurringSleepGoal(rawText)` is true, remove or convert same-source sleep `add_task` actions that express the recurring goal.
- Keep one-time sleep task only if raw text clearly has a separate one-time sleep intent.
- In `validateCoreIntentCoverage()`, add an invariant: recurring sleep input must not leave same-intent sleep `add_task`.

Files:

- `src/lib/ai/agentPlan/postProcess.ts`
- `src/lib/ai/agentPlan/scenarioCoverageGuards.ts`
- `scripts/regression-evals.cjs`
- `scripts/agent-plan-live-evals.cjs`

Acceptance:

- Input: `我最近希望每天半夜12点前睡觉`
- Final state: `routineGoals.length === 1`
- Final state: no active sleep task.

### 7.2 Treat Bare "每天12点前睡觉" As Ambiguous

Problem:

Without "半夜/晚上/午夜/凌晨/0点/24点", "12点前睡觉" can be interpreted as noon by current string parsing.

Design:

- Add a shared temporal utility for routine sleep target time parsing.
- If recurring sleep input has `12点前` but no night disambiguator, set `TemporalExpression.ambiguity = "ampm"`.
- Current action compatibility:
  - create `add_routine_goal`;
  - omit `targetTime`;
  - create routine_goal clarification asking whether the user means midnight / 24:00.
- Do not store `targetTime: "12:00"` for sleep without disambiguation.

Files:

- `src/lib/time/*` or `src/lib/ai/agentPlan/temporalPolicy.ts`
- `src/lib/ai/agentPlan/postProcess.ts`
- `src/lib/parser/parseLocalInput.ts`
- `scripts/regression-evals.cjs`

Acceptance:

- Input: `我最近希望每天12点前睡觉`
- Final state: routine goal exists.
- Final state: `targetTime` is empty or marked ambiguous.
- Check-in asks midnight/noon or exact sleep target.

### 7.3 Force Repair For Explicit Midnight Evidence

Problem:

If model outputs `targetTime: "12:00"` for "半夜12点", current post-process preserves the wrong model value.

Design:

- If source text contains explicit midnight evidence, `postProcess` must override wrong routine `targetTime` to `00:00`.
- Add trace entry.
- If a future intent layer exists, this belongs in `TemporalPolicy`.

Acceptance:

- Mock action: `add_routine_goal targetTime="12:00"`
- Raw text: `每天半夜12点前睡觉`
- Post-processed action: `targetTime="00:00"`, `targetTimeRelation="before"`.

### 7.4 Validate HH:mm Fields

Problem:

`targetTime` is currently just a string.

Design:

- Add `optionalHHMMField()` to `src/lib/ai/interpretation.ts`.
- Allow only `00:00` through `23:59`.
- Reject or repair `24:00`, `midnight`, `12am`, and malformed values.
- Use the same validator for future schedule-related time-only fields.

Acceptance:

- `targetTime: "00:00"` accepted.
- `targetTime: "24:00"` rejected or repaired to `00:00` only with source evidence.

### 7.5 No User-Facing Validation Error

Problem:

Internal validation failure can still surface as "AI planning failed validation."

Design:

- API route should map validation/planning failures to a safe product result:
  - save no unsafe mutation;
  - save raw input if useful;
  - return calm feedback;
  - optionally return a clarification summary.
- Introduce a typed `PlanningFailure` or `SafePlanningResult`.

User-facing fallback copy:

```text
我理解到你说了几件事，但这次没有完全整理稳。
我先不乱保存。你可以补一句，或者我按我理解的内容再帮你整理一次。
```

For partial-safe cases:

```text
我先保存了能确认的部分，还有一个时间/范围需要你确认。
```

Files:

- `src/app/api/ai/interpret/route.ts`
- `src/app/api/ai/interpret-stream/route.ts`
- `src/lib/ai/agentPlan/stages.ts`
- `src/lib/store/localStore.ts`

Acceptance:

- Force model to fail validation.
- UI never displays raw validator error.
- Feedback is calm and actionable.

### 7.6 Add Repair Trace

Problem:

When post-process changes model output, there is no visible explanation for evals or debugging.

Design:

- Extend current interpretation result internally with `trace?: PlanTrace[]`, or return `{ interpretation, trace }` from post-process.
- Do not expose trace directly to users.
- Include trace in eval report.

Acceptance:

- Regression eval can assert a duplicate sleep task was removed by `routine.sleep.remove_duplicate_task`.

## 8. Phase 1: IntentFrame In Parallel

Goal:

Start separating semantic understanding from product mutation without destabilizing the current app.

Design:

- Add `src/lib/ai/intentFrames/types.ts`.
- Add `src/lib/ai/intentFrames/validators.ts`.
- Add an intent-frame output to the understanding stage.
- Keep old `actions` output for compatibility.
- Use intent frames only for eval and diagnostic comparison at first.

Implementation approach:

```text
UNDERSTANDING_PROMPT outputs:
  feedback
  intent_frames
  actions      // legacy
  memory_candidates
  proactive_checkins
```

New validators:

- each frame has a source quote;
- quote appears in raw text;
- actor/polarity are explicit;
- missing required slots are represented;
- relations point to existing frames.

Acceptance:

- Existing app behavior unchanged.
- Live eval report includes `intent_frames`.
- Routine sleep scenario has one routine_goal intent with source quote.
- "朋友去苏州" is not a user travel event intent.

## 9. Phase 2: ProductCompiler

Goal:

Move product semantics out of `postProcess.ts` into deterministic, testable policies.

Proposed structure:

```text
src/lib/ai/productCompiler/
  index.ts
  types.ts
  policies/
    routineGoalPolicy.ts
    lifeEventPolicy.ts
    taskPolicy.ts
    shoppingPolicy.ts
    checkInPolicy.ts
    memoryPolicy.ts
    clarificationPolicy.ts
  repair/
    relatedRefRepair.ts
    dedupeRepair.ts
    temporalRepair.ts
```

Initial compiler output can still be `AiInterpretation`.

Policy ownership:

- `RoutineGoalPolicy`: recurring sleep, habits, scope, target time, duplicate task removal.
- `LifeEventPolicy`: travel/outings/appointments/classes and missing dates.
- `CheckInPolicy`: related reminders and parent-child linking.
- `MemoryPolicy`: memory proposal ownership and confirmation.
- `ClarificationPolicy`: missing slots and user questions.

What moves out of post-process:

- `ensureRecurringSleepGoal`;
- `ensureMentionedTravelDraft`;
- `ensureMentionedTravelPrepCheckIns`;
- `ensureLeaveBossCheckIn`.

What can remain as repair:

- ref repair;
- duplicate collapse;
- travel prep check-in split, if treated as structure normalization.

Acceptance:

- `postProcess.ts` shrinks to safe structural repair.
- Product decisions live in policy files with tests.
- Each policy returns trace.

## 10. Phase 3: PendingClarification And Multi-Turn Binding

Goal:

The assistant should know that "先试一周" answers the open sleep goal scope question, instead of creating a new task.

Design:

- Add `pendingClarifications` to `AssistantState` in schema version 2.
- Mirror pending clarifications as `AssistantCheckIn` during migration for UI compatibility.
- Before normal intent extraction, check if the latest user input likely answers a pending clarification.
- Update target object slot directly.

Example:

Turn 1:

```text
User: 我最近希望每天半夜12点前睡觉
State: RoutineGoal(scope=fuzzy, targetTime=00:00)
Clarification: scope/start/end
```

Turn 2:

```text
User: 先试一周
Compiler: update RoutineGoal(scopeDetail.date_range, endDate=+7 days)
No new task.
```

Acceptance:

- Multi-turn eval passes for routine scope answer.
- Clarification answer has trace to original clarification.

## 11. Memory Ownership Policy

Rule:

`RoutineGoal` owns the active sleep target. Memory should not duplicate it as an active fact.

Memory can store:

- stable user preferences, such as "用户希望睡眠提醒语气温和";
- confirmed long-term patterns, after user confirmation;
- assistant behavior preferences.

Memory should not store as active:

- an unconfirmed "recent" goal;
- a current routine goal that already exists as product state.

Implementation:

- `MemoryPolicy` receives product plan and filters memory proposals.
- If a model proposes a recurring_pattern memory matching a just-created routine goal:
  - either drop it;
  - or keep it as `suggested` with evidence and no prompt injection as stable fact.

Acceptance:

- Routine sleep live eval may create a suggested memory, but not active memory.
- `selectRelevantMemories()` never treats suggested memory as stable fact.

## 12. UI Product承接

The UI should separate:

1. Today actions.
2. Life events / schedule.
3. Routine goals.
4. Needs confirmation.
5. Memory suggestions.

For routine goals:

- Display "节奏目标", not "今日事项".
- Show `最近 · 每天 · 00:00前`.
- Show open clarification under the routine goal.
- Provide low-pressure controls:
  - pause;
  - adjust;
  - reduce reminders;
  - stop tracking;
  - discuss.

Avoid:

- daily completion pressure by default;
- scary streak loss UI;
- automatic intrusive reminders without user consent.

## 13. Eval Plan

### 13.1 Deterministic Regression

Add or keep these scenarios:

- `recurring_sleep_no_duplicate_task`
- `recurring_sleep_ambiguous_12`
- `recurring_sleep_midnight_repair`
- `routine_target_time_hhmm_schema`
- `validation_failure_user_safe_feedback`
- `memory_routine_goal_no_active_duplication`
- `postprocess_trace_records_repairs`

### 13.2 Live Evals

Add:

- `routine_sleep_goal`
- `routine_sleep_ambiguous_12`
- `routine_sleep_duplicate_task_model_error`
- `routine_goal_multi_turn_scope`
- `complex_life_admin_without_travel_prep_overreach`

### 13.3 UI Evals

Given a state with a routine goal:

- Dashboard renders "节奏目标".
- It shows "最近", "每天", and "00:00前".
- It does not appear in "今日事项".
- Its clarification is visibly related to the routine goal.

### 13.4 Schema Drift

Add a test that fails when:

- `ACTION_SCHEMA` in `prompts.ts` mentions a field not parsed by `interpretation.ts`;
- parser supports an enum not documented in the prompt;
- `AssistantCheckIn.relatedType` supports a type not accepted by validators.

## 14. Migration Roadmap

### Phase 0: Harden Current Pipeline

Timebox: 1 to 2 focused implementation passes.

Tasks:

1. No duplicate recurring sleep task.
2. Bare 12点 sleep ambiguity.
3. Explicit midnight repair.
4. HH:mm validator.
5. Safe user-facing validation failure.
6. Repair trace.
7. Add regression/live evals for each.

### Phase 1: IntentFrame Shadow Mode

Timebox: next PoC version.

Tasks:

1. Add `IntentFrame` types and validators.
2. Prompt understanding stage to output frames.
3. Do not use frames for apply yet.
4. Add eval report visibility.
5. Compare frame coverage vs current action coverage.

### Phase 2: Compiler To Existing Actions

Tasks:

1. Add product compiler policies.
2. Compile frames to current `AiInterpretation`.
3. Move product decisions out of `postProcess.ts`.
4. Keep current apply layer unchanged.
5. Run old and new paths side by side in eval.

### Phase 3: MutationPlan And Clarifications

Tasks:

1. Add `PendingClarification`.
2. Add `MutationPlan`.
3. Add transaction/idempotency.
4. Support multi-turn clarification answers.
5. Keep user-facing response separate from internal errors.

### Phase 4: Productization

Tasks:

1. Server-backed state.
2. Notification and review scheduler for routine goals.
3. Observability and failure taxonomy.
4. Privacy controls for routine and memory.
5. UI controls for pause, adjust, and reminder frequency.

## 15. Acceptance Criteria For V3 Direction

The V3 design is working when these statements are true:

1. AI outputs semantic evidence; code compiles product state.
2. `postProcess.ts` is no longer the main place for product behavior.
3. Ambiguity creates clarification, not validation failure.
4. Users never see raw validation errors.
5. Runtime validators enforce generic invariants.
6. Hardcoded scenarios live mostly in evals.
7. Routine goals are not duplicated into active memory.
8. A multi-turn clarification answer updates the original target.
9. Evals cover product state, user feedback, memory side effects, and UI rendering.
10. Every repair has trace.

## 16. Round 2 Review Questions

Ask GPT 5.5 Pro to review these exact questions:

1. Is the proposed IntentFrame contract too broad, too narrow, or missing critical fields?
2. Should ProductCompiler compile to current `AiInterpretation` first, or jump directly to `MutationPlan`?
3. Is `PendingClarification` separate from `AssistantCheckIn` worth the migration cost?
4. Which Phase 0 fixes should be implemented before any larger refactor?
5. What generic validators can replace the current scenario guards without losing safety?
6. How should memory proposals be filtered when product state already owns the same fact?
7. What evals are missing to prove that AI feedback is product承接, not only good text?

## 17. Non-Goals

This design does not try to solve:

- full calendar integration;
- notification delivery infrastructure;
- cloud sync;
- production auth;
- long-term analytics;
- voice model provider strategy.

Those matter later, but they should not distract from the core architecture problem: separating AI semantic reasoning from deterministic product mutation.
