# Agent Plan V3 Phase 0 Implementation Review Prompt

请你 review 这个 GitHub repo：

https://github.com/henrydan111/ai-life-assistant

请重点阅读：

- `docs/agent-plan-v3-round2-decisions.md`
- `docs/agent-plan-v3-design.md`
- `src/lib/ai/agentPlan/postProcess.ts`
- `src/lib/ai/agentPlan/scenarioCoverageGuards.ts`
- `src/lib/ai/interpretation.ts`
- `src/lib/parser/parseLocalInput.ts`
- `src/app/api/ai/interpret/route.ts`
- `src/app/api/ai/interpret-stream/route.ts`
- `scripts/regression-evals.cjs`
- `scripts/agent-plan-live-evals.cjs`

目标：

请审查 V3 Phase 0 是否足够具体，可以开始实施。Phase 0 的目标不是重构全系统，而是让当前 action-first pipeline 更安全，避免用户看到内部 validation error，并修复 routine sleep 的几个 P0 风险。

Phase 0 计划：

1. Safe planning failure wrapper
- Agent Plan validation/provider/timeout 失败时，用户不能看到 raw validation error。
- API 应返回平静、可执行的 feedback。
- unsafe plan 不落库；safe partial plan 可以落库。

2. Shared temporal policy for routine sleep
- 新增共享 helper，替代 `postProcess.ts` 和 `parseLocalInput.ts` 中重复的 sleepTargetTime。
- “半夜12点/午夜12点/零点/0点/24点” -> `00:00`。
- bare “每天12点前睡觉” 不得静默变成 `12:00`，应生成 clarification。

3. No duplicate recurring sleep task
- recurring sleep goal 输入不能同时产生 `RoutineGoal` 和同语义 `Task`。

4. Explicit midnight repair
- 如果 raw text 明确是“半夜12点”，而模型输出 `targetTime: "12:00"`，必须修成 `00:00`。

5. HH:mm validation
- `add_routine_goal.targetTime` 只能是 `00:00` 到 `23:59`。

6. Minimal trace
- postProcess/repair 至少记录 rule、before、after、reason。
- trace 不暴露给用户，但进入 eval report。

7. Feedback-state consistency regression
- feedback 中声称保存/提醒/追问的内容，必须能在 state 或 checkIn/clarification 中找到。

请按以下格式输出：

A. Phase 0 总体可行性  
B. 每项改动的推荐实现方式  
C. 哪些文件应该修改，哪些不该动  
D. 可能引入的回归风险  
E. 必须新增的 regression eval  
F. 必须新增的 live eval  
G. 是否需要先改文档再写代码  
H. 推荐的实施顺序  
I. 你会如何判断 Phase 0 完成  

请务必具体、严格、可执行。不要建议大重构，不要提前引入完整 MutationPlan。
