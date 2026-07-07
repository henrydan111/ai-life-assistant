# GPT Review Prompt: Pending Confirmation Resolution Design

Use this prompt with a web-capable GPT model that can open GitHub links.

```txt
You are reviewing a design proposal for an AI life assistant app.

Please read this design doc directly from GitHub:
https://github.com/henrydan111/ai-life-assistant/blob/main/ai-life-assistant/docs/pending-confirmation-resolution-design.md

Repo:
https://github.com/henrydan111/ai-life-assistant

Product context:
- This app is an AI life assistant, closer to a calm butler/secretary than a task-management tool.
- The user can speak or type messy natural language such as goals, shopping needs, reminders, and travel plans.
- The app stores local state with tasks, shopping items, routine goals, life events, check-ins, memories, and recent inputs.
- The dashboard should make the user feel understood and in control. It must not show stale questions after the user already answered them.

Bug context:
- The assistant may ask for missing information through pending check-ins.
- A later user reply often gets interpreted as a new generic input instead of being applied to the existing pending check-in and its parent item.
- This creates contradictory dashboard state. Example: a travel event already has "Sunday 2 PM", while the dashboard still asks for the travel time.

When reviewing, please inspect the design doc first, then check the current implementation where helpful. Relevant code entry points likely include:
- ai-life-assistant/src/types/domain.ts
- ai-life-assistant/src/lib/store/localStore.ts
- ai-life-assistant/src/lib/store/interpretResult.ts
- ai-life-assistant/src/lib/ai/applyInterpretation.ts
- ai-life-assistant/src/lib/ai/interpretation.ts
- ai-life-assistant/src/lib/ai/agentPlan/types.ts
- ai-life-assistant/src/lib/ai/agentPlan/prompts.ts
- ai-life-assistant/src/lib/ai/agentPlan/postProcess.ts
- ai-life-assistant/src/lib/ai/agentPlan/pipeline.ts
- ai-life-assistant/src/lib/dashboard/generateDashboard.ts
- ai-life-assistant/src/components/DashboardView.tsx
- ai-life-assistant/src/components/HomeClient.tsx

Please evaluate:
1. Product correctness: will this make the dashboard match what the user believes they already told the assistant?
2. Conversation behavior: does it handle follow-up answers naturally without making the user repeat themselves?
3. State-machine correctness: are pending confirmations resolved, answered, dismissed, or preserved safely?
4. Data model fit: can this be implemented with the current state shape, or does it need schema changes?
5. Edge cases: ambiguous "确认", multiple pending confirmations, partial answers, repeated check-ins, stale confirmations, and answers that update more than one item.
6. Implementation risks: false positives, duplicate updates, over-reliance on local regex, AI/local resolver conflicts, and stale dashboard rendering.
7. Test plan: does it cover realistic end-to-end conversations, not just isolated reducers?

Please respond with:
- Verdict: approve / approve with changes / reject.
- Highest-priority issues, ordered by severity.
- Missing edge cases.
- Specific design improvements.
- Specific implementation notes tied to code files when possible.
- A concise implementation checklist.

Important review stance:
- Be strict about user trust and dashboard clarity.
- Prefer fixes that preserve user control and avoid surprising automation.
- If the design would still allow stale or contradictory dashboard state, call that out clearly.
```
