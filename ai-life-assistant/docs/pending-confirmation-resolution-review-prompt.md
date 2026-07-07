# GPT Review Prompt: Pending Confirmation Resolution Design

Use this prompt to ask GPT to review the design doc.

```txt
You are reviewing a design for an AI life assistant app.

Context:
- The app stores local state with tasks, shopping items, routine goals, life events, check-ins, memories, and recent inputs.
- The assistant can parse natural language into structured actions.
- Current problem: when the assistant asks for missing information via pending check-ins, the user's later answer is often treated as a new generic input instead of being applied to the existing check-in and parent entity.
- This creates contradictory dashboard states: a life event may already have a time, but the dashboard still shows a pending confirmation asking for that time.

Please review the following design doc for:
1. Product correctness: does it produce a dashboard that matches user expectations?
2. State-machine correctness: are pending confirmations resolved, answered, dismissed, or preserved safely?
3. Data model fit: can this be implemented with the current state shape, or does it require schema changes?
4. Edge cases: ambiguous "确认", multiple pending confirmations, repeated check-ins, partial answers, and stale confirmations.
5. Implementation risks: false positives, duplicate updates, over-reliance on local regex, and AI/local resolver conflicts.
6. Test plan completeness.

Please give:
- A short verdict: approve / approve with changes / reject.
- Highest-priority design issues.
- Missing edge cases.
- Suggested improvements.
- A concise implementation checklist.

Here is the design doc:

<<<PASTE docs/pending-confirmation-resolution-design.md HERE>>>
```

