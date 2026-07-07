# Agent Plan V3 Round 2 Decisions

Status: accepted design revisions after GPT 5.5 Pro round 2 review

Baseline:

- Code baseline reviewed by GPT: `5ceeb7f Support routine goals in Agent Plan`
- V3 design doc baseline: `7c9aca2 Document Agent Plan V3 design`
- This document supersedes the migration details in `docs/agent-plan-v3-design.md` where they differ.

Date: 2026-07-07

## 1. Round 2 Verdict

The V3 direction is accepted:

```text
IntentFrame -> ProductCompiler -> MutationPlan -> PendingClarification
```

But the migration must be narrower than the original V3 target architecture suggests. The immediate goal is not to add more layers. The immediate goal is to assign a single owner to each product behavior and stop user-visible contract failures.

Accepted round 2 correction:

> Do not jump from the current action-first pipeline to full `MutationPlan`. First harden runtime safety, then add `IntentFrame` in shadow mode, then compile `IntentFrame` into the current `AiInterpretation` shape, and only later introduce `MutationPlan`.

## 2. Decision Summary

| Area | Decision |
| --- | --- |
| Phase 0 | Accepted as mandatory runtime safety work. |
| IntentFrame | Accepted, but Phase 1 shadow mode only. |
| Coverage Critic | Not a Phase 1 hard dependency. Keep current coverage path for now. |
| ProductCompiler | Accepted, but compile to current `AiInterpretation` first. |
| MutationPlan | Deferred until compiler behavior is proven. |
| PendingClarification | Accepted as separate model, but can mirror to `AssistantCheckIn` during migration. |
| CheckInPolicy | Do not make it own all semantic check-in decisions. Domain policies own semantics; builders own structure. |
| PlanTrace | Must cover compiler decisions as well as repairs. |
| Memory boundary | `RoutineGoal` owns active goal; memory owns stable preference. |
| Eval | Add feedback-state consistency, multi-turn, property invariants, and compiler tests. |

## 3. Revised Architecture

### 3.1 Current Runtime, After Phase 0

```text
raw input
  -> current Agent Plan pipeline
  -> temporalPolicy
  -> safe postProcess repairs with trace
  -> validation
  -> safe planning result wrapper
  -> applyInterpretation
  -> response that never exposes internal validation errors
```

### 3.2 Phase 1 Shadow Mode

```text
understanding stage outputs:
  feedback
  intent_frames    // new shadow diagnostic contract
  actions          // legacy runtime path
  memory_candidates
  proactive_checkins

runtime apply still uses actions
evals inspect both intent_frames and applied state
```

Phase 1 should not require a new LLM coverage critic. It should answer one question:

> Can the model reliably produce source-backed semantic frames that improve diagnostics and future compilation?

### 3.3 Phase 2 Compiler Compatibility Mode

```text
IntentFrame[]
  -> ProductCompiler policies
  -> AiInterpretation actions
  -> existing applyInterpretation
```

This lets the app gain deterministic product policy without replacing the current state mutation layer.

### 3.4 Phase 3 Clarification Binding

```text
new input
  -> ClarificationAnswerMatcher checks pendingClarifications first
  -> high confidence answer updates target object
  -> otherwise falls through to Agent Plan
```

### 3.5 Phase 4 MutationPlan

```text
ProductCompiler
  -> MutationPlan
  -> transaction/idempotency validator
  -> TransactionApplier
  -> ResponseComposer generated from actual applied operations
```

## 4. Immediate Phase 0 Implementation Spec

Phase 0 should be implemented before adding any larger abstraction. These changes protect user trust and reduce current runtime risk.

### 4.1 Safe Planning Result Wrapper

Priority: P0

Problem:

`requestValidatedAgentPlanJson()` can throw validation errors such as `${stageName} failed validation: ...`. API routes can pass that message back to UI, which makes an internal contract failure look like the user's fault.

Design:

Add a safe result boundary around Agent Plan use:

```ts
type SafePlanningResult =
  | {
      status: "applied";
      interpretation: AiInterpretation;
      trace: PlanTrace[];
    }
  | {
      status: "partial";
      interpretation: AiInterpretation;
      clarifications: PendingClarification[];
      trace: PlanTrace[];
    }
  | {
      status: "no_op";
      feedback: ParseFeedback;
    }
  | {
      status: "failed_safely";
      rawInputSaved: boolean;
      feedback: ParseFeedback;
      diagnostic?: PlanningDiagnostic;
    };
```

Phase 0 can start smaller:

- catch validation/provider/timeouts in `interpret` and `interpret-stream`;
- log diagnostics internally;
- return calm feedback;
- do not expose raw validator text to the user.

Files:

- `src/app/api/ai/interpret/route.ts`
- `src/app/api/ai/interpret-stream/route.ts`
- `src/lib/ai/agentPlan/stages.ts`
- `src/lib/store/localStore.ts`

Acceptance:

- Forced validation failure never returns raw `failed validation` text to UI.
- User sees a calm explanation and either no mutation or safe partial save.

### 4.2 Shared Temporal Policy For Routine Sleep

Priority: P0

Problem:

Sleep target parsing is duplicated in `postProcess.ts` and `parseLocalInput.ts`, and bare "每天12点前睡觉" can become `12:00`.

Design:

Create a shared policy module:

```text
src/lib/ai/agentPlan/temporalPolicy.ts
```

Initial API:

```ts
type SleepTimeResolution = {
  targetTime?: string;
  targetTimeRelation?: "before" | "at" | "after";
  ambiguity: "none" | "ampm" | "missing_time";
  evidence: "explicit_midnight" | "explicit_noon" | "numeric_only" | "none";
  question?: string;
};

function resolveRecurringSleepTarget(rawText: string): SleepTimeResolution;
```

Rules:

- `半夜12点`, `午夜12点`, `零点`, `0点`, `24点`, `二十四点` -> `00:00`, no ambiguity.
- `中午12点`, `上午12点` -> `12:00`, no ambiguity.
- bare `每天12点前睡觉` -> no `targetTime`, ambiguity `ampm`, clarification required.
- `晚上12点`, `夜里12点`, `今晚12点` -> `00:00`.

Acceptance:

- Both Agent Plan post-process and local fallback use the same helper.
- No code path silently stores `targetTime: "12:00"` for bare sleep "12点前".

### 4.3 Remove Duplicate Recurring Sleep Task

Priority: P0

Problem:

If model emits `add_task: "每天12点前睡觉"` and no routine goal, `ensureRecurringSleepGoal()` can add `add_routine_goal` while leaving the task.

Design:

- When raw input is a recurring sleep goal, same-intent sleep `add_task` should be removed or converted.
- Keep a sleep task only if there is separate one-time source evidence.
- Add validator invariant so future regressions fail.

Files:

- `src/lib/ai/agentPlan/postProcess.ts`
- `src/lib/ai/agentPlan/scenarioCoverageGuards.ts`
- `scripts/regression-evals.cjs`
- `scripts/agent-plan-live-evals.cjs`

Acceptance:

- Final interpretation has routine goal.
- Final interpretation has no same-intent active sleep task.
- Applied state has no sleep task for recurring sleep-only input.

### 4.4 Explicit Midnight Repair

Priority: P0

Problem:

If model outputs `targetTime: "12:00"` for source quote "半夜12点", current post-process preserves the wrong value.

Design:

- If temporal policy returns `evidence: "explicit_midnight"`, override wrong targetTime to `00:00`.
- Add trace rule `temporal.sleep.explicit_midnight_repair`.

Acceptance:

- Mock model action with `targetTime: "12:00"` is repaired to `00:00`.
- Trace records before, after, source quote, and reason.

### 4.5 HH:mm Validation

Priority: P1

Problem:

`InterpretAction.add_routine_goal.targetTime` currently accepts any non-empty string.

Design:

- Add `optionalHHMMField()` in `src/lib/ai/interpretation.ts`.
- Accept only `00:00` through `23:59`.
- Reject malformed strings unless a prior repair normalized them.

Acceptance:

- `00:00`, `23:59` accepted.
- `24:00`, `midnight`, `12am`, `12 点` rejected.

### 4.6 Minimal PlanTrace

Priority: P1

Problem:

Repairs and compiler decisions are not observable. This makes `postProcess` hard to trust and eval failures harder to debug.

Design:

```ts
type PlanTrace = {
  rule: string;
  severity: "info" | "repair" | "clarification" | "blocked";
  sourceQuote?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
};
```

Round 2 adjustment:

Trace must include compiler decisions too, not only repairs:

- `routine.compiler.create_goal`
- `routine.compiler.scope_fuzzy`
- `clarification.compiler.create_scope_question`
- `memory.policy.drop_duplicate_product_state`
- `temporal.sleep.explicit_midnight_repair`
- `routine.repair.remove_duplicate_task`

Phase 0 can start with post-process trace only. Phase 2 compiler policies must emit trace for every product decision.

## 5. Revised IntentFrame Contract

Round 2 accepts the original IntentFrame but adds two important fields: `commitmentLevel` and `disposition`.

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
  commitmentLevel?: "wish" | "plan" | "commitment" | "hard_deadline" | "hypothetical";
  disposition?: "create" | "update" | "cancel" | "clarify" | "ignore" | "draft";
  title: string;
  confidence: number;
  sensitivity?: "low" | "medium" | "high";
  userControl?: {
    intrusiveReminderAllowed?: boolean;
    needsConsentBeforeProactive?: boolean;
  };
  productHints?: {
    preferredObject?: "task" | "life_event" | "routine_goal" | "shopping_item";
    avoidObjects?: string[];
  };
  entities: EntityMention[];
  temporal?: TemporalExpression;
  recurrence?: RecurrenceExpression;
  missingSlots: MissingSlot[];
  relations: IntentRelation[];
};
```

Important:

- `productHints` are hints only. ProductCompiler owns the final product object.
- Phase 1 shadow mode should keep required fields minimal:
  - `id`
  - `kind`
  - `source.quote`
  - `actor`
  - `polarity`
  - `title`
  - `confidence`
  - `missingSlots`
  - `relations`
- Optional fields can be evaluated but should not block runtime.

## 6. Revised TemporalExpression

Round 2 adds resolution provenance:

```ts
export type TemporalExpression = {
  rawText: string;
  timezone: string;
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
  resolvedKind?: "exact" | "defaulted" | "inferred" | "unresolved";
  resolutionSource?: "explicit_text" | "user_preference" | "product_default" | "needs_clarification";
  clarificationQuestion?: string;
};
```

This prevents user-explicit time, product default time, and inferred time from collapsing into the same field.

## 7. ProductCompiler Boundaries

Round 2 revises the policy structure:

```text
src/lib/ai/productCompiler/
  index.ts
  types.ts
  policies/
    noOpPolicy.ts
    cancelPolicy.ts
    routineGoalPolicy.ts
    lifeEventPolicy.ts
    taskPolicy.ts
    shoppingPolicy.ts
    memoryPolicy.ts
    clarificationPolicy.ts
  builders/
    checkInBuilder.ts
    mutationBuilder.ts
  repair/
    relatedRefRepair.ts
    dedupeRepair.ts
    temporalRepair.ts
```

Accepted boundary rule:

> Domain policies own semantic decisions. Builders own object construction. Repairs own safe structural normalization.

Examples:

- `RoutineGoalPolicy` decides that fuzzy recent scope needs a clarification.
- `LifeEventPolicy` decides that a travel event with no date needs a clarification.
- `ShoppingPolicy` decides whether ordered milk should create a delivery check-in.
- `checkInBuilder` builds linked check-in objects and defaults askAt.
- `relatedRefRepair` fixes references when safe.

`CheckInPolicy` should not become a global semantic owner for all check-ins.

## 8. Migration Of Existing postProcess Logic

| Current logic | New owner |
| --- | --- |
| `ensureRecurringSleepGoal` | `RoutineGoalPolicy` |
| duplicate sleep task removal | `RoutineGoalPolicy` + `dedupeRepair` |
| bare 12 ambiguity | `temporalPolicy` + `ClarificationPolicy` |
| explicit midnight repair | `temporalRepair` |
| `ensureMentionedTravelDraft` | `LifeEventPolicy` |
| `ensureMentionedTravelPrepCheckIns` | `LifeEventPolicy` / `TravelPolicy` |
| `ensureLeaveBossCheckIn` | `TaskPolicy` / `LeavePolicy` |
| `splitCombinedTravelPrepCheckIns` | `repair` if splitting existing mixed check-in; travel policy if creating from intent |
| `repairExistingRelatedRefs` | `relatedRefRepair` |

Migration rule:

> Semantic creation moves to compiler policy. Structural normalization can remain repair.

## 9. PendingClarification Revisions

Round 2 keeps `PendingClarification` as separate from `AssistantCheckIn`, and adds answer typing.

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
  expectedAnswer:
    | { kind: "date" }
    | { kind: "time" }
    | { kind: "duration" }
    | { kind: "date_range" }
    | { kind: "choice"; options: Array<{ label: string; value: string }> }
    | { kind: "boolean" }
    | { kind: "free_text" };
  priority: "blocking" | "non_blocking";
  status: "pending" | "answered" | "dismissed";
  createdAt: string;
  answeredAt?: string;
  expiresAt?: string;
  createdFromTraceRule?: string;
};
```

Binding flow:

1. New user input arrives.
2. If pending clarifications exist, run `ClarificationAnswerMatcher` before normal intent extraction.
3. High confidence answer updates target object directly.
4. Medium confidence asks confirmation.
5. Low confidence falls through to normal Agent Plan.
6. Answered clarification marks mirrored `AssistantCheckIn` as answered.

Acceptance:

- Turn 1: "我最近希望每天半夜12点前睡觉"
- Turn 2: "先试一周"
- Result: original routine goal scope is updated; no new task is created.

## 10. Memory Ownership Invariants

Accepted rule:

> `RoutineGoal` owns active routine goals. `MemoryItem` owns stable preferences and confirmed long-term facts.

Implementation invariants:

1. If current plan creates or updates a `RoutineGoal`, same-semantic `recurring_pattern` memory cannot become active.
2. If LLM proposes a related memory, `MemoryPolicy` can drop it or keep it as `suggested`.
3. Suggested memory must not enter `stableFacts` or `activePatterns`.
4. Future reasoning about active sleep goals should read from `state.routineGoals`, not memory.

This builds on the current `selectRelevantMemories()` behavior, which already isolates suggested memory from stable context.

## 11. Error Taxonomy

Round 2 says V3 needs a concrete error taxonomy. Adopt these codes:

```ts
export type PlanningErrorCode =
  | "json_parse_error"
  | "schema_error"
  | "unsupported_action"
  | "missing_required_field"
  | "ambiguous_temporal_expression"
  | "missing_slot"
  | "ref_integrity_error"
  | "duplicate_semantic_action"
  | "unsafe_memory_proposal"
  | "unsupported_mutation"
  | "provider_error"
  | "timeout";
```

Policy:

| Error code | Runtime strategy |
| --- | --- |
| `json_parse_error` | retry, then failed_safely |
| `provider_error` | failed_safely |
| `timeout` | failed_safely |
| `schema_error` | retry, then failed_safely |
| `unsupported_action` | retry, then failed_safely |
| `missing_required_field` | clarify if field is user-answerable; otherwise failed_safely |
| `ambiguous_temporal_expression` | clarification |
| `missing_slot` | clarification or partial |
| `ref_integrity_error` | repair if unique; otherwise clarification/failed_safely |
| `duplicate_semantic_action` | repair if safe; otherwise clarification |
| `unsafe_memory_proposal` | drop or suggested only |
| `unsupported_mutation` | failed_safely |

User-facing output must never include raw error codes unless the user explicitly asks for diagnostics.

## 12. Eval Revisions

Round 2 expands V3 evals from four layers to six.

### 12.1 Deterministic Regression

Must add:

- `recurring_sleep_no_duplicate_task`
- `recurring_sleep_ambiguous_12`
- `recurring_sleep_midnight_repair`
- `routine_target_time_hhmm_schema`
- `validation_failure_user_safe_feedback`
- `memory_routine_goal_no_active_duplication`
- `postprocess_trace_records_repairs`

### 12.2 Product Compiler Unit Tests

Once compiler exists:

- `RoutineGoalPolicy`: routine intent -> routine goal + clarification, no sleep task.
- `LifeEventPolicy`: actor other -> no user travel event.
- `ShoppingPolicy`: ordered milk -> update shopping status and close task.
- `ClarificationPolicy`: "先试一周" -> update routine goal scope.
- `MemoryPolicy`: routine goal already exists -> no active duplicate memory.

### 12.3 Property Invariants

For every final plan:

- every related ref resolves;
- every routine `targetTime` is empty or HH:mm;
- every product object has source evidence or trace;
- suggested memory never enters stable facts;
- no-op creates no mutation;
- destructive operation has explicit cancel/done/update evidence.

### 12.4 Multi-Turn Eval

Required scenario:

```text
Turn 1: 我最近希望每天半夜12点前睡觉
Turn 2: 先试一周
Expected: original routine goal scope updated; no new task.
```

### 12.5 Feedback-State Consistency Eval

New required layer:

- every object mentioned in feedback.saved exists in state or plan;
- every important new object appears in feedback;
- feedback.question corresponds to a real pending clarification or check-in;
- feedback does not claim a reminder was created if state has no check-in;
- feedback does not claim no changes if mutations occurred.

This is the direct test of "AI feedback is product承接, not just fluent text."

### 12.6 Live Eval Gating

| Context | Required evals |
| --- | --- |
| PR | deterministic regression + schema drift + compiler unit tests |
| prompt/schema/domain change | live smoke |
| daily/major model change | live full repeat 3 |
| release candidate | multi-turn live + UI rendering eval |

## 13. Updated Roadmap

### Now

1. Safe planning failure wrapper.
2. Shared routine sleep temporal policy.
3. No duplicate recurring sleep task.
4. Explicit midnight repair.
5. HH:mm validation.
6. Minimal trace.
7. Feedback-state consistency regression.

### Next PoC

1. IntentFrame shadow mode.
2. ProductCompiler to current `AiInterpretation`.
3. Move `ensureRecurringSleepGoal` to `RoutineGoalPolicy`.
4. Add `PendingClarification` in shadow/mirror mode.
5. Add clarification answer matcher for high-confidence simple answers.
6. Add multi-turn eval.

### Before Productization

1. Full `MutationPlan`.
2. Transaction/idempotency.
3. ResponseComposer from actual applied plan.
4. Routine review scheduler.
5. Memory governance UI and policy.
6. Observability for promptVersion, schemaVersion, compilerVersion, trace rules, validation failures, repair counts, latency, model, and eval trend.

## 14. Files To Touch First

Phase 0 should touch these files first:

- `src/lib/ai/agentPlan/temporalPolicy.ts` (new)
- `src/lib/ai/agentPlan/postProcess.ts`
- `src/lib/ai/agentPlan/scenarioCoverageGuards.ts`
- `src/lib/ai/interpretation.ts`
- `src/lib/parser/parseLocalInput.ts`
- `src/app/api/ai/interpret/route.ts`
- `src/app/api/ai/interpret-stream/route.ts`
- `scripts/regression-evals.cjs`
- `scripts/agent-plan-live-evals.cjs`

Do not touch yet:

- full `applyInterpretation()` replacement;
- server-side transaction model;
- full `MutationPlan`;
- major dashboard redesign.

## 15. Risks And Guardrails

### Risk 1: V3 becomes a new abstraction patch layer.

Guardrail:

Every product behavior must have a single owner. For example, recurring sleep creation belongs to `RoutineGoalPolicy`; post-process can only structurally repair.

### Risk 2: IntentFrame becomes too complex for the model.

Guardrail:

Phase 1 requires only a minimal frame shape. Optional fields are diagnostic and non-blocking.

### Risk 3: validation keeps punishing users.

Guardrail:

SafePlanningResult comes before stricter schema.

### Risk 4: RoutineGoal and memory duplicate each other.

Guardrail:

MemoryPolicy receives the product plan and filters same-semantic active memory.

### Risk 5: clarification answers become new tasks.

Guardrail:

ClarificationAnswerMatcher runs before normal Agent Plan when pending clarifications exist.

## 16. Implementation Rule

Do not implement all V3 abstractions at once.

The correct sequence is:

```text
make current runtime safe
  -> add semantic visibility
  -> move one product behavior to compiler
  -> add clarification binding
  -> only then replace mutation layer
```

This preserves current product behavior while removing the pressure that made `postProcess.ts` grow into a hidden compiler.
