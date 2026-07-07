# AI Life Assistant POC 方案 v0.1

## 1. 核心理解

这不是一个新的待办清单、家庭日历、新闻流或聊天机器人。

它的核心是：

> 用户只需要把脑子里的杂乱事情说出来或打出来，系统负责压缩、分类、提问、排序，并在一个旧手机、旧平板或浏览器屏幕上显示“现在真正值得注意的事”。

更准确地说，它应该像一个轻量秘书/生活助理：

- 记住用户随口说出的生活事项。
- 在合适时间主动追问进展。
- 从一个事件推导出隐含准备事项。
- 发现重复模式后询问是否变成 recurring to-do。
- 结合天气、地点、日期等上下文给出低噪音提醒。

POC 的第一目标不是功能丰富，而是验证一个体验假设：

> 一个常驻、稀疏、可信的生活仪表盘，是否能让用户少维护系统、少做选择、少被信息打扰。

## 2. POC 北极星

### 产品承诺

一个输入入口，一个安静屏幕。

用户输入自然语言，例如：

- “今天 5 点前把报告发给 Henry，晚上买牛奶，我今天很累，别安排太多。”
- “AI 产品研究这周要完成，帮我拆成步骤。”
- “我完成了报告。”

系统输出：

- 一个最重要的 Now 行动。
- 最多三个 Today 事项。
- 最多三个 This Week 项目。
- 最多五个 Household 项。
- 一句状态说明。
- 后续最多三个与当前目标相关的信息卡片。

### POC 要证明的事

1. 用户愿意用一个自然语言入口记录生活杂讯。
2. 简单解析也能把输入变成有用结构。
3. 稀疏仪表盘比完整列表更有价值。
4. 旧设备常驻显示是一个真实使用场景。
5. 后续的信息简报必须是“压缩后的相关信息”，不是新闻流。

## 3. 第一阶段范围

本方案建议先做 brief 中的 Phase 0 和 Phase 1。

### 做

- 浏览器优先的 PWA shell。
- 页面：`/`、`/input`、`/dashboard`、`/settings`。
- 本地状态，先使用 `localStorage`。
- 文本输入。
- 可选 Web Speech API 语音输入，如果浏览器支持。
- 规则解析器，覆盖明显命令。
- 稀疏 dashboard。
- display mode，适配旧手机和旧平板。
- README 与环境说明。

### 暂不做

- 登录注册。
- Supabase。
- 真实 AI API。
- RSS 抓取。
- 真实天气 API。
- 后台推送通知。
- 自动 recurring 规则创建。
- 付费。
- 原生 iOS/Android。
- 多人协作。
- 日历、邮箱、浏览器插件等深集成。

## 4. 目标用户场景

### 场景 A：早上整理今天

用户打开输入页，说：

> 今天 4 点前完成方案初稿，晚上买纸巾。我昨晚没睡好，今天安排轻一点。

系统更新：

- Now：完成方案初稿。
- Today：方案初稿、买纸巾。
- State：低能量，非关键任务已后移。
- Shopping：纸巾。

### 场景 B：工作中快速卸脑

用户在电脑上输入：

> 下周前调研三个竞品，拆一下。

Phase 1 可以先创建一个项目或本周任务：

- This Week：调研三个竞品。
- Today 可追加一个低摩擦下一步：列出竞品候选。

真实 AI 阶段再做更细的拆解。

### 场景 C：旧平板常驻显示

用户把旧 iPad 横屏放在桌上，打开 `/dashboard?display=1`。

屏幕只显示：

- Today, only this matters.
- Now。
- Today 三项以内。
- Week 项目进度。
- Household。
- State。

编辑控件隐藏，刷新轻量自动发生。

### 场景 D：购买牛奶与重复模式

用户打开冰箱发现没有牛奶，对 app 说：

> 我需要买牛奶。

系统先把牛奶加入 Household / Today。

如果到了晚上仍未完成，app 主动显示一个短追问：

> 牛奶买好了吗？

用户回答：

> 已经下单了，明早送到。

系统更新购物项状态：

- milk：ordered。
- expected：tomorrow morning。
- 不再继续催买，但明早可以提示确认收货。

第二周用户再次说需要买牛奶时，系统不自动创建复杂规则，而是问：

> 看起来你经常需要买牛奶。要把它设成每周提醒吗？

### 场景 E：出行前的隐含准备

用户说：

> 这周五需要去苏州。

系统创建一个 travel event，并识别它隐含准备事项。

周四晚上，dashboard 或提醒区主动询问：

- 去苏州的车票/机票买好了吗？
- 行李收拾好了吗？

用户可以回答：

> 票买好了，行李还没收。

系统更新对应 checklist，并把“收拾行李”放入 Now 或 Today。

### 场景 F：孩子兴趣班与时间段确认

用户说：

> 我家里有几个孩子，周三和周五几点要去兴趣班。

系统不应该盲目生成日程，而是先追问关键缺失信息：

- 每个孩子分别是哪一天、几点？
- 兴趣班持续多久？
- 需要提前多久出门？
- 是否每周重复？

得到答案后，系统生成时间段型 to-do：

- 出门准备。
- 接送路程。
- 兴趣班时间段。
- 接回家提醒。

### 场景 G：天气触发的低噪音提醒

如果用户明天有出门计划，而天气显示有雨，晚上提醒：

> 明天有雨，出门记得带伞。

如果用户本周末计划出游，但周二发现周末可能下雨，系统不直接改计划，而是问：

> 周末可能下雨。要不要保留原计划，还是准备一个备选方案？

### 这些场景带来的产品结论

这些 case 说明核心价值不只是“输入转任务”，而是“生活事件管理”：

1. 从一句话中识别实体：物品、地点、时间、人物、孩子、交通方式。
2. 从事件中推导隐含 checklist：票、行李、出门、接送、带伞。
3. 在缺少关键字段时短问一句，而不是猜。
4. 到合适时间主动 check-in，而不是等用户想起来。
5. 发现重复模式后请求授权创建 recurring to-do。
6. 结合外部上下文，但只在影响当前计划时提醒。
7. 所有主动行为都必须可解释、可关闭、可修改。

## 5. 信息架构

### `/`

默认首页。

建议设计成“输入 + 今日摘要”的组合页：

- 手机：先显示输入框，再显示 dashboard 摘要。
- 桌面：左侧输入，右侧 dashboard。
- 目的：新用户一进来就知道这个产品不是列表管理器，而是“说进去，清屏出来”。

### `/input`

专注输入页。

元素：

- 标题：`What is on your mind?`
- 文本输入框。
- 语音按钮，如果当前浏览器支持。
- 最近一次解析结果。
- 如果需要确认，显示一个短问题。

Phase 1 不做复杂解析预览，只显示“已加入 Today / Shopping / State”这样的轻反馈。

### `/dashboard`

核心展示页。

常规模式：

- 顶部有输入入口、刷新、display mode 切换。
- 允许完成任务、延期任务、删除购物项。

Display mode：

- 大字号。
- 极少按钮。
- 隐藏编辑控件。
- 保持布局稳定，避免长时间显示烧屏风险。

### `/settings`

只放 POC 必要设置：

- 显示名称。
- 语言。
- 最大今日任务数，默认 3。
- 起床/睡觉时间。
- 信息兴趣占位，后续 Phase 5 使用。
- 清空本地数据。

## 6. Dashboard 内容设计

### 版式顺序

1. 顶部状态：日期、问候、简短状态。
2. Now：单个大块，强调唯一下一步。
3. Today：最多三项。
4. Progress：完成数/总数。
5. This Week：最多三个项目。
6. Household：最多五个购物项。
7. Brief：Phase 1 先用占位或隐藏。

### 展示限制

- Now：1 条。
- Today：最多 3 条。
- Week：最多 3 条。
- Shopping：最多 5 条。
- State：1 句。
- Brief：最多 3 张卡，Phase 5 再启用。

### 排序逻辑

Phase 1 采用本地规则：

1. due_at 越近越靠前。
2. priority 为 high 的优先。
3. energy_required 与当前 energy 匹配时优先。
4. 已完成、取消、延期的项目不进入 Now。
5. 如果 energy 为 low，只保留高优先级或低能量任务在 Today。

## 7. 本地数据模型

Phase 1 使用 TypeScript 类型和 `localStorage`。

```ts
type Task = {
  id: string;
  title: string;
  description?: string;
  type: "task" | "project_step" | "reminder" | "waiting_for" | "habit";
  horizon: "now" | "today" | "this_week" | "later" | "someday";
  dueAt?: string;
  estimatedMinutes?: number;
  energyRequired: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
  status: "todo" | "doing" | "done" | "deferred" | "cancelled";
  sourceInputId?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

type Project = {
  id: string;
  title: string;
  description?: string;
  status: "active" | "paused" | "done";
  targetDate?: string;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
};

type ShoppingItem = {
  id: string;
  itemName: string;
  quantity?: string;
  category?: string;
  status: "needed" | "bought" | "removed";
  createdAt: string;
  updatedAt: string;
};

type MoodLog = {
  id: string;
  moodLabel: string;
  energyLevel: "low" | "medium" | "high";
  note?: string;
  createdAt: string;
};

type UserPreferences = {
  preferredLanguage: "en" | "zh";
  wakeTime?: string;
  sleepTime?: string;
  planningStyle: "light" | "balanced" | "ambitious";
  maxDailyTasks: number;
  informationInterests: string[];
};
```

### Phase 2+ 秘书型扩展模型

这些模型不要求 Phase 1 全部实现，但需要在架构上预留：

```ts
type LifeEvent = {
  id: string;
  title: string;
  category: "travel" | "class" | "appointment" | "household" | "outing" | "other";
  startsAt?: string;
  endsAt?: string;
  location?: string;
  participants: string[];
  status: "planned" | "confirmed" | "done" | "cancelled";
  sourceInputId?: string;
  createdAt: string;
  updatedAt: string;
};

type AssistantCheckIn = {
  id: string;
  title: string;
  question: string;
  relatedType: "task" | "shopping_item" | "life_event" | "project";
  relatedId: string;
  askAt: string;
  status: "pending" | "answered" | "dismissed";
  createdAt: string;
};

type RecurrenceCandidate = {
  id: string;
  normalizedTitle: string;
  relatedType: "task" | "shopping_item" | "life_event";
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  suggestedRule?: string;
  status: "watching" | "suggested" | "accepted" | "rejected";
};

type ContextSignal = {
  id: string;
  signalType: "weather" | "traffic" | "deadline" | "delivery" | "manual";
  title: string;
  summary: string;
  relatedEventId?: string;
  severity: "low" | "medium" | "high";
  createdAt: string;
};
```

设计原则：

- `LifeEvent` 负责承载“去苏州”“孩子兴趣班”“周末出游”这类事件。
- `AssistantCheckIn` 负责主动追问，例如“牛奶买了吗”“票买了吗”。
- `RecurrenceCandidate` 负责发现重复模式，但必须询问用户确认。
- `ContextSignal` 负责天气等外部信号，只有影响当前计划时才进入 dashboard。

## 8. 输入解析策略

Phase 1 的规则解析器只覆盖高频、明显命令，避免假装已经有 AI 能力。

### 购物识别

触发词：

- English: `buy`, `get`, `pick up`, `shopping`
- 中文：`买`、`采购`、`加到购物`、`纸巾`、`牛奶` 等常见名词辅助

例子：

- `buy milk` -> shopping item: milk
- `买纸巾和牛奶` -> shopping items: 纸巾, 牛奶

### 今日任务识别

触发词：

- English: `finish`, `send`, `call`, `email`, `review`, `by`
- 中文：`完成`、`发送`、`打电话`、`整理`、`今天`、`下午`、`点前`

例子：

- `send report by 5pm` -> task, today, dueAt 17:00
- `今天下午 4 点前完成方案` -> task, today, dueAt 16:00

### 状态识别

触发词：

- English: `tired`, `exhausted`, `low energy`, `overwhelmed`
- 中文：`累`、`很累`、`没睡好`、`低能量`、`压力大`

例子：

- `I am tired today` -> mood log, low energy
- `今天没睡好，安排轻一点` -> mood log, low energy + reprioritize

### 完成任务识别

触发词：

- English: `done`, `finished`, `completed`
- 中文：`完成了`、`做完了`、`搞定了`

匹配最近相似任务标题，命中后更新为 `done`。

### 模糊输入处理

如果无法识别：

- 保存为普通 task。
- `confidence` 设为 0.4。
- 标记为 `needsReview`。
- 页面提示：`I saved this, but may need a quick correction.`

Phase 2 接入 AI 后，这里替换为结构化 tool calls。

### 主动追问策略

秘书型体验的关键不是多提醒，而是问得准。

Phase 1 可以先把追问做成 dashboard 上的 `Assistant prompts`，不做系统级推送。

触发策略：

- 购物项当天未完成，晚上显示“买好了吗？”
- 出行事件前一晚显示“票/行李准备好了吗？”
- 时间段事件缺少结束时间时，立即追问“持续多久？”
- 同类购物或任务在 14 天内出现 2 次以上，显示 recurring 建议。
- 有出门事件且存在天气风险时，显示带伞或改期建议。

主动追问的文案必须短，且一次只问一件事。

## 9. 组件设计

建议组件：

- `AppShell`：页面框架和导航。
- `CaptureBox`：文本和语音输入。
- `DashboardView`：完整 dashboard。
- `NowPanel`：唯一当前行动。
- `TodayPanel`：最多三条 Today。
- `ProgressPanel`：完成进度。
- `WeekPanel`：本周项目。
- `ShoppingPanel`：购物项。
- `StatePanel`：当前状态。
- `BriefPanel`：Phase 5 前先隐藏或 mock。
- `AssistantPromptPanel`：主动追问和确认。
- `DisplayModeToggle`：普通/展示模式切换。
- `EmptyState`：没有任务时的轻量状态。

## 10. 前端视觉方向

关键词：

- calm
- sparse
- readable
- display-first
- low maintenance

建议：

- 背景使用浅色或柔和中性色，但不要做成单一米色/咖啡色主题。
- 重点区域使用明确但克制的强调色。
- 卡片圆角控制在 8px 内。
- 旧平板横屏时 Now 要成为视觉中心。
- 手机竖屏时输入必须足够顺手。
- 按钮使用图标 + 可访问标签。
- 不用营销式 hero，不做说明型大段文案。

## 11. 技术架构

### Phase 0/1

```text
Next.js App Router
  -> React components
  -> local parser
  -> localStorage store
  -> generated dashboard JSON
```

### Phase 2 扩展点

```text
Input text
  -> /api/parse-input
  -> LLM structured output
  -> tool calls
  -> apply actions
  -> regenerate dashboard
```

### AI API 调用实现方案

Phase 2 开始接入 AI，但调用必须集中在服务端。前端只提交用户输入，不持有 API key。

建议优先使用 OpenAI Responses API：

- 输入解析：使用 function/tool calling，让模型返回一组工具调用。
- Dashboard JSON：优先用确定性代码生成；如果需要 AI 改写文案，再用 structured outputs。
- 信息简报：后续 Phase 5 使用 structured outputs 生成固定格式卡片。
- 语音：Phase 1 先用浏览器 Web Speech API；Phase 2 再考虑服务端转写接口。

#### 环境变量

`.env.example` 至少包含：

```text
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
AI_PARSE_ENABLED=false
```

`AI_PARSE_ENABLED=false` 时仍使用本地规则解析器，方便无 key 本地开发。

#### `/api/parse-input` 流程

```text
Client CaptureBox
  -> POST /api/parse-input
     { rawText, inputType, timezone, clientNow }

Server route
  -> load user context
     active tasks, shopping items, mood, projects, events
  -> call OpenAI Responses API with tool schemas
  -> receive tool calls
  -> validate tool arguments
  -> apply allowed actions through server handlers
  -> regenerate dashboard
  -> return applied actions + dashboard + optional question
```

模型不直接写数据库。它只能请求这些白名单工具：

- `create_task`
- `update_task`
- `complete_task`
- `add_to_shopping_list`
- `update_shopping_item`
- `log_mood`
- `create_life_event`
- `create_assistant_check_in`
- `suggest_recurrence`
- `ask_clarifying_question`

#### 示例工具定义

```ts
const tools = [
  {
    type: "function",
    name: "create_task",
    description: "Create a personal task or reminder from the user's natural-language input.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        horizon: { enum: ["now", "today", "this_week", "later", "someday"] },
        dueAt: { type: ["string", "null"], description: "ISO datetime when known." },
        priority: { enum: ["low", "medium", "high"] },
        energyRequired: { enum: ["low", "medium", "high"] },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["title", "horizon", "dueAt", "priority", "energyRequired", "confidence"]
    }
  },
  {
    type: "function",
    name: "ask_clarifying_question",
    description: "Ask one short question when critical information is missing.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        reason: { type: "string" },
        blocksAction: { type: "boolean" }
      },
      required: ["question", "reason", "blocksAction"]
    }
  }
];
```

#### 示例服务端调用

```ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function parseWithAI(input: ParseInputRequest, context: AssistantContext) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-5.5",
    store: false,
    input: [
      {
        role: "system",
        content: [
          "You are a calm personal-life assistant.",
          "Convert messy user input into safe, sparse tool calls.",
          "Ask one short clarifying question when a critical field is missing.",
          "Never create recurring rules without explicit user confirmation.",
          "Do not provide medical, financial, legal, or therapy advice."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          rawText: input.rawText,
          timezone: input.timezone,
          clientNow: input.clientNow,
          context
        })
      }
    ],
    tools
  });

  return extractToolCalls(response);
}
```

#### 执行动作

服务端拿到 tool calls 后，走本地 handler：

```text
create_task(args)
  -> validate with Zod
  -> normalize dates/timezone
  -> reject unsafe or unsupported fields
  -> insert/update DB
  -> return applied action
```

需要确认的情况不直接执行：

- 创建 recurring to-do。
- 出行计划改期。
- 删除或取消多个任务。
- 低置信度解析。
- 涉及医疗、金融、法律建议。

#### Dashboard 生成

Dashboard 第一版不要每次都调用 AI。建议：

```text
DB state
  -> deterministic generateDashboard()
  -> hard limits
  -> Now 1 item
  -> Today max 3
  -> Week max 3
  -> Shopping max 5
  -> State 1 sentence
```

AI 只在这些场景使用：

- 把用户输入解析成 tool calls。
- 生成很短的 clarifying question。
- 后续生成 `why_it_matters` 信息卡。
- 后续把天气/行程冲突转成低噪音提醒文案。

#### 主动提醒的 AI 调用

主动提醒不要靠模型自由发挥，而是先由规则发现触发条件，再让 AI 帮忙压缩成一句话。

```text
Scheduled job
  -> find upcoming life events
  -> find pending shopping/tasks
  -> fetch weather only when needed
  -> create deterministic candidate prompts
  -> optional AI rewrite into short assistant prompt
  -> save AssistantCheckIn
```

例子：

- 规则发现：明天有出门事件 + 天气有雨。
- AI 只生成：`明天有雨，出门记得带伞。`
- AI 不直接改行程。

#### 成本与可靠性策略

- 默认只有用户提交输入时调用 AI。
- Dashboard 刷新不调用 AI。
- 主动提醒通过定时任务批处理。
- 对模型返回结果做 schema validation。
- 每个 AI action 记录 `source_input_id` 和 `confidence`。
- 解析失败时回退到本地规则解析器。
- 生产环境设置速率限制，避免长文本或重复提交造成成本失控。

### 火山引擎 Ark / Agent Plan 接入策略

阅读时间：2026-07-06。

官方文档：

- [Agent Plan 其他工具接入](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2373746?lang=zh)
- [Agent Plan 套餐概览](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2366394?lang=zh)
- [Agent Plan 语音模型接入](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2516286?lang=zh)
- [普通火山方舟 Chat API](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1494384?lang=zh)
- [普通火山方舟 Function Calling](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1262342?lang=zh)
- [火山方舟快速入门](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1399008?lang=zh)

#### 关键结论

用户已确认拿到火山引擎授权，因此本产品后端可以统一使用 Agent Plan API 作为主要 AI Runtime。

授权前提：需要将授权邮件、合同或工单结论保存到项目合规材料中。Agent Plan 官方公开文档仍然提示文本生成模型及向量化模型存在 API 使用限制；本方案基于用户已取得额外授权这一前提设计。

决策：新增并默认使用 `volcengine_agent_plan_runtime` provider。

产品 AI 通道调整为：

1. 产品运行时 LLM：Agent Plan OpenAI-compatible API。
2. 语音 ASR/TTS：Agent Plan 语音模型。
3. 备用 provider：普通火山方舟 API、OpenAI API、本地 mock。
4. 开发工具：仍可使用同一 Agent Plan 订阅接入 Codex、OpenCode、Cursor、Cline 等工具，但产品后端 API Key 应独立管理。

#### 是否能统一使用 Agent Plan

在已取得授权的前提下，可以统一使用 Agent Plan。

统一范围：

- `parse-input`
- `generate-brief`
- `summarize`
- `assistant check-in`
- `weather / trip prompt rewrite`
- ASR / TTS

仍需注意：

- 需要确认授权覆盖“产品后端调用”“文本生成”“向量化/Embedding”“多用户服务”这些场景。
- 如果授权只覆盖文本生成，不覆盖向量化，则 embedding 仍需使用普通火山方舟 API 或其他向量服务。
- Agent Plan 的 AFP、5 小时额度、周额度、月额度可能影响产品稳定性，后端必须有调用日志、限流、熔断和 fallback。
- 产品后端使用的 Agent Plan API Key 应和本地开发工具使用的 API Key 分开管理，降低误操作和泄露风险。

#### 用户强制要求使用 Agent Plan 的处理方式

当前用户已确认拿到授权，并明确要求统一使用 Agent Plan 的 API 实现产品后端功能。

设计处理：

- 实现 `volcengine_agent_plan_runtime_provider`。
- POC 默认 provider 设置为 `volcengine_agent_plan_runtime`。
- README 和 `.env.example` 标注：该路径基于用户已取得授权。
- 保留 `volcengine_ark` 普通 API 和 `openai` provider 作为备用。
- 每次 provider 调用记录 provider、model、request_id、latency、token/AFP 用量信息。

运行时保护：

```text
AI_PROVIDER=volcengine_agent_plan_runtime
ALLOW_AGENT_PLAN_RUNTIME=true
```

如果 `ALLOW_AGENT_PLAN_RUNTIME` 不是 `true`，服务端启动时应拒绝使用 Agent Plan Runtime provider，避免误部署到未授权环境。

这样做的目的是把授权假设显式化：项目按已授权路径实现，但部署环境必须明确确认授权状态。

#### Agent Plan 可以做什么

Agent Plan 适合接入 AI 编程或 Agent 工具生态。

已确认的专用 Base URL：

```text
兼容 Anthropic:
https://ark.cn-beijing.volces.com/api/plan

兼容 OpenAI:
https://ark.cn-beijing.volces.com/api/plan/v3
```

注意：

- Agent Plan 专属 API Key 与普通火山方舟 API Key 不同，不能混用。
- Agent Plan 的 OpenAI-compatible Base URL 可用于兼容 OpenAI 协议的调用。
- 在本项目中，基于用户已取得授权，该 Base URL 会用于产品服务器的 `parse-input`、`generate-brief` 等 AI 后端路径。
- Codex CLI、OpenCode、OpenClaw、TRAE、Hermes Agent、Cline、Cursor、Roo Code、Kilo Code 等开发工具也可使用 Agent Plan，但建议与产品后端使用不同 API Key。

#### 产品运行时使用 Agent Plan Runtime

Agent Plan OpenAI-compatible API：

```text
POST https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions
Authorization: Bearer $ARK_AGENT_PLAN_API_KEY
```

Agent Plan OpenAI-compatible Base URL：

```text
https://ark.cn-beijing.volces.com/api/plan/v3
```

普通火山方舟 API 保留为 fallback：

```text
https://ark.cn-beijing.volces.com/api/v3
```

对本产品来说，优先使用 Chat API 的 function calling 即可满足输入解析：

- `tools`
- `tool_choice`
- `parallel_tool_calls`
- `strict`
- `response_format`
- `stream`

火山文档确认 Function Calling 支持 Chat API / Responses API，并建议函数调用场景下关闭 thinking 以提高效率。

#### 推荐环境变量

```text
# Provider selection
AI_PROVIDER=volcengine_agent_plan_runtime
ALLOW_AGENT_PLAN_RUNTIME=true

# OpenAI provider
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5

# Volcengine Ark normal API provider
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_CHAT_MODEL=doubao-seed-2-1-pro-260628
ARK_DISABLE_THINKING=true

# Agent Plan runtime provider
ARK_AGENT_PLAN_API_KEY=
ARK_AGENT_PLAN_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
ARK_AGENT_PLAN_ANTHROPIC_BASE_URL=https://ark.cn-beijing.volces.com/api/plan
ARK_AGENT_PLAN_CHAT_MODEL=doubao-seed-2.0-pro
ARK_AGENT_PLAN_DISABLE_THINKING=true

# Agent Plan speech models
ARK_TTS_URL=wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection
ARK_TTS_RESOURCE_ID=seed-tts-2.0
ARK_ASR_URL=wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async
ARK_ASR_RESOURCE_ID=volc.seedasr.sauc.duration

# Local fallback
AI_PARSE_ENABLED=false
```

生产环境建议：

- `AI_PROVIDER=volcengine_agent_plan_runtime`。
- `ALLOW_AGENT_PLAN_RUNTIME=true` 必须显式配置。
- `ARK_AGENT_PLAN_API_KEY` 参与文本解析、摘要、信息简报、主动追问文案等产品后端调用。
- `ARK_API_KEY` 保留为普通火山方舟 fallback。
- 如果只做 Phase 0/1，保持 `AI_PROVIDER=mock` 和 `AI_PARSE_ENABLED=false`。

#### Provider 抽象

不要在业务代码中直接写死 OpenAI 或火山方舟。建议定义统一接口：

```ts
export type LifeAssistantToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
  confidence?: number;
};

export type ParseLifeInputResult = {
  toolCalls: LifeAssistantToolCall[];
  question?: {
    text: string;
    blocksAction: boolean;
  };
  rawProviderResponse?: unknown;
};

export interface AiProvider {
  parseLifeInput(input: ParseInputRequest, context: AssistantContext): Promise<ParseLifeInputResult>;
  summarizeBriefCard?(input: BriefInput): Promise<BriefCardDraft>;
}
```

Provider 文件建议：

```text
src/lib/ai/providers/
  types.ts
  mockProvider.ts
  openaiProvider.ts
  volcengineArkProvider.ts
  volcengineAgentPlanRuntimeProvider.ts
  index.ts
```

`index.ts` 根据环境变量选择 provider：

```ts
export function getAiProvider(): AiProvider {
  switch (process.env.AI_PROVIDER) {
    case "openai":
      return openaiProvider;
    case "volcengine_ark":
      return volcengineArkProvider;
    case "volcengine_agent_plan_runtime":
      if (process.env.ALLOW_AGENT_PLAN_RUNTIME !== "true") {
        throw new Error("Agent Plan Runtime provider requires ALLOW_AGENT_PLAN_RUNTIME=true.");
      }
      return volcengineAgentPlanRuntimeProvider;
    default:
      return mockProvider;
  }
}
```

#### Agent Plan 工具调用示例

产品里的 `parse-input` 可以这样调用 Agent Plan OpenAI-compatible Chat API：

```ts
export async function parseWithAgentPlanRuntime(
  input: ParseInputRequest,
  context: AssistantContext
): Promise<ParseLifeInputResult> {
  if (process.env.ALLOW_AGENT_PLAN_RUNTIME !== "true") {
    throw new Error("Agent Plan Runtime is not enabled for this environment.");
  }

  const response = await fetch(`${process.env.ARK_AGENT_PLAN_OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ARK_AGENT_PLAN_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.ARK_AGENT_PLAN_CHAT_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "You are a calm personal-life assistant.",
            "Convert messy user input into safe, sparse tool calls.",
            "Ask one short clarifying question when critical information is missing.",
            "Never create recurring rules without explicit user confirmation.",
            "Return tool calls only when the action is safe and reversible."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            rawText: input.rawText,
            timezone: input.timezone,
            clientNow: input.clientNow,
            context
          })
        }
      ],
      tools: lifeAssistantTools,
      parallel_tool_calls: true,
      thinking: process.env.ARK_AGENT_PLAN_DISABLE_THINKING === "true"
        ? { type: "disabled" }
        : undefined
    })
  });

  if (!response.ok) {
    throw new Error(`Agent Plan request failed: ${response.status}`);
  }

  const payload = await response.json();
  return normalizeArkToolCalls(payload);
}
```

需要注意：

- Agent Plan OpenAI-compatible API 的 tool schema 结构按 OpenAI 风格设计：`{ type: "function", function: { name, description, parameters, strict } }`。
- strict 模式要求所有字段都放进 `required`；可选字段用 `["string", "null"]` 这类 nullable 类型表达。
- 返回 `finish_reason=tool_calls` 时，服务端解析 `choices[0].message.tool_calls`。
- 本产品不需要把工具执行结果再回填给模型生成最终回复；我们只需要把 tool calls 转成可审计 action，然后更新 dashboard。

#### Agent Plan 语音接入

Phase 1 先使用浏览器 Web Speech API，不依赖服务端语音模型。

如果 Phase 2/3 需要更稳定的中文语音输入，可以用 Agent Plan ASR：

```text
ASR 双流 WebSocket:
wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async

Headers:
X-Api-Key: $ARK_AGENT_PLAN_API_KEY
X-Api-Resource-Id: volc.seedasr.sauc.duration
X-Api-Request-Id: <uuid>
X-Api-Connect-Id: <uuid>
```

如果后续要做语音播报，可以用 Agent Plan TTS：

```text
TTS 双流 WebSocket:
wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection

HTTP TTS:
https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional

Headers:
X-Api-Key: $ARK_AGENT_PLAN_API_KEY
X-Api-Resource-Id: seed-tts-2.0
X-Api-Connect-Id: <uuid>
```

在当前 POC 中，语音模型不是首要路径。优先把文本输入和结构化 action 做稳。

#### 推荐接入顺序

1. Phase 0/1：本地规则解析，不调用任何模型。
2. Phase 2：增加 `AiProvider` 抽象。
3. Phase 2：先接 Agent Plan Runtime provider 的 Chat API function calling。
4. Phase 2：保留普通火山方舟和 OpenAI provider 作为备用 provider。
5. Phase 3：加入 provider 调用日志、失败回退、成本统计。
6. Phase 3/4：按需要接入 Agent Plan ASR/TTS。

### Phase 3 扩展点

```text
Supabase Auth
Supabase DB
Row Level Security
Dashboard snapshots
Cross-device display
```

本地状态层需要抽象成 `store`，避免后续从 `localStorage` 迁移到 Supabase 时重写 UI。

### Phase 4+ 主动助理扩展点

```text
Life events
  -> checklist templates
  -> assistant check-ins
  -> dashboard prompts
  -> optional notifications

Repeated inputs
  -> normalize item/task
  -> detect recurrence candidate
  -> ask for confirmation
  -> create recurring rule only after approval

Weather/context
  -> match with outing/travel events
  -> generate low-noise context signal
  -> ask before changing plans
```

这里的重点是“主动但不武断”：app 可以提醒、追问、建议，但不自动改变行程或创建长期规则。

## 12. 文件结构建议

```text
ai-life-assistant/
  README.md
  .env.example
  package.json
  src/
    app/
      page.tsx
      input/page.tsx
      dashboard/page.tsx
      settings/page.tsx
      globals.css
    components/
      AppShell.tsx
      CaptureBox.tsx
      DashboardView.tsx
      NowPanel.tsx
      TodayPanel.tsx
      ProgressPanel.tsx
      WeekPanel.tsx
      ShoppingPanel.tsx
      StatePanel.tsx
      DisplayModeToggle.tsx
    lib/
      dashboard/
        generateDashboard.ts
      parser/
        parseLocalInput.ts
      store/
        localStore.ts
      time/
        parseTime.ts
    types/
      domain.ts
```

## 13. 验收标准

Phase 0/1 完成后，必须能做到：

1. 本地运行成功。
2. `/dashboard` 在手机宽度和旧平板宽度都可读。
3. 输入 `send report by 5pm` 后，Today 或 Now 出现对应任务。
4. 输入 `buy milk` 后，Household 出现 milk。
5. 输入 `I am tired today` 后，State 出现低能量提示。
6. Dashboard 不超过硬性密度限制。
7. 用户可以标记任务完成。
8. Display mode 隐藏编辑控件，适合常驻屏幕。
9. README 说明本地启动、当前限制和下一阶段计划。

## 14. 关键产品风险与设计应对

### 风险：用户不信任解析结果

应对：

- 每次输入后给出简短反馈。
- 支持撤销或手动编辑。
- Phase 2 开始显示结构化解析结果的简短理由。

### 风险：Dashboard 变成另一个列表

应对：

- 写死显示上限。
- 把完整列表藏在后续历史/管理页，不放首屏。
- Now 永远只有一个。

### 风险：旧设备显示只是新鲜感

应对：

- 第一版就做 display mode。
- 记录是否打开 display mode。
- 观察用户是否愿意第二天继续打开。

### 风险：信息简报把产品拖向新闻流

应对：

- Phase 1 不做信息简报。
- Phase 5 只允许最多三张卡。
- 每张卡必须解释 `why_it_matters`。

## 15. 下一步建议

建议下一步直接进入实现：

1. 初始化 Next.js + TypeScript + Tailwind 项目。
2. 建立 domain types 和 localStorage store。
3. 做 dashboard mock UI。
4. 做 text input 和 rule-based parser。
5. 添加 display mode。
6. 写 README。

先不要接 AI。先把“一个输入，屏幕变清爽”这个手感做出来。
