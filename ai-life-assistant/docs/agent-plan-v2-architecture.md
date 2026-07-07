# Agent Plan V2 Architecture

## Why This Exists

The current Agent Plan pipeline is moving in the right direction, but the control mechanism is still too case-driven:

- prompts ask the model to produce final product mutations;
- validators inspect final actions with hardcoded product cases;
- deterministic post-processing patches common misses;
- failures can still surface internal validation errors to the user.

That creates the wrong pressure. The model is asked to be both a semantic reasoner and a state mutation engine, while code tries to catch semantic mistakes with brittle regex guards.

The V2 goal is different:

> Let AI do language understanding and secretary-like reasoning, but make code own evidence, ambiguity, references, idempotency, and state mutation.

This is not a one-time patch. It is a contract architecture that should reduce the need for case-by-case fixes.

## Design Principles

1. AI should not directly author final database mutations.
2. AI output must carry source evidence for every substantive claim.
3. Ambiguity should become a draft or pending clarification, not a validation crash.
4. Code should validate universal invariants, not demo-specific wording.
5. Domain policy should compile intent into actions.
6. The user should never see internal schema or validation errors.
7. Evals should test contracts and product outcomes, not only model JSON.

## Target Pipeline

```text
raw input / transcript
  -> Intent Extractor LLM
  -> Coverage Critic LLM
  -> Intent Contract Validator
  -> Deterministic Policy Compiler
  -> Mutation Plan Validator
  -> Atomic Apply
  -> User-facing summary / clarification
```

## Stage 1: Intent Extractor LLM

The first AI call should output `IntentFrame[]`, not final app actions.

Each frame represents one user-intended semantic unit:

```ts
type IntentFrame = {
  id: string;
  kind:
    | "task"
    | "habit_goal"
    | "life_event"
    | "shopping_request"
    | "shopping_status_update"
    | "check_in_request"
    | "memory_candidate"
    | "no_op"
    | "cancel"
    | "clarification_answer";

  source: {
    quote: string;
    start?: number;
    end?: number;
  };

  actor: "user" | "other" | "household" | "unknown";
  polarity: "affirmed" | "negated" | "cancelled" | "hypothetical";

  title: string;
  entities: Array<{
    type: "person" | "place" | "item" | "date" | "time" | "organization";
    value: string;
  }>;

  time: {
    raw?: string;
    normalized?: string;
    recurrence?: string;
    ambiguity?: "none" | "missing_date" | "missing_time" | "relative_date" | "unclear_scope";
  };

  relations: Array<{
    type: "supports" | "reminds_about" | "updates" | "answers";
    targetIntentId: string;
  }>;

  missingSlots: string[];
  confidence: number;
};
```

The model is allowed to reason richly here. It can say:

- "准备在上海和朋友吃晚饭" means planning a dinner, not travel preparation;
- "每天半夜12点前睡觉" is a habit goal;
- "和老板请假" is a task to ask the boss for leave;
- "谢谢" is no-op;
- "朋友去苏州" is not the user's travel event.

But the model is not allowed to invent final IDs, refs, or state mutations.

## Stage 2: Coverage Critic LLM

The second AI call reviews the extracted frames against the raw input.

It should output:

```ts
type CoverageReview = {
  coveredQuotes: string[];
  uncoveredQuotes: string[];
  questionableFrames: Array<{
    intentId: string;
    reason: string;
  }>;
  suggestedFrameFixes: IntentFrame[];
};
```

This stage should not enforce product structure. It only answers:

- Did every meaningful part of the user input get a semantic destination?
- Is any frame unsupported by the original text?
- Did the extractor confuse negation, actor, or planning language?

This uses AI where AI is strongest: semantic critique.

## Stage 3: Intent Contract Validator

This is deterministic and generic.

Hard failures:

- frame has no source quote;
- source quote does not appear in raw input;
- mutation-like intent has `actor !== "user"` unless household action is explicit;
- `polarity` is negated/cancelled but compiler would create a positive action;
- confidence below threshold and no clarification path exists;
- relation target does not exist;
- unresolved required slot is marked as complete.

Soft failures:

- missing optional time;
- vague date range;
- low confidence but safe to save as draft;
- possible duplicate.

The contract validator should not know that "上海 + 高铁 + 行李" is a special case. It should know that source-backed frames, actor, polarity, missing slots, and relations are valid.

## Stage 4: Deterministic Policy Compiler

The compiler converts `IntentFrame[]` into a `MutationPlan`.

The compiler owns:

- IDs and refs;
- parent-child relationships;
- related check-ins;
- idempotency keys;
- draft vs confirmed status;
- duplicate detection;
- clarification creation;
- memory write policy;
- user-facing summary.

Example compiler modules:

```text
TaskPolicy
HabitPolicy
LifeEventPolicy
ShoppingPolicy
CheckInPolicy
MemoryPolicy
ClarificationPolicy
NoOpPolicy
CancelPolicy
```

This is where product judgment lives. It is deterministic, testable, and versioned.

## Stage 5: Mutation Plan

The compiler should produce a plan like:

```ts
type MutationPlan = {
  idempotencyKey: string;
  summary: {
    saved: string[];
    questions: string[];
    skipped: string[];
  };
  operations: Array<
    | { op: "create_task"; clientRef: string; title: string; taskType?: string; dueAt?: string }
    | { op: "create_life_event"; clientRef: string; title: string; startsAt?: string; location?: string }
    | { op: "create_check_in"; title: string; question: string; relatedClientRef?: string; relatedId?: string }
    | { op: "update_shopping_status"; itemId?: string; itemName: string; status: string; closeTaskIds?: string[] }
    | { op: "create_pending_clarification"; question: string; targetClientRef?: string }
  >;
};
```

The plan validator checks:

- every `relatedClientRef` points to an operation in the same plan;
- every `relatedId` exists in state;
- operations are idempotent;
- no operation contradicts negated/cancelled intent;
- generated operations conform to schema;
- unsafe operations require confirmation.

## How This Handles The Recent Failure

Input:

```text
我希望最近能做到每天半夜12点前睡觉。这周五我想和老板请假。周日我要去上海，准备在上海和朋友吃个晚饭。
```

Expected `IntentFrame[]`:

```json
[
  {
    "id": "sleep_goal",
    "kind": "habit_goal",
    "source": { "quote": "最近能做到每天半夜12点前睡觉" },
    "actor": "user",
    "polarity": "affirmed",
    "title": "每天半夜12点前睡觉",
    "time": { "raw": "每天半夜12点前", "recurrence": "daily", "ambiguity": "unclear_scope" },
    "missingSlots": ["start_date_or_scope"],
    "confidence": 0.86
  },
  {
    "id": "friday_leave",
    "kind": "task",
    "source": { "quote": "这周五我想和老板请假" },
    "actor": "user",
    "polarity": "affirmed",
    "title": "周五和老板请假",
    "time": { "raw": "这周五", "ambiguity": "none" },
    "missingSlots": [],
    "confidence": 0.9
  },
  {
    "id": "shanghai_dinner",
    "kind": "life_event",
    "source": { "quote": "周日我要去上海，准备在上海和朋友吃个晚饭" },
    "actor": "user",
    "polarity": "affirmed",
    "title": "周日去上海和朋友吃晚饭",
    "entities": [
      { "type": "place", "value": "上海" },
      { "type": "person", "value": "朋友" }
    ],
    "time": { "raw": "周日", "ambiguity": "none" },
    "missingSlots": [],
    "confidence": 0.9
  }
]
```

Expected compiler output:

```text
- Create habit/task: 每天半夜12点前睡觉
- Create clarification: 你想从今天开始执行这个睡眠目标，还是只先记录最近这段时间？
- Create task: 周五和老板请假
- Create life event: 周日上海和朋友晚饭
```

Important: no travel-prep check-in should be created, because "准备在上海和朋友吃个晚饭" means "planning to", not "prepare luggage/tickets".

## Error Handling UX

Internal validation errors must never be displayed directly.

If LLM extraction fails:

```text
我没敢直接保存，因为这段里有几个事项还没整理稳。
我理解到的是：睡眠目标、周五请假、周日上海晚饭。
要我先按这个保存，还是你补一句细节？
```

If compiler can safely create drafts:

```text
我先帮你保存了三件事：
1. 最近尽量每天 12 点前睡觉
2. 周五和老板请假
3. 周日去上海和朋友吃晚饭

睡眠目标的开始时间我还不确定，之后我会再问你。
```

## Migration Plan

### Phase 0: Stop User-Facing Internal Errors

- Wrap Agent Plan validation errors in calm user-facing feedback.
- Save nothing if plan is unsafe.
- Offer a human-readable interpretation summary.

### Phase 1: Add IntentFrame Behind The Current Pipeline

- Create `src/lib/ai/intentFrames/*`.
- Prompt AI to output `IntentFrame[]`.
- Keep current `AiInterpretation` as the compiler output for compatibility.
- Add deterministic tests for actor, polarity, source quote, missing slots, and relation validation.

### Phase 2: Replace Scenario Guards With Contract Validators

- Move demo-specific cases into evals, not validators.
- Keep validators generic:
  - source evidence;
  - actor/polarity;
  - unresolved required slots;
  - relation integrity;
  - schema and idempotency.

### Phase 3: Introduce Policy Compiler

- Compile frames into current `AiInterpretation` first.
- Later compile into explicit `MutationPlan`.
- Domain policies own product decisions.

### Phase 4: Pending Clarification Model

- Add first-class `PendingClarification`.
- User replies like "从今天开始", "明早", "不用了" should bind to the open clarification before creating new tasks.

### Phase 5: Server-Side Patch Apply

- Replace whole-state roundtrip with versioned patches.
- Add idempotency keys.
- Add operation logs for explanation and rollback.

## Evaluation Strategy

Add four eval layers:

1. Intent extraction contract tests:
   - source quote coverage;
   - actor/polarity;
   - no unsupported facts.

2. Policy compiler deterministic tests:
   - habit goal;
   - travel event;
   - leave request;
   - shopping status;
   - no-op;
   - cancellation.

3. End-to-end regression tests:
   - final state assertions;
   - no internal errors;
   - user-facing feedback quality.

4. Live AI evals:
   - fixed `now`;
   - repeat runs;
   - model comparison;
   - failure taxonomy;
   - latency and retry metrics.

The recent failing input must become a smoke scenario.

## What To Remove Over Time

- Hardcoded `scenarioCoverageGuards` as production blockers.
- Deterministic regex patches that infer full product behavior from raw text.
- Model-authored refs and IDs.
- Internal validation errors shown to users.

Hardcoded scenarios should remain in evals, not in runtime validation.

## Final Target

The system should feel more intelligent, not more rigid:

- AI understands nuanced language.
- Code protects the user's state.
- Ambiguity becomes a calm clarification.
- Bad model output becomes a recoverable draft, not a crash.
- Product policy is testable and explainable.
