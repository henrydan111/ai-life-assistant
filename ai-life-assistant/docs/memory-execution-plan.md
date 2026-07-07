# 长期记忆与主动秘书能力执行计划

## 目标

把产品从“语音待办记录器”升级为“有长期记忆、会追问、会主动检查风险的 AI 秘书”。

产品定位从：

```txt
我说一句，它帮我记一条。
```

升级为：

```txt
我说生活里的事，它帮我维护生活系统，并在合适的时候提醒我下一步。
```

这意味着产品不只响应用户输入，还要维护用户的生活上下文：购物、出行、家庭安排、天气风险、未确认事项和重复模式。

长期记忆必须满足三点：

- 保存在本地，默认不上传完整历史。
- 每次 AI 调用前只选择少量相关记忆进入 prompt。
- 有配套的梳理、清理、整合和用户确认机制，避免记忆无限膨胀。

## 非目标

- 不做云端账号级同步。
- 不把完整聊天历史当长期记忆。
- 不让 AI 每次从全部记忆里选择上下文。
- 不让 AI 直接永久写入敏感或高影响记忆，必须经过产品层确认或降级为 suggested。

## 核心原则

1. 记忆要少而准  
   只保存未来能指导行动的事实、偏好、模式和未闭环事项。

2. 本地脚本负责召回  
   `selectRelevantMemories(rawText, state)` 在本地完成，快、稳定、可调试。

3. AI 负责理解和建议  
   AI 可以输出 `memoryWrites`，但产品层决定是直接保存、合并、降级还是询问用户。

4. 用户拥有最终控制权  
   记忆支持确认、编辑、删除、拒绝和归档。

5. 记忆进入 prompt 前必须压缩  
   每次最多 8 条，总长度控制在约 600 个中文字符内。

6. 外部信号只触发检查，不直接制造结论  
   天气、日期、临近事件等外部信号用于触发主动检查。系统可以提醒和询问，但不要擅自修改用户计划。

7. 主动性必须可解释  
   用户应该能看见 AI 为什么提醒、为什么记住、为什么询问确认。

## 用户场景覆盖

### 1. 牛奶 recurring

用户第一次说：“我需要买牛奶。”

系统行为：

- 新增购物项：牛奶。
- 新增今日待办：买牛奶。
- 晚上主动询问：牛奶买好了吗？
- 写入低置信度记忆候选：用户可能有周期性购买牛奶的模式。

用户晚上说：“已经下单了牛奶，明早送到。”

系统行为：

- 更新购物项状态为 `ordered`。
- 记录预计送达时间。
- 更新牛奶相关 pattern evidence。

第二周用户再次说：“我需要买牛奶。”

系统行为：

- 本地记忆召回牛奶 pattern。
- AI 识别重复模式。
- 生成主动确认：
  “我发现你连续两周都需要买牛奶，要不要把‘买牛奶’设成每周提醒？”

### 2. 苏州出行

用户说：“这周五需要去苏州。”

系统行为：

- 新增出行日程：去苏州。
- 周四晚上主动询问：票买好了吗？行李收拾好了吗？
- 如果长期记忆里有“用户短途出行常用高铁”，则作为候选背景提供给 AI，但 AI 不应断言本次一定坐高铁。

### 3. 孩子兴趣班

用户说：“我家里有好几个孩子，分别在周三、周五晚上要去兴趣班。”

系统行为：

- 写入家庭画像：用户家里有多个孩子。
- 生成追问：分别几点开始？持续多久？需要提前多久出门？是哪位孩子？
- 用户补充后生成对应日程、出门提醒和接送待办。
- 如果每周重复，询问是否设为 recurring schedule。

### 4. 天气风险

用户明日有出门安排，天气预报有雨。

系统行为：

- 晚上主动提醒：明天有雨，出门记得带伞。

用户周末计划出游，周二发现周末可能下雨。

系统行为：

- 主动询问：周末可能下雨，要不要调整行程或准备室内备选方案？

## 数据结构

在 `AssistantState` 中新增：

```ts
export type MemoryItem = {
  id: string;
  type:
    | "household"
    | "preference"
    | "recurring_pattern"
    | "travel_habit"
    | "weather_preference"
    | "assistant_behavior"
    | "open_loop";
  summary: string;
  tags: string[];
  entities: string[];
  confidence: number;
  status: "active" | "suggested" | "rejected" | "archived";
  sensitivity: "low" | "medium" | "high";
  evidence: Array<{
    text: string;
    inputId?: string;
    createdAt: string;
  }>;
  lastUsedAt?: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryWrite = {
  type: MemoryItem["type"];
  summary: string;
  tags?: string[];
  entities?: string[];
  confidence: number;
  sensitivity?: MemoryItem["sensitivity"];
  requiresConfirmation?: boolean;
  evidence: string;
};

export type MemoryContext = {
  stableFacts: string[];
  activePatterns: string[];
  openLoops: string[];
  assistantPreferences: string[];
};
```

状态新增字段：

```ts
memoryItems: MemoryItem[];
```

## 本地记忆召回

新增模块：

```txt
src/lib/memory/selectRelevantMemories.ts
```

职责：

- 输入：`rawText`, `AssistantState`
- 输出：压缩后的 `MemoryContext`
- 不调用 AI
- 不读取完整聊天历史

选择规则：

```ts
const LIMITS = {
  maxItems: 8,
  maxCharsPerItem: 80,
  maxTotalChars: 600
};
```

记忆过滤：

- 只考虑 `status === "active"` 或 `status === "suggested"`。
- 排除 `rejected` 和 `archived`。
- 高敏感记忆默认不进入 prompt，除非当前输入强相关。

打分因素：

- 输入关键词命中 `tags`。
- 输入实体命中 `entities`。
- 类型与当前意图匹配。
- `confidence` 更高加分。
- `updatedAt` 更新更近加分。
- `suggested` 记忆如果与当前输入强相关，加分，用于触发确认。
- 最近反复使用但 AI 未采纳的记忆降权。

示例：

用户输入：

```txt
周五去苏州
```

可能召回：

```json
{
  "stableFacts": [],
  "activePatterns": [
    "用户出行前通常需要票务和行李提醒。",
    "用户常用高铁完成短途出行。"
  ],
  "openLoops": [],
  "assistantPreferences": [
    "重要长期提醒和 recurring 设置需要先询问用户确认。"
  ]
}
```

注意：本地召回只是候选，不代表最终判断。本地可以多召回一条“高铁”记忆，AI 最终决定是否使用。

## AI 输入结构

`interpretWithAgentPlan` 的 user content 改为：

```json
{
  "now": "2026-07-07T...",
  "rawText": "我周四和周五想请假，记得提醒我提前和老板说",
  "inputType": "voice",
  "memoryContext": {
    "stableFacts": [],
    "activePatterns": [],
    "openLoops": [],
    "assistantPreferences": [
      "重要长期提醒和 recurring 设置需要先询问用户确认。"
    ]
  },
  "state": {
    "preferences": {},
    "tasks": [],
    "shoppingItems": [],
    "lifeEvents": [],
    "checkIns": [],
    "recentInputs": []
  }
}
```

System prompt 增补：

```text
你会收到 memoryContext，它是经过本地压缩和筛选的长期记忆。
这些记忆是候选背景，不一定全部适用于当前输入。
只有当记忆与当前输入相关时才使用。
不要逐字复述记忆。
不要因为记忆存在就过度推断。
如果发现新的长期事实、偏好或重复模式，请输出 memoryWrites。
长期 recurring、自动提醒偏好、家庭习惯和出行习惯需要用户确认后再正式启用。
```

AI 输出结构扩展：

```json
{
  "feedback": {
    "title": "短标题",
    "detail": "简短反馈",
    "question": "可选追问"
  },
  "actions": [],
  "memoryWrites": [
    {
      "type": "recurring_pattern",
      "summary": "用户可能每周需要购买牛奶。",
      "tags": ["购物", "牛奶", "recurring"],
      "entities": ["牛奶"],
      "confidence": 0.72,
      "requiresConfirmation": true,
      "evidence": "用户再次提到需要买牛奶。"
    }
  ]
}
```

## 记忆写入策略

新增模块：

```txt
src/lib/memory/applyMemoryWrites.ts
```

职责：

- 接收 AI 输出的 `memoryWrites`。
- 与已有 `memoryItems` 做相似合并。
- 判断状态：`active` / `suggested`。
- 生成需要用户确认的 check-in。

保存规则：

- `confidence >= 0.85` 且 `requiresConfirmation !== true` 且 `sensitivity === "low"`：可直接保存为 `active`。
- `confidence < 0.85`：保存为 `suggested`。
- recurring、自动提醒偏好、家庭习惯、出行习惯：默认 `suggested`，需要用户确认。
- 与现有 active 记忆高度相似：合并 evidence、提升 confidence、更新 tags/entities，不新增。
- 与 rejected 记忆相似：不保存，除非用户明确重新启用。

## 记忆梳理/清理/整合

长期记忆必须有维护机制。建议实现三个层级。

### 1. 实时轻量清理

每次写入 memory 后执行：

```txt
normalizeMemoryItems(state)
```

处理：

- 去掉空 tags/entities。
- summary 截断到 80 个中文字符左右。
- evidence 最多保留最近 5 条。
- 同类型、同实体、相似 summary 的记忆合并。
- `confidence` 限制在 0 到 1。

### 2. 周期性本地整理

每天首次打开 app 或每 24 小时执行：

```txt
compactMemoryItems(state)
```

处理：

- `suggested` 超过 30 天未确认：归档。
- `active` 超过 90 天未使用且 confidence 低于 0.5：降级为 archived。
- 重复 recurring pattern 合并。
- 被用户拒绝的相似候选自动过滤。
- open loop 已完成后归档。

### 3. AI 辅助整合

当本地 active/suggested 记忆超过阈值，例如 40 条时，才触发 AI 整合。

输入给 AI 的不是全部历史，而是本地压缩后的候选列表：

```json
{
  "memoryItems": [
    {
      "id": "mem_1",
      "type": "travel_habit",
      "summary": "用户出行前需要票务和行李提醒。",
      "tags": ["出行", "票务", "行李"],
      "confidence": 0.82
    }
  ]
}
```

AI 只能输出计划，不直接执行：

```json
{
  "merge": [
    {
      "sourceIds": ["mem_1", "mem_7"],
      "summary": "用户出行前希望收到票务和行李确认提醒。"
    }
  ],
  "archive": ["mem_12"],
  "keep": ["mem_3"]
}
```

产品层应用前仍需做校验。

## 用户可见的记忆管理

产品界面必须体现记忆，否则用户会觉得 AI 在偷偷记录。记忆 UI 的目标不是展示数据库，而是建立信任：AI 记住了什么、为什么有用、用户如何控制。

### Dashboard 轻量区域

Dashboard 增加两个轻量区域。

第一个区域：

```txt
需要你确认
```

示例：

```txt
- 要不要把“买牛奶”设为每周提醒？
- 兴趣班每次持续多久？
- 周末可能下雨，要不要调整行程？
```

设计要求：

- 只展示需要用户做决定的问题。
- 每条确认项都要能一键回答，避免把 dashboard 变成设置页。
- 确认项应该来自 `checkIns`、`suggested memoryItems` 和外部信号检查。
- 不超过 3 条，更多内容放到 Settings 或历史。

第二个区域：

```txt
AI 记住了
```

示例：

```txt
- 你家里有多个孩子
- 你经常需要购买牛奶
- 出行前你需要票务和行李提醒
```

每条记忆旁边应支持：

- 确认
- 修改
- 删除 / 不要记住

设计要求：

- Dashboard 只展示最有解释价值的 2-4 条。
- 不展示敏感或低置信度记忆的细节，除非用户正在处理确认。
- 文案要像“AI 记住了”，不要像“用户画像字段”。
- 每条记忆都要能进入 Settings 里查看证据和管理。

### Settings 记忆管理

Settings 中新增完整区域：

```txt
AI 记住了
```

分组展示：

- 家庭与生活
- 购物与重复事项
- 出行习惯
- 天气与主动提醒
- 待确认

每条记忆支持：

- 确认
- 编辑
- 删除
- 不要再记

每条记忆展示：

```txt
summary
confidence / status
最近证据
最近使用时间
```

Settings 是完整控制面板；Dashboard 是轻量解释和确认入口。

## 主动秘书检查

新增模块：

```txt
src/lib/assistant/proactiveCheck.ts
```

触发时机：

- 用户打开 app。
- 每天早上。
- 每天晚上。
- 新增行程后。
- 天气数据更新后。

第一版只做本地规则触发：

- 出行前一天晚上：询问票和行李。
- 购物项当天晚上未完成：询问是否购买。
- 兴趣班缺少持续时间：追问信息。
- 明天有出门且天气有雨：提醒带伞。
- repeated shopping pattern 达到 2 次：询问 recurring。

第二版可引入 AI 判断：

- 输入本地筛出的 open loops、明日安排、天气摘要。
- AI 输出少量 check-ins。

## 外部信号监控

天气只是第一类外部信号。产品应设计成通用的 external signal monitor，而不是只写死“天气提醒”。

### 信号类型

第一版支持：

- 天气：雨、雪、暴雨、高温、降温、大风。
- 时间：早上、晚上、出行前一天、事件开始前。
- 地点/出行：明天是否有出门安排，周末是否有出游计划。
- 未闭环事项：票是否购买、行李是否收拾、购物是否完成、兴趣班信息是否完整。

第二版可扩展：

- 交通延误。
- 快递状态。
- 日历冲突。
- 空气质量。
- 节假日和调休。

### 信号处理原则

- 信号不直接改任务，只生成提醒、check-in 或建议。
- 只有中高风险信号才主动打扰用户。
- 信号必须结合用户计划和记忆，否则不提醒。
- 用户可以关闭某类信号提醒。
- 如果用户反复忽略某类提醒，系统应降低频率。

### 监控流程

```txt
external signals
  -> normalizeSignal()
  -> matchUpcomingPlans(state)
  -> selectRelevantMemories(signal summary, state)
  -> proactiveCheck()
  -> create check-ins / reminders
  -> dashboard "需要你确认"
```

示例：

```txt
天气信号：周六杭州中雨
用户计划：周末去杭州玩
相关记忆：用户希望出游前收到天气风险提醒
结果：周二询问是否调整行程或准备室内备选方案
```

### 天气集成

第一版接口设计：

```ts
type WeatherSnapshot = {
  location: string;
  date: string;
  condition: "rain" | "snow" | "storm" | "heat" | "cold" | "clear" | "unknown";
  summary: string;
  riskLevel: "low" | "medium" | "high";
};
```

天气只进入主动检查，不直接长期保存。

可保存的长期记忆是用户偏好，例如：

- 用户希望出门前收到天气风险提醒。
- 用户不希望收到小雨提醒，只提醒中高风险天气。

### 天气 + 出门体验

明天出门且有雨：

```txt
明天你有出门安排，天气预报有雨，记得带伞。
```

周末出游且提前发现天气风险：

```txt
周末可能下雨。你要不要调整出游安排，或者准备一个室内备选方案？
```

如果用户回答“以后这种天气都提醒我”，写入 suggested/active 记忆：

```txt
用户希望出门前收到天气风险提醒。
```

如果用户回答“小雨不用提醒”，写入：

```txt
用户不希望收到小雨提醒，只提醒中高风险天气。
```

## 实施里程碑

### Phase 1: 记忆数据结构与本地召回

范围：

- 新增 `MemoryItem`、`MemoryWrite`、`MemoryContext` 类型。
- `AssistantState` 增加 `memoryItems`。
- 默认 state 和本地迁移兼容旧数据。
- 实现 `selectRelevantMemories(rawText, state)`。
- 将 `memoryContext` 注入 `interpretWithAgentPlan`。

验收：

- 用户说“买牛奶”时，能召回牛奶相关 suggested/active 记忆。
- 用户说“周五去苏州”时，能召回出行相关记忆。
- prompt 中长期记忆不超过限制。

### Phase 2: AI 记忆写入候选

范围：

- 扩展 `AiInterpretation`，支持 `memoryWrites`。
- prompt 要求 AI 输出候选长期记忆。
- 实现 `applyMemoryWrites`。
- recurring、自动提醒、出行习惯默认进入 `suggested`。

验收：

- 第一次买牛奶生成低置信度候选。
- 第二次买牛奶提升候选并触发确认。
- “家里有好几个孩子”生成 household 记忆候选。

### Phase 3: 记忆确认与管理 UI

范围：

- Dashboard 增加“需要你确认”和轻量“AI 记住了”。
- Settings 增加完整“AI 记住了”管理区域。
- 支持确认、编辑、删除、拒绝记忆。
- 用户拒绝后，相似记忆不再反复出现。

验收：

- 用户可以确认“买牛奶每周提醒”。
- 用户可以删除“常用高铁”记忆。
- 删除后 prompt 不再注入该记忆。
- Dashboard 能解释 AI 为什么主动询问或提醒。
- Dashboard 最多展示 3 条确认项和 4 条轻量记忆。

### Phase 4: 主动秘书检查

范围：

- 实现 `proactiveCheck`。
- 出行前票务/行李检查。
- 购物晚间确认。
- 兴趣班信息追问。
- repeated pattern recurring 询问。

验收：

- 周五去苏州，周四晚上出现确认票和行李的 check-in。
- 牛奶购物未完成，晚上出现确认。
- 第二次买牛奶后出现 recurring 建议。

### Phase 5: 天气风险

范围：

- 建立 external signal monitor 的基础接口。
- 接入天气摘要作为第一类外部信号。
- 明日出门 + 雨天提醒。
- 周末出游 + 天气风险询问是否调整。
- 支持用户关闭或调整天气提醒偏好。

验收：

- 明天有出门安排且有雨，晚上提醒带伞。
- 周末出游遇到中高风险天气，提前询问是否调整。
- 用户选择“小雨不用提醒”后，低风险小雨不再打扰。
- 天气信号不会直接修改用户行程，只会提醒或询问。

### Phase 6: 记忆清理/整合

范围：

- 实现 `normalizeMemoryItems`。
- 实现 `compactMemoryItems`。
- 超阈值时支持 AI-assisted consolidation plan。

验收：

- 重复牛奶记忆不会无限增长。
- 过期 suggested 自动归档。
- evidence 保持精简。
- prompt 记忆包长期保持短小。

## 文件变更清单

预计新增：

```txt
src/lib/memory/selectRelevantMemories.ts
src/lib/memory/applyMemoryWrites.ts
src/lib/memory/compactMemoryItems.ts
src/lib/assistant/proactiveCheck.ts
src/lib/signals/externalSignals.ts
src/lib/signals/weatherSignals.ts
```

预计修改：

```txt
src/types/domain.ts
src/lib/store/localStore.ts
src/lib/ai/interpretation.ts
src/lib/ai/agentPlan.ts
src/lib/ai/applyInterpretation.ts
src/components/DashboardView.tsx
src/components/SettingsPageClient.tsx
src/components/HomeClient.tsx
```

## 测试计划

单元测试建议：

- `selectRelevantMemories`
  - 牛奶输入召回购物/recurring 记忆。
  - 苏州输入召回出行记忆。
  - 兴趣班输入召回 household 记忆。
  - rejected 记忆不会进入 prompt。
  - 输出限制不超过 8 条和总长度。

- `applyMemoryWrites`
  - 相似记忆合并。
  - recurring 默认 suggested。
  - low sensitivity high confidence 可 active。
  - rejected 相似记忆不重复写入。

- `compactMemoryItems`
  - 过期 suggested 归档。
  - evidence 截断。
  - duplicate 合并。

端到端验收：

- 用户连续两周买牛奶，系统询问 recurring。
- 用户周五去苏州，系统安排前一晚出行检查。
- 用户提到多个孩子兴趣班，系统追问持续时间。
- 用户明天出门且天气有雨，系统提醒带伞。

## 风险与保护

- 记忆误判  
  通过 `suggested` 状态和用户确认降低风险。

- Prompt 变长  
  通过 `selectRelevantMemories` 限制数量和字符数。

- 用户不信任  
  UI 必须展示“AI 记住了什么”、为什么提醒，并允许确认、修改、删除。

- 过度主动  
  recurring、天气、家庭习惯、自动提醒偏好默认需要确认。

- 外部信号噪音  
  只对和用户计划相关的中高风险信号提醒；重复忽略后降频。

- 隐私  
  记忆保存在本地，AI 只收到经过筛选和压缩的 memoryContext。

## 第一版推荐落地顺序

1. 数据结构和本地迁移。
2. 本地记忆召回。
3. Prompt 注入 `memoryContext`。
4. AI 输出 `memoryWrites`。
5. 记忆写入与合并。
6. Dashboard 展示待确认记忆。
7. Settings 管理记忆。
8. 主动 check-in。
9. External signal monitor 与天气风险。
10. 周期性清理与 AI-assisted consolidation。

## Self Review

### 覆盖完整性

- 已覆盖长期记忆的保存、召回、写入、确认、清理和整合。
- 已覆盖 Dashboard 轻量展示和 Settings 完整管理。
- 已覆盖天气作为第一类外部信号，并抽象为 external signal monitor。
- 已覆盖用户给出的四个核心场景：牛奶 recurring、苏州出行、孩子兴趣班、天气出门风险。

### 一致性检查

- 记忆仍然保存在本地，没有引入云端记忆。
- AI 不直接从全部记忆里选择上下文，仍由本地 `selectRelevantMemories` 粗筛。
- 天气信号不会直接修改计划，只生成提醒或确认问题。
- Dashboard 保持轻量，不承担完整记忆管理。

### 需要后续细化

- external signal monitor 需要定义具体存储结构，例如 `ExternalSignal` 和 `SignalCheckResult`。
- Dashboard 的视觉布局需要单独设计，避免“需要你确认”和“AI 记住了”压缩今日事项空间。
- 天气 API provider、城市定位和隐私授权需要在实现阶段选择。
- 主动提醒的触发机制目前适合“打开 app 时检查”，真正的后台推送需要后续平台能力。

### 风险判断

- 最大产品风险是过度主动。解决方式是确认优先、低风险降频、Dashboard 可解释。
- 最大工程风险是状态结构变复杂。解决方式是 Phase 1 先做记忆数据和召回，不同时上天气和 UI。
- 最大体验风险是用户不知道 AI 为什么记住。解决方式是 Dashboard 和 Settings 都提供清晰的记忆解释与控制。
