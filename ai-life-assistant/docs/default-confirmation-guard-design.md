# Default Confirmation Guard Design

## Context

The assistant previously allowed a risky pattern: the model could invent a concrete default and phrase it as a confirmation question.

Example:

User says:

> 我最近都希望每天能晚上12点前睡觉，然后家里牛奶快没了，提醒我要买牛奶，我这周末另外要计划去上海

Bad assistant behavior:

- Ask whether the already explicit sleep routine is correct.
- Ask whether to create a milk reminder for tomorrow noon.
- Ask whether the Shanghai trip starts on Sunday at 2 PM.

This is harmful because it makes the assistant feel pushy and unreliable. It also creates dashboard risk: the internal structure may look plausible while the visible dashboard still shows invented or stale confirmation text.

## Product Rules

1. Do not reconfirm explicit user intent.
   - "最近每天晚上12点前睡觉" is already a concrete routine goal.
   - Save it as a `routine_goal` with `cadence=daily`, `targetTime=00:00`, `targetTimeRelation=before`, `scope=recent`.
   - Do not ask "这个日常目标对吗？" or "短期还是长期？" when the user already said "最近".

2. Do not invent reminder times.
   - "牛奶快没了，提醒我要买牛奶" should create a shopping item and a normal today task.
   - If the user gave no reminder time, do not write `dueAt`, `expectedAt`, or ask "明天中午可以吗？".

3. Do not invent travel start times.
   - "这周末计划去上海" should create a `life_event` with coarse wording and no `startsAt`.
   - Add an open clarification: "具体是哪天、几点出发？"
   - Do not ask whether it is "周日下午2点".

4. Historical memory is context, not authority.
   - Existing open loops can help understand the domain.
   - They must not fill the concrete time of a new current input unless the user explicitly says it is the same event.

## Implementation Shape

The fix uses multiple layers because relying only on prompt wording is too fragile.

- Prompt policy: tells the model not to invent defaults or reconfirm explicit routine goals.
- Post-processing: repairs unsafe model output before it reaches storage.
- Structured clarification metadata: `checkIns` carry a `clarification` slot so follow-up answers can update the right field without depending only on wording.
- Final validators: reject unsafe defaults in actions or feedback questions.
- Dashboard-visible evals: assert what the user can actually see, not only the model JSON.

## Runtime Behavior

For the example input above, the expected saved state is:

- One routine goal: "每天晚上12点前睡觉", recent, daily, before 00:00.
- One shopping item: "牛奶".
- One normal task: "买牛奶", without a default due time.
- One travel draft: "周末上海出行", with no `startsAt`.
- One open travel clarification asking for the exact departure day and time.

The dashboard must not show:

- "明天中午"
- "周日下午2点"
- "2026年7月12日"
- "你要设置的日常目标是...对吗"
- "短期目标还是长期目标"

## Verification

The verification chain now includes:

- TypeScript typecheck.
- Local regression evals.
- Live Agent Plan eval that calls the configured AI provider.
- Site-flow eval that calls `/api/ai/interpret-stream`, applies the returned state, and generates a dashboard visibility snapshot.

The site-flow scenario `explicit_sleep_milk_weekend_trip_no_default_confirmations` is required because it catches failures where the model and state look reasonable but the visible dashboard still contains unsafe or stale text.

## Residual Risks

- The current repair layer sanitizes unsafe feedback questions by replacing them with safe structured clarification questions. This is safer than failing the whole save, but reviewers should check whether any unsafe detail text can still appear in chat copy.
- Shopping "remind me" language is intentionally saved as a normal task when no time is provided. If the product later wants a true reminder time, it should ask an open question rather than choose a default.
- The rules are currently tuned around common Chinese expressions. Nearby English or mixed-language cases should be covered if those become product-critical.
