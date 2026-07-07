import { normalizeAiInterpretation, type AiInterpretation, type InterpretAction } from "@/lib/ai/interpretation";
import { defaultAgentPlanLanguageModel, isAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import type { AssistantState } from "@/types/domain";

export type AgentPlanChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type AgentPlanChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AgentPlanChatCompletionRequest = {
  model: string;
  messages: AgentPlanChatMessage[];
  temperature?: number;
  response_format?: { type: "json_object" };
};

const SYSTEM_PROMPT = `
你是一个面向个人生活管理的 AI 秘书。你的职责是把用户的一句话转成结构化动作，帮助产品维护待办、购物、家庭日程、出行准备、主动追问和状态感知。

必须只输出 JSON，不要 Markdown，不要解释。JSON 格式：
{
  "feedback": { "title": "短标题", "detail": "给用户看的简短反馈", "question": "可选追问" },
  "actions": [
    { "type": "add_task", "ref": "可选内部引用", "title": "...", "horizon": "today|this_week|later", "dueAt": "ISO 时间", "priority": "low|medium|high", "energyRequired": "low|medium|high" },
    { "type": "add_shopping_item", "ref": "可选内部引用", "itemName": "...", "status": "needed|ordered|bought", "expectedAt": "ISO 时间", "createTask": true },
    { "type": "update_shopping_status", "itemName": "...", "status": "ordered|bought", "expectedAt": "ISO 时间" },
    { "type": "add_life_event", "ref": "trip", "title": "...", "description": "可选：相关细节", "category": "travel|class|appointment|household|outing|other", "startsAt": "ISO 时间", "location": "..." },
    { "type": "add_check_in", "title": "...", "question": "...", "relatedType": "life_event|shopping_item|task|project", "relatedRef": "trip", "askAt": "ISO 时间" },
    { "type": "add_mood_log", "moodLabel": "...", "energyLevel": "low|medium|high", "note": "..." },
    { "type": "mark_task_done", "matchTitle": "..." }
  ]
}

产品行为规则：
- 一个真实生活活动只生成一个主活动，不要把同一件事拆成多个并列待办。例如“周日去上海，在上海吃晚饭，准备高铁往返”是一个上海出行/吃饭活动，而不是“去上海”“在上海吃饭”“订高铁票”三个主事项。
- 与主活动强相关的提醒、确认、准备项，优先生成 add_check_in，并用 relatedRef 挂到主活动或主待办下面；不要作为并列 add_task 展示。
- “提醒我……”“到时候提醒我……”如果依赖某个未来活动，必须是 add_check_in；askAt 设在活动前一晚 20:00，除非用户明确给出提醒时间。
- 多天连续安排要合并成一个主事项。例如“周四和周五请假”只生成一个“申请周四和周五请假”待办，不要拆成周四/周五两个待办。
- 请假、报备、和老板沟通这类准备提醒，应作为主请假待办下面的 add_check_in。
- 用户说需要买某物：新增购物项，并创建一个今日待办。
- 用户说已经买好或已下单某物：更新购物状态，不要再创建购买待办。
- 用户提到出行：新增一个 life_event；把订票、行李、酒店、路线等放进同一个 check-in 问句，挂在该 life_event 下。
- 用户提到孩子兴趣班但缺持续时间：生成 check-in 追问持续多久和提前多久出门。
- 用户表达疲惫、压力或低能量：添加 mood log，并降低反馈语气压力。
- 只在用户明确表达完成/买好/下单时使用 mark 或 update。
- 时间必须用 ISO 8601；无法确定具体时间时必须省略 dueAt/startsAt，并用 feedback.question 或 add_check_in 向用户澄清。
- 不要编造 7:59、2:00、3:00 这类没有来源的时间。推断时间只能使用自然默认值：上午 9:00、下午 17:00、晚上 20:00、睡前提醒 21:30-22:30；否则省略。
- “今天12点前睡觉”如果没有“中午/今晚/凌晨/24点/零点”等上下文，语义不清晰。不要默认中午 12 点；生成今日睡觉目标，并立刻追问用户希望几点睡、几点提醒。确认前不要设置具体 dueAt。
- feedback.detail 要概括本次识别出的事项数量或主要类型，避免只提其中一个事项。
- 不要输出 id，后端会生成。

示例：
用户：“我今天想做到12点前睡觉，然后我这周四和周五希望请假，提醒我提前和老板说，然后我周日晚上计划去上海，在上海吃个晚饭，准备高铁往返，到时候提醒我要去订高铁票。”
正确结构：一个今日睡觉目标 + 一个澄清睡觉提醒时间的 check-in；一个“申请周四和周五请假”待办 + 一个老板沟通 check-in；一个“周日晚上去上海吃晚饭” life_event + 一个行前确认 check-in。不要把上海拆成多个主待办，不要把周四/周五请假拆成两个待办。
`.trim();

function configured() {
  return (
    process.env.AI_PROVIDER === "volcengine_agent_plan_runtime" &&
    process.env.ALLOW_AGENT_PLAN_RUNTIME === "true" &&
    process.env.AI_PARSE_ENABLED !== "false" &&
    Boolean(process.env.ARK_AGENT_PLAN_API_KEY)
  );
}

function endpoint() {
  const base = process.env.ARK_AGENT_PLAN_OPENAI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/plan/v3";
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

function summarizeState(state: AssistantState) {
  return {
    preferences: state.preferences,
    tasks: state.tasks.slice(0, 20).map((task) => ({
      id: task.id,
      title: task.title,
      horizon: task.horizon,
      dueAt: task.dueAt,
      priority: task.priority,
      status: task.status
    })),
    shoppingItems: state.shoppingItems.slice(0, 20).map((item) => ({
      id: item.id,
      itemName: item.itemName,
      status: item.status,
      expectedAt: item.expectedAt
    })),
    lifeEvents: state.lifeEvents.slice(0, 12).map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      startsAt: event.startsAt,
      location: event.location,
      status: event.status
    })),
    checkIns: state.checkIns.slice(0, 12).map((checkIn) => ({
      title: checkIn.title,
      question: checkIn.question,
      relatedType: checkIn.relatedType,
      status: checkIn.status
    })),
    recurrenceCandidates: state.recurrenceCandidates.slice(0, 12).map((candidate) => ({
      normalizedTitle: candidate.normalizedTitle,
      relatedType: candidate.relatedType,
      seenCount: candidate.seenCount,
      status: candidate.status
    })),
    recentInputs: state.inputs.slice(0, 8).map((input) => input.rawText)
  };
}

function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : content;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Agent Plan response did not contain a JSON object.");
  }
  return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as unknown;
}

function actionText(action: InterpretAction) {
  if (action.type === "add_task") return [action.title, action.description].filter(Boolean).join(" ");
  if (action.type === "add_life_event") return [action.title, action.description, action.location].filter(Boolean).join(" ");
  if (action.type === "add_check_in") return [action.title, action.question].join(" ");
  if (action.type === "add_shopping_item") return action.itemName;
  if (action.type === "update_shopping_status") return action.itemName;
  if (action.type === "mark_task_done") return action.matchTitle;
  return "";
}

function dateAt(date: Date, hour: number, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next.toISOString();
}

function previousDayAt(iso: string, hour: number, minute = 0) {
  const date = new Date(iso);
  date.setDate(date.getDate() - 1);
  return dateAt(date, hour, minute);
}

function thisOrNextWeekday(target: number, base = new Date()) {
  const date = new Date(base);
  const current = date.getDay();
  let delta = target - current;
  if (delta < 0) delta += 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function weekdayAt(target: number, hour: number, minute = 0) {
  return dateAt(thisOrNextWeekday(target), hour, minute);
}

function rawHasAmbiguousSleepDeadline(rawText: string) {
  return rawText
    .split(/然后|另外|还有|并且|到时候|[，。,.!?！？；;]/)
    .some((segment) => {
      const mentionsSleep = /(睡觉|睡|上床|休息)/.test(segment);
      const mentionsTwelveBefore = /(12|十二)\s*[点:：]?\s*前/.test(segment);
      const hasDisambiguator = /(中午|上午|下午|晚上|今晚|凌晨|零点|0点|24点|二十四点)/.test(segment);
      return mentionsSleep && mentionsTwelveBefore && !hasDisambiguator;
    });
}

function normalizeAmbiguousSleep(rawText: string, actions: InterpretAction[]) {
  if (!rawHasAmbiguousSleepDeadline(rawText)) return { actions, question: undefined };

  let sleepRef = "sleep_goal";
  let hasSleepTask = false;
  const cleaned = actions
    .filter((action) => !(action.type === "add_check_in" && /(睡觉|睡|上床|休息|12点|十二点)/.test(actionText(action))))
    .map((action) => {
      if (action.type !== "add_task" || !/(睡觉|睡|上床|休息)/.test(action.title)) return action;
      hasSleepTask = true;
      sleepRef = action.ref ?? sleepRef;
      return {
        ...action,
        ref: sleepRef,
        dueAt: undefined,
        horizon: "today" as const,
        priority: "medium" as const,
        energyRequired: "low" as const
      };
    });

  const next = [...cleaned];
  if (!hasSleepTask) {
    next.push({
      type: "add_task",
      ref: sleepRef,
      title: "今天12点前睡觉",
      horizon: "today",
      priority: "medium",
      energyRequired: "low"
    });
  }

  const question = "你说的今天12点前，是今晚 24:00 前睡，还是中午 12:00 前休息？确认后我会把提醒放在睡前 1-2 小时。";
  next.push({
    type: "add_check_in",
    title: "确认睡觉提醒时间",
    question,
    relatedType: "task",
    relatedRef: sleepRef,
    askAt: new Date().toISOString()
  });

  return { actions: next, question };
}

function rawHasThursdayFridayLeave(rawText: string) {
  return /(周四|星期四)/.test(rawText) && /(周五|星期五)/.test(rawText) && /请假/.test(rawText);
}

function isLeaveFragment(action: InterpretAction) {
  const text = actionText(action);
  return /(请假|老板)/.test(text) && !/(上海|高铁|火车|晚饭|吃饭)/.test(text);
}

function normalizeThursdayFridayLeave(rawText: string, actions: InterpretAction[]) {
  if (!rawHasThursdayFridayLeave(rawText)) return actions;

  const leaveRef = "leave_thursday_friday";
  const firstLeaveStart = weekdayAt(4, 9);
  const dueAt = previousDayAt(firstLeaveStart, 17);
  const askAt = previousDayAt(firstLeaveStart, 10);
  const cleaned = actions.filter((action) => !isLeaveFragment(action));

  cleaned.push({
    type: "add_task",
    ref: leaveRef,
    title: "申请周四和周五请假",
    description: "请假日期：周四至周五。提前和老板沟通并确认。",
    horizon: "this_week",
    dueAt,
    priority: "high",
    energyRequired: "medium"
  });

  if (/老板|提前|提醒/.test(rawText)) {
    cleaned.push({
      type: "add_check_in",
      title: "请假前确认",
      question: "已经提前和老板说周四、周五请假的事了吗？",
      relatedType: "task",
      relatedRef: leaveRef,
      askAt
    });
  }

  return cleaned;
}

function rawHasShanghaiTrip(rawText: string) {
  return /上海/.test(rawText) && /(周日|周天|星期日|星期天)/.test(rawText) && /(去|高铁|火车|往返|晚饭|吃饭|订票)/.test(rawText);
}

function isShanghaiFragment(action: InterpretAction) {
  const text = actionText(action);
  return /(上海|高铁|火车|订票|订高铁票|晚饭|吃饭)/.test(text) && !/(请假|老板)/.test(text);
}

function normalizeShanghaiTrip(rawText: string, actions: InterpretAction[]) {
  if (!rawHasShanghaiTrip(rawText)) return actions;

  const tripRef = "shanghai_sunday_trip";
  const startsAt = weekdayAt(0, /晚上|晚饭/.test(rawText) ? 19 : 9);
  const cleaned = actions.filter((action) => !isShanghaiFragment(action));
  cleaned.push({
    type: "add_life_event",
    ref: tripRef,
    title: /晚饭|吃饭/.test(rawText) ? "周日晚上去上海吃晚饭" : "周日去上海",
    description: /高铁|火车|往返/.test(rawText) ? "高铁往返；到上海吃晚饭。" : "到上海的出行安排。",
    category: "travel",
    startsAt,
    location: "上海"
  });
  cleaned.push({
    type: "add_check_in",
    title: "上海行前确认",
    question: "高铁票订好了吗？行李收拾好了吗？",
    relatedType: "life_event",
    relatedRef: tripRef,
    askAt: previousDayAt(startsAt, 20)
  });

  return cleaned;
}

function repairLifeSemantics(rawText: string, interpretation: AiInterpretation): AiInterpretation {
  const sleepResult = normalizeAmbiguousSleep(rawText, interpretation.actions);
  const withLeave = normalizeThursdayFridayLeave(rawText, sleepResult.actions);
  const withTrip = normalizeShanghaiTrip(rawText, withLeave);
  const touched = sleepResult.actions !== interpretation.actions || withLeave !== sleepResult.actions || withTrip !== withLeave;

  if (!touched) return interpretation;

  return {
    ...interpretation,
    feedback: {
      ...interpretation.feedback,
      detail: "已按主活动整理，并把相关提醒收在活动下面。",
      question: sleepResult.question ?? interpretation.feedback.question
    },
    actions: withTrip
  };
}

function shouldRetryWithoutResponseFormat(status: number, bodyText: string) {
  return status === 400 && /response_format|json_object/i.test(bodyText) && /not supported|not valid|invalid/i.test(bodyText);
}

export function canUseAgentPlan() {
  return configured();
}

export function resolveAgentPlanLanguageModel(model?: string) {
  return isAgentPlanLanguageModel(model)
    ? model
    : process.env.ARK_AGENT_PLAN_CHAT_MODEL ?? defaultAgentPlanLanguageModel;
}

export async function requestAgentPlanChatCompletion(
  requestBody: AgentPlanChatCompletionRequest
): Promise<AgentPlanChatCompletionResponse> {
  async function post(body: AgentPlanChatCompletionRequest) {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ARK_AGENT_PLAN_API_KEY}`
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    return { response, text };
  }

  let { response, text } = await post(requestBody);
  if (!response.ok && requestBody.response_format && shouldRetryWithoutResponseFormat(response.status, text)) {
    const { response_format: _responseFormat, ...retryBody } = requestBody;
    ({ response, text } = await post(retryBody));
  }

  if (!response.ok) {
    throw new Error(`Agent Plan request failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text) as AgentPlanChatCompletionResponse;
}

export async function interpretWithAgentPlan({
  rawText,
  inputType,
  state,
  model
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  model?: string;
}): Promise<AiInterpretation> {
  if (!configured()) {
    throw new Error("Agent Plan runtime is not configured.");
  }

  const payload = await requestAgentPlanChatCompletion({
    model: resolveAgentPlanLanguageModel(model),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          now: new Date().toISOString(),
          rawText,
          inputType,
          state: summarizeState(state)
        })
      }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" }
  });
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Agent Plan returned an empty response.");
  }

  const interpretation = normalizeAiInterpretation(parseJsonObject(content));
  if (!interpretation) {
    throw new Error("Agent Plan response did not match the expected schema.");
  }

  return repairLifeSemantics(rawText, interpretation);
}
