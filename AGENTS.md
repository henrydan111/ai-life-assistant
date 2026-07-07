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

## Fallback Behavior

- Fallback plans must preserve intelligence, efficiency, and user experience.
- Do not use low-quality, low-agency, or brute-force scripts merely to push a flow forward.
- A fallback is only acceptable when it is thoughtful, maintainable, and clearly better for the user than stopping.
- If a fallback would feel clumsy, repetitive, opaque, or unsafe, pause and design a better path.
- Prefer graceful degradation, clear explanation, and useful partial results over hidden mechanical workarounds.

## Interface Tone

- Keep the interface calm, direct, and reassuring.
- Use language that feels like helpful personal support, not enterprise task management.
- Avoid overexplaining mechanics in the UI.
- Make the first screen useful immediately; do not hide the assistant behind setup, marketing, or abstract concepts.
