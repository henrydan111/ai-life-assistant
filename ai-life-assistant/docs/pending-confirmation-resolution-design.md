# Pending Confirmation Resolution Design

## 背景

当前产品已经能从自然语言里生成 `tasks`、`shoppingItems`、`routineGoals`、`lifeEvents` 和 `checkIns`。但当用户后续回答系统提出的待确认问题时，系统经常把回答当作新的普通输入处理，而不是回填到原来的实体。

典型失败链路：

1. 用户说：“我最近都希望每天能12点前睡觉，然后家里加点牛奶快没了，提醒我要买牛奶，然后我这周末计划要去上海。”
2. 系统创建：
   - `routineGoal`: 每天12点前睡觉
   - `shoppingItem` + 今日任务：买牛奶
   - 上海出行相关 `checkIn`
   - 睡觉目标相关 `checkIn`
3. 用户问：“需要补充什么信息？”
4. 用户补充：“周日下午2点去上海。每天12点前睡是短期目标。”
5. 系统反馈说“已更新”，但 dashboard 仍显示旧的待确认项。

结果是 dashboard 同时展示“已更新的实体”和“仍待确认的旧问题”，产生自相矛盾。

## 目标

- 用户回答待确认项时，优先消解已有 `checkIns`，而不是创建重复实体。
- 一个用户输入可以同时回答多个 pending confirmations。
- 状态更新后，相关 `checkIns` 必须变成 `answered` 或 `dismissed`。
- dashboard 不再展示已经被回答的信息。
- 助手反馈必须准确反映“已更新哪些项、仍需确认哪些项”。

## 非目标

- 不把所有普通输入都强行解释成确认回答。
- 不自动确认高影响或仍不明确的信息。
- 不把 dashboard 层做成隐藏问题的补丁；状态层必须先保持一致。
- 不依赖完整历史聊天重放。

## 当前问题

### 1. 缺少确认回答优先级

`submitInput` 当前直接进入普通 interpret pipeline：

```txt
rawText -> interpret-stream -> applyInterpretation -> setState
```

它没有先检查 `state.checkIns` 里是否存在用户正在回答的问题。

### 2. action schema 缺少更新动作

当前可用动作偏向新增：

- `add_task`
- `add_shopping_item`
- `add_life_event`
- `add_routine_goal`
- `add_check_in`
- `mark_task_done`
- `update_shopping_status`

缺少：

- `update_life_event`
- `update_routine_goal`
- `update_task`
- `answer_check_in`
- `dismiss_check_in`

所以 AI 即使理解了“周日下午2点去上海”，也很难精确表达“更新已有上海 event 并关闭对应 checkIn”。

### 3. `checkIns` 语义太弱

当前 `AssistantCheckIn` 只有：

```ts
title
question
relatedType
relatedId
askAt
status
```

它没有表达自己到底在询问什么字段，例如：

- `life_event.startsAt`
- `routine_goal.scope`
- `routine_goal.targetTime`
- `shopping_item.expectedAt`

因此 resolver 只能靠文本匹配 title/question，容易重复或漏判。

### 4. Dashboard 只是忠实展示状态

Dashboard 的行为基本正确：它展示 pending `checkIns` 和已保存实体。问题在于状态没有闭环，导致 dashboard 忠实地展示了矛盾状态。

## 方案总览

在 `submitInput` 进入普通 AI interpret 前新增一层：

```txt
rawText
  -> pendingConfirmationResolver(state, rawText)
      -> resolved: update state + feedback
      -> question: answer "需要补充什么信息？"
      -> no_match: fall through to normal interpret
  -> interpret-stream
  -> applyInterpretation
  -> normalizeAssistantState
```

Resolver 是本地优先、可测试、确定性的。AI 仍负责复杂理解，但“用户明显在回答已有问题”的场景先由本地 resolver 消解。

## 新增模块

```txt
src/lib/confirmation/resolvePendingConfirmations.ts
```

建议导出：

```ts
type ConfirmationResolution =
  | {
      kind: "resolved";
      state: AssistantState;
      feedback: ParseFeedback;
    }
  | {
      kind: "question";
      feedback: ParseFeedback;
    }
  | {
      kind: "no_match";
    };

export function resolvePendingConfirmations(
  state: AssistantState,
  rawText: string,
  inputType: "text" | "voice"
): ConfirmationResolution;
```

## 处理顺序

### 1. 用户询问“需要补充什么信息？”

匹配：

- `需要补充什么`
- `还差什么`
- `要确认什么`
- `你需要我补充什么`

行为：

- 不更新状态。
- 汇总 pending `checkIns`，按相关实体分组。
- 返回反馈，例如：

```txt
当前还需要确认：
1. 上海出行：具体出行开始时间。
2. 睡觉目标：12点指中午还是午夜，以及这个目标持续多久。
```

### 2. 用户提供明确字段答案

输入示例：

```txt
周日下午2点去上海。每天12点前睡是短期目标。
```

Resolver 应该：

- 找到待确认的上海出行 `checkIn`。
- 更新对应 `lifeEvent.startsAt`。
- 如果 rawText 包含地点，则更新 `location`。
- 将相关上海出行时间 `checkIn` 标记为 `answered`。
- 找到睡觉目标范围相关 `checkIn`。
- 更新 `routineGoal.scope = "recent"`，`scopeLabel = "短期"` 或 `"最近"`。
- 将范围相关 `checkIn` 标记为 `answered`。
- 如果仍有“12点到底是中午还是午夜”的 pending checkIn，则保留，不要说完全完成。

### 3. 用户笼统说“确认”

行为必须谨慎。

如果只有一个 pending confirmation 且问题是 yes/no，可以回答该 checkIn。

如果有多个 pending confirmations：

- 不要批量确认。
- 返回：

```txt
我看到还有多个待确认项。请说明你要确认哪一个，或直接补充时间/范围。
```

### 4. 用户回答否定或取消

匹配：

- `不用`
- `取消`
- `不要了`
- `不是`
- `先不`

行为：

- 对强匹配的 checkIn 标记 `dismissed`。
- 不删除相关实体，除非用户明确说取消主事项。

## 字段解析规则

### Life event time

适用 checkIn：

- relatedType = `life_event`
- question/title 包含：
  - 出行时间
  - 什么时候
  - 周末
  - 上海

可识别：

- `周日下午2点`
- `周日14:00`
- `这个周日两点`

更新：

```ts
lifeEvent.startsAt = parsedIso
lifeEvent.location = "上海" // 如果文本包含上海
checkIn.status = "answered"
```

注意：

- 当前日期为 2026-07-07 周二时，“周日”应解析为 2026-07-12。
- 如果只有“周日下午”没有具体时间，可以使用自然默认值 17:00，或继续追问；产品策略要统一。

### Routine goal scope

适用 checkIn：

- relatedType = `routine_goal`
- question/title 包含：
  - 目标
  - 范围
  - 最近
  - 长期
  - 短期

可识别：

- `短期目标`
- `最近执行`
- `先最近一段时间`
- `长期坚持`

更新：

```ts
routineGoal.scope = "recent" | "ongoing"
routineGoal.scopeLabel = "短期" | "最近" | "长期"
checkIn.status = "answered"
```

### Routine goal target time

适用 checkIn：

- relatedType = `routine_goal`
- question/title 包含：
  - 12点
  - 中午
  - 午夜
  - 晚上
  - 睡眠目标时间

规则：

- `晚上12点` / `午夜12点` / `24点` / `零点` -> `targetTime = "00:00"`，`targetTimeRelation = "before"`
- `中午12点` -> 不应默认为睡觉时间；需要再次确认，或保留 pending。
- 用户只说“每天12点前睡是短期目标”只解决 scope，不解决 12点语义。

## 状态清理规则

每次 resolver 或 `applyInterpretation` 更新实体后，运行：

```txt
cleanupResolvedCheckIns(state)
```

职责：

- 如果 `lifeEvent.startsAt` 已存在，关闭询问该 event 出行开始时间的 checkIn。
- 如果 `routineGoal.scope` 已不是 `unspecified`，关闭询问范围/短期/长期的 checkIn。
- 如果 `routineGoal.targetTime` 已存在，关闭询问睡眠目标时间的 checkIn。
- 合并重复 checkIns：同一 relatedType + relatedId + 同类问题只保留一个 pending。

这一步是防御性修复，避免 AI 输出重复 checkIn。

## Feedback 原则

反馈必须和 state 一致：

### 好的反馈

```txt
已更新上海出行时间为周日下午2点，并把睡觉目标标记为短期目标。
还需要确认：12点前睡觉中的“12点”是午夜还是中午。
```

### 不好的反馈

```txt
已更新安排。
```

如果仍有 pending confirmations，不能说“全部完成”。

## Dashboard 期望结果

对于用户输入：

```txt
周日下午2点去上海。每天12点前睡是短期目标。
```

Dashboard 应该显示：

- 后续安排：
  - 本周末去上海，Jul 12 2:00 PM，上海
- 节奏目标：
  - 每天12点前睡觉，短期/最近，每天
  - 仍可挂一个确认：确认 12点 指午夜还是中午
- 需要你确认：
  - 不再显示“请问具体出行开始时间”
  - 不再显示“这个目标属于短期吗”
  - 只显示真正未解决的确认项

## 实施计划

### Phase 1: 本地 resolver

- 新增 `resolvePendingConfirmations.ts`
- 在 `submitInput` 开头调用。
- 覆盖：
  - 查询待补充信息
  - 上海出行时间
  - routine goal scope
  - 通用“确认”多项保护

### Phase 2: 清理重复 confirmations

- 新增 `cleanupResolvedCheckIns(state)`
- 在 `normalizeAssistantState` 或 `setState(normalizeAssistantState(...))` 前后调用。
- 去掉已被实体字段满足的 pending checkIns。

### Phase 3: Action schema 扩展

新增 action：

```ts
update_life_event
update_routine_goal
answer_check_in
dismiss_check_in
```

让 AI 也能表达确认闭环，而不是只能新增。

### Phase 4: 测试

新增单元测试覆盖：

- “需要补充什么信息？”只返回待确认列表，不改状态。
- “周日下午2点去上海”更新 event 并关闭出行时间 checkIn。
- “每天12点前睡是短期目标”更新 scope，但保留 12点语义确认。
- “确认”在多个 pending checkIns 下不批量确认。
- 重复 checkIns 被清理。

## 风险与缓解

- 风险：本地规则过窄，漏掉自然表达。
  - 缓解：先覆盖高频中文表达，复杂场景 fallback 到 AI interpret。
- 风险：错误关闭 checkIn。
  - 缓解：只在实体字段已明确写入时关闭；不确定时保留 pending。
- 风险：AI 和本地 resolver 双重更新。
  - 缓解：resolver 命中 `resolved` 时直接返回，不再进入普通 interpret。
- 风险：用户只是闲聊但被误判为确认。
  - 缓解：要求同时命中 pending checkIn 语义和可解析字段。

