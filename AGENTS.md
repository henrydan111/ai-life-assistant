# Project Guidance

## Product Direction

This app is an AI life assistant: an AI butler and AI secretary for everyday life. Its core value is not completing workflows for their own sake, but making the user feel understood, safe, and practically supported.

## User Experience Comes First

- User experience is the highest product priority.
- Do not push a process forward at the cost of user comfort, clarity, trust, or sense of control.
- A technically correct flow is not enough if it feels cold, confusing, interruptive, or unsafe.
- Prefer calm, legible, low-friction interactions over feature-heavy or operationally rigid designs.
- When a workflow creates pressure, uncertainty, or unnecessary effort for the user, redesign the workflow.

## Assistant Behavior Principles

- The assistant should learn and remember enough about the user to feel personally helpful, while staying transparent and respectful.
- The assistant should reduce cognitive load: summarize, prioritize, remind, prepare, and quietly organize.
- The assistant should create safety: make important information visible, confirm sensitive actions, avoid surprising the user, and preserve user control.
- The assistant should create convenience: make common tasks fast, make next steps obvious, and turn messy natural language into useful structure.
- The assistant should feel like a capable secretary: proactive, discreet, context-aware, and dependable.
- The assistant should feel like a trusted butler: attentive, calm, protective, and never pushy.

## Product Decisions

When making design or implementation tradeoffs:

1. Choose the option that gives the user more clarity and confidence.
2. Choose the option that reduces repeated effort and mental bookkeeping.
3. Choose the option that better reflects the user's habits, preferences, and current context.
4. Avoid automation that makes the user feel watched, rushed, judged, or out of control.
5. Treat privacy, reliability, and graceful fallback behavior as part of the user experience.

## Fix Quality

- Do not patch only the single failing case.
- Do not hard-code isolated user examples, prompts, inputs, dates, names, or one-off outputs into the product logic.
- Fix the underlying rule, abstraction, prompt, data model, parser, state transition, or user experience issue.
- A good fix should generalize to nearby cases and be validated with representative examples, not just the exact reported case.
- If a narrow exception is truly necessary, document why it is a real product rule rather than a shortcut for one case.

## Fallback Behavior

- Fallback plans must preserve intelligence, efficiency, and user experience.
- Do not use low-quality, low-agency, or brute-force scripts merely to push a flow forward.
- A fallback is only acceptable when it is thoughtful, maintainable, and clearly better for the user than stopping.
- If a fallback would feel clumsy, repetitive, opaque, or unsafe, pause and design a better path.
- Prefer graceful degradation, clear explanation, and useful partial results over hidden mechanical workarounds.

## System Upgrade Verification

For system-level changes outside the frontend, the product success rate depends on local code design, prompt quality, and actual AI interaction results. After upgrading backend logic, AI orchestration, prompts, memory, storage, parsing, scheduling, or other non-frontend systems:

- Use the project's full testing framework rather than ad hoc, low-quality scripts.
- Simulate realistic user needs end to end, including messy natural language, ambiguous intent, follow-up context, and failure cases.
- Actually call the configured AI provider for representative scenarios when credentials and network access are available.
- Verify that AI responses are interpreted, stored, displayed, and degraded correctly by the local code.
- Treat prompt regressions, brittle parsing, unsafe automation, or confusing fallback behavior as product failures, not merely test failures.
- If live AI verification cannot be run, clearly document why, keep automated coverage meaningful, and do not claim the upgrade is fully verified.

## GPT Cross Review Requests

When the user asks for GPT cross review, GPT review, GPT audit, or external GPT-based code review:

- Default to preparing a copy-ready prompt for the user to paste into GPT 5.5 Pro.
- Do not assume GPT 5.5 Pro can access local workspace files.
- GPT 5.5 Pro is a cloud model and can only inspect project files and code through GitHub links supplied in the prompt.
- Before preparing the review prompt, make sure the relevant local code has been committed and pushed to GitHub so the cloud reviewer can inspect the exact code under review.
- Do not ask GPT 5.5 Pro to review unpushed local-only changes.
- Include the relevant GitHub URLs, branch, commit, PR, file paths, and review scope when available.
- If the necessary code is only local and not accessible through GitHub, say so clearly and tell the user what needs to be made available before the cross review can be meaningful.
- The prompt should ask GPT 5.5 Pro to prioritize correctness, product risk, UX impact, AI behavior regressions, prompt quality, test gaps, and security/privacy concerns.

## Interface Tone

- Keep the interface calm, direct, and reassuring.
- Use language that feels like helpful personal support, not enterprise task management.
- Avoid overexplaining mechanics in the UI.
- Make the first screen useful immediately; do not hide the assistant behind setup, marketing, or abstract concepts.
