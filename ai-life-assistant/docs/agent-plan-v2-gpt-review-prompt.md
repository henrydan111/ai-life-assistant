# GPT 5.5 Pro Review Prompt

Please review this GitHub repo:

https://github.com/henrydan111/ai-life-assistant

Use the latest `main` branch. The current relevant HEAD should be:

`e9de1e8 Address Agent Plan review safety gaps`

This project is a voice-first AI life assistant / AI secretary for everyday life. It helps users manage tasks, schedules, reminders, shopping, memory, check-ins, and life events from natural language or voice.

The immediate concern is architectural:

The current Agent Plan pipeline has become too patch-like. It uses prompts, strict schema validation, scenario coverage guards, and deterministic post-processing to catch model instability. This protects state, but it can become too rigid and sometimes exposes internal validation failures to the user.

Please review this proposed V2 architecture document:

`docs/agent-plan-v2-architecture.md`

Please also inspect the current implementation:

- `src/lib/ai/agentPlan/stages.ts`
- `src/lib/ai/agentPlan/validators.ts`
- `src/lib/ai/agentPlan/scenarioCoverageGuards.ts`
- `src/lib/ai/agentPlan/postProcess.ts`
- `src/lib/ai/agentPlan/prompts.ts`
- `src/lib/ai/interpretation.ts`
- `src/lib/ai/applyInterpretation.ts`
- `src/lib/parser/parseLocalInput.ts`
- `scripts/agent-plan-live-evals.cjs`
- `scripts/regression-evals.cjs`
- `docs/eval-framework.md`

The product requirement is:

We want to fully use AI's strengths in language understanding, ambiguity reasoning, and secretary-like judgment, while effectively constraining AI instability so it cannot corrupt user state, create wrong tasks, lose intent, invent dates, attach reminders to the wrong parent, or expose internal errors.

Please review whether the V2 architecture is the right long-term direction.

Focus on these questions:

1. Is `IntentFrame[] -> contract validation -> deterministic policy compiler -> mutation plan` a better architecture than the current `LLM final actions -> validators -> post-processing` pipeline?

2. Does the proposed split use AI in the right place?
   - AI for language understanding and semantic critique.
   - Code for state mutation, references, idempotency, and safety.

3. Is the proposed `IntentFrame` schema sufficient?
   - source quote
   - actor
   - polarity
   - kind
   - entities
   - time / recurrence / ambiguity
   - relations
   - missing slots
   - confidence

4. What is missing from the `IntentFrame` contract?
   For example:
   - user intent vs observation
   - desire vs command
   - sensitivity / privacy
   - commitment level
   - draft vs confirmed
   - follow-up priority
   - recurrence details
   - household vs user ownership

5. Is the proposed Coverage Critic LLM useful, or should coverage be handled in one model call with structured self-review?

6. Should this be two AI calls, one AI call, or a hybrid?
   Please consider latency, cost, reliability, and failure recovery.

7. How should ambiguity be handled?
   Is the proposed "draft or pending clarification instead of validation crash" policy correct for a life assistant?

8. How should the system handle this real failing input?

```text
我希望最近能做到每天半夜12点前睡觉。这周五我想和老板请假。周日我要去上海，准备在上海和朋友吃个晚饭。
```

Current failure:

```text
Agent Plan planning failed validation:
actions[2].relatedType 必须是 task|shopping_item|life_event|project。
原文包含“今天12点前睡觉”意图，但最终 actions 缺少睡觉目标 add_task。
上海行程的准备提醒必须挂到 life_event 下面，不能作为并列主待办或只写在 feedback 里。
actions[2] add_check_in relatedRef="friday_leave" 没有对应的主 action ref。
actions[3] add_check_in relatedRef="shanghai_dinner" 没有对应的主 action ref。
```

Please explain how the proposed architecture should process this input, what should be saved, what should be clarified, and what should not be saved.

9. Should production validators remove hardcoded Chinese scenario guards and move those to evals?
   If not, what should remain as runtime guardrails?

10. How should the deterministic Policy Compiler be designed?
    Please review these proposed modules:
    - TaskPolicy
    - HabitPolicy
    - LifeEventPolicy
    - ShoppingPolicy
    - CheckInPolicy
    - MemoryPolicy
    - ClarificationPolicy
    - NoOpPolicy
    - CancelPolicy

11. What should the `MutationPlan` look like?
    Should it compile into current `AiInterpretation` first, or directly into a new patch/action-log model?

12. What migration path is safest?
    Current repo is still a PoC with local JSON/localStorage state. We need a path that improves reliability without rewriting the app all at once.

13. What tests should be added before migration?
    Please propose:
    - deterministic unit tests
    - live AI evals
    - golden cases
    - failure taxonomy
    - latency/cost metrics

14. What are the biggest risks in this V2 architecture?
    Please include failure modes such as:
    - AI source quote gaming
    - over-fragmented intents
    - under-specified policy compiler
    - too much latency
    - memory contamination
    - clarification overload
    - false confidence

Please output in this format:

A. One-sentence verdict

B. Your understanding of the current problem

C. Assessment of the proposed V2 architecture

D. What is strong about the design

E. Serious concerns, ordered by P0 / P1 / P2 / P3

F. Detailed review of the `IntentFrame` schema

G. Detailed review of the Coverage Critic / validation strategy

H. Detailed review of the Policy Compiler / MutationPlan strategy

I. How you would process the real failing input

J. Recommended migration roadmap
   - immediate
   - PoC next version
   - before productization

K. Concrete changes you would make to the design doc

L. Final recommendation:
   - adopt as-is
   - adopt with changes
   - reject and propose alternative

Please be strict, specific, and actionable. Cite concrete files and functions from the repo where relevant.
