# Evaluation Framework

The assistant now has two complementary evaluation layers.

## 1. Regression Evals

Run:

```bash
pnpm run eval:regression
```

These are deterministic local checks. They do not call a model. They protect schema validation, fallback behavior, memory isolation, duplicate handling, and known safety regressions.

Use this before every commit.

## 2. Agent Plan Live Evals

Run:

```bash
pnpm run eval:agent-plan:smoke
```

or the full suite:

```bash
pnpm run eval:agent-plan
```

Live evals call the configured Agent Plan runtime and run the same production path used by the app:

```text
simulated user input
  -> interpretWithAgentPlan()
  -> applyInterpretation()
  -> state / feedback assertions
```

This is intentionally end-to-end enough to catch prompt drift, model behavior changes, schema contract problems, and product-state mistakes.

Every live step also generates a dashboard visibility snapshot:

```text
applied state
  -> generateVisibleDashboardSnapshot()
  -> dashboard-visible assertions / report output
```

This snapshot mirrors the dashboard sections a user can actually see: today items, shopping, routine goals with related confirmations, open confirmation prompts, suggested memories, and upcoming schedule items with reminders. A scenario should fail when the state looks updated but the dashboard still shows a stale confirmation.

This closes a previous gap: live evals could pass when an entity was updated correctly, while its old pending `checkIns` remained visible on the dashboard. State-level assertions alone are not enough for confirmation-resolution work.

## Required Environment

Live evals require `.env.local` or shell env with:

```bash
AI_PROVIDER=volcengine_agent_plan_runtime
ALLOW_AGENT_PLAN_RUNTIME=true
ARK_AGENT_PLAN_API_KEY=...
```

Optional:

```bash
ARK_AGENT_PLAN_CHAT_MODEL=doubao-seed-2.0-pro
EVAL_AGENT_PLAN_MODEL=doubao-seed-2.0-pro
EVAL_AGENT_PLAN_REQUEST_TIMEOUT_MS=45000
```

## Useful Commands

List scenarios without calling AI:

```bash
pnpm run eval:agent-plan:list
```

Validate scenario definitions without calling AI:

```bash
node scripts/agent-plan-live-evals.cjs --dry-run
```

Run one scenario:

```bash
pnpm run eval:agent-plan -- --scenario travel_prep_split
```

Run all smoke scenarios three times against a specific model:

```bash
pnpm run eval:agent-plan:smoke -- --model doubao-seed-2.0-pro --repeat 3
```

Stop on the first failure:

```bash
pnpm run eval:agent-plan -- --fail-fast
```

## Report Output

Live evals write JSON reports to:

```text
eval-results/
```

Reports include:

- model and provider
- scenario score and pass/fail
- stage progress timing
- model actions
- memory writes
- applied final state summary
- dashboard-visible final snapshot
- per-expectation failure details

`eval-results/` is ignored by Git because reports may contain user-like scenario text and model outputs.

## Current Scenario Coverage

The live suite currently covers:

- pending confirmation follow-up visibility on the dashboard
- pending confirmation answers with additional same-utterance new intents
- life-event time confirmations rejecting unrelated same-time shopping intents
- complex multi-intent life admin
- no-op acknowledgement
- ambiguous travel date
- travel prep split
- shopping status update
- pending memory safety

Add new scenarios when changing prompts, validators, memory policy, fallback behavior, dashboard rendering, or apply logic. A scenario should represent a real user need and assert both the product state and the dashboard-visible result after the AI result is applied, not only the raw model JSON.
