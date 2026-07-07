# Agent Plan V3 Round 2 Review Prompt

请你详细 review 这个 GitHub repo：

https://github.com/henrydan111/ai-life-assistant

请读取 main 分支最新代码，并重点阅读：

- `docs/agent-plan-v3-design.md`
- `docs/agent-plan-v2-architecture.md`
- `src/lib/ai/agentPlan/*`
- `src/lib/ai/interpretation.ts`
- `src/lib/ai/applyInterpretation.ts`
- `src/types/domain.ts`
- `scripts/regression-evals.cjs`
- `scripts/agent-plan-live-evals.cjs`

背景：

这个项目是一个 voice-first AI life assistant / AI secretary。目标不是做普通 todo parser，而是让 AI 帮用户低压力地管理生活事项、日程、提醒、购物、长期记忆、主动 check-in、出行准备、生活习惯和节奏目标。

上一轮你指出：`5ceeb7f Support routine goals in Agent Plan` 把“最近每天半夜 12 点前睡觉”建模成 `RoutineGoal` 是正确方向，但当前架构仍然依赖 prompt + scenario guards + postProcess，长期可能继续变成补丁堆叠。

基于你的 review，我产出了一份落地设计：

`docs/agent-plan-v3-design.md`

请你做 round 2 review。不要泛泛评价，请重点审这份设计是否真的能解决“充分利用 AI 能力，同时有效约束 AI 不稳定性”的核心问题。

请重点回答：

1. 总体方向
- `IntentFrame -> ProductCompiler -> MutationPlan -> PendingClarification` 这条路线是否正确？
- 它是否真的能减少 patch 层继续膨胀？
- 有没有更简单、更符合当前代码规模的方案？

2. Phase 0 立刻修
请审查设计文档里的 Phase 0：

- 禁止 recurring sleep 同时创建 routineGoal 和 sleep task
- bare “每天12点前睡觉” 不应静默解析成 12:00
- “半夜12点” 明确证据应强制修成 00:00
- targetTime 增加 HH:mm validation
- validation failure 不暴露给用户
- postProcess 增加 repair trace

请判断：
- 哪些必须立刻做？
- 哪些可以推迟？
- 哪些设计还不够具体？
- 有无风险会让系统变得更复杂而收益不大？

3. IntentFrame 设计
请 review `docs/agent-plan-v3-design.md` 中的 `IntentFrame`：

- 字段是否足够表达真实生活输入？
- `source.quote` / `actor` / `polarity` / `confidence` / `temporal` / `recurrence` / `missingSlots` / `relations` 是否合理？
- 是否缺少 product consequence、risk、user control、sensitivity、privacy 相关字段？
- semantic intent layer 是否应该由 AI 输出，还是应该让 AI 输出更接近 product action 的中间层？

4. ProductCompiler 设计
请 review ProductCompiler 的策略拆分：

- RoutineGoalPolicy
- LifeEventPolicy
- TaskPolicy
- ShoppingPolicy
- CheckInPolicy
- MemoryPolicy
- ClarificationPolicy

请判断：
- 这些 policy 边界是否清晰？
- 哪些现有 postProcess 逻辑应该迁移到 compiler？
- 哪些应继续保留为 safe repair？
- compiler 输出应先兼容 `AiInterpretation`，还是直接设计 `MutationPlan`？

5. Clarification 设计
请重点审：

- 是否需要独立的 `PendingClarification`，还是继续用 `AssistantCheckIn` 足够？
- 用户回答“先试一周”“从明天开始”“不用提醒了”时，如何绑定到原目标？
- 如何避免把澄清回答误建成新 task？

6. RoutineGoal / Memory 边界
请判断：

- “用户最近希望每天半夜12点前睡觉”到底应该存在于 `RoutineGoal`、`MemoryItem`、`RecurrenceCandidate` 中哪一层？
- 设计文档中“RoutineGoal owns active goal, Memory owns stable preference”的规则是否足够？
- 如何避免 suggested memory 污染 prompt？

7. Validator / Repair / Fallback
请审：

- 哪些错误应该 hard fail？
- 哪些应该 auto-repair？
- 哪些应该降级为 clarification？
- 哪些应该 partial save？
- 设计文档的 error taxonomy 是否足够落地？
- 如何彻底避免用户看到内部 validation error？

8. Eval strategy
请审：

- 文档里的 deterministic regression / live eval / UI eval / schema drift 是否足够？
- 是否应该加入 multi-turn eval、mutation tests、property-based checks、latency budget、prompt/schema contract tests？
- 如何测试“AI 反馈是否真正被产品承接”，而不只是自然语言反馈好听？

9. Migration risk
请指出：

- 这个 V3 设计最可能失败在哪里？
- 哪些迁移步骤可能过大？
- 有没有可以更小步、更低风险地演进到目标架构的方法？
- 哪些文件或模块应该先动，哪些应该暂时不动？

请按以下格式输出：

A. 一句话总评  
B. V3 设计是否真正解决补丁化问题  
C. 你同意的设计决策  
D. 你不同意或需要修改的设计决策  
E. Phase 0 立刻修的优先级排序  
F. IntentFrame / ProductCompiler / PendingClarification 详细 review  
G. RoutineGoal 与 Memory 边界 review  
H. Validator / Repair / Fallback review  
I. Eval strategy review  
J. 推荐的 revised architecture，如果你会改这份设计  
K. 推荐的 implementation roadmap，按：
   - 现在就做
   - 下一版 PoC
   - 产品化前必须做
L. 最担心的 5 个风险和预防方案

请务必具体、严格、可执行。请引用具体文件路径、函数、类型、prompt 规则或 eval 场景。不要只给抽象建议。
