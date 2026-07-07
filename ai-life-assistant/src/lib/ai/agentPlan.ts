import {
  normalizeAiInterpretation,
  validateActionArraySchema,
  validateAiInterpretationSchema,
  type AiInterpretation,
  type InterpretAction
} from "@/lib/ai/interpretation";
import { defaultAgentPlanLanguageModel, isAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import { selectRelevantMemories } from "@/lib/memory/selectRelevantMemories";
import { DEFAULT_TIMEZONE } from "@/lib/time/parseTime";
import type { AiProcessingUpdate, AssistantState, MemoryContext, TranscriptRepair } from "@/types/domain";

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
  thinking?: { type: "disabled" | "enabled" };
};

type IntentUnderstanding = {
  feedback: AiInterpretation["feedback"];
  actions: InterpretAction[];
  memoryCandidates: unknown[];
  proactiveCheckins: unknown[];
};

type CoverageReview = {
  coverage: "complete" | "incomplete";
  missingIntents: string[];
  revisedActions: InterpretAction[];
  memoryCandidates: unknown[];
  proactiveCheckins: unknown[];
};

type ProgressReporter = (update: AiProcessingUpdate) => void;

const ACTION_SCHEMA = `
可用 action JSON schema：
{
  "actions": [
    { "type": "add_task", "ref": "可选内部引用", "title": "...", "horizon": "today|this_week|later", "dueAt": "ISO 时间", "priority": "low|medium|high", "energyRequired": "low|medium|high" },
    { "type": "add_shopping_item", "ref": "可选内部引用", "itemName": "...", "status": "needed|ordered|bought", "expectedAt": "ISO 时间", "createTask": true },
    { "type": "update_shopping_status", "itemName": "...", "status": "ordered|bought", "expectedAt": "ISO 时间" },
    { "type": "add_life_event", "ref": "trip", "title": "...", "description": "可选：相关细节", "category": "travel|class|appointment|household|outing|other", "startsAt": "ISO 时间", "location": "...", "priority": "low|medium|high" },
    { "type": "add_check_in", "title": "...", "question": "...", "relatedType": "life_event|shopping_item|task|project", "relatedRef": "trip", "askAt": "ISO 时间" },
    { "type": "add_mood_log", "moodLabel": "...", "energyLevel": "low|medium|high", "note": "..." },
    { "type": "mark_task_done", "matchTitle": "..." }
  ]
}
`.trim();

const UNDERSTANDING_PROMPT = `
你是用户的 AI 秘书。第一步只负责“完整理解用户输入”，不要做最终产品合并。

重要规则：
- 用户一句话里可能包含多个意图，必须逐一覆盖。
- 不要只保留最后一个、最明显的、或最容易解析的意图。
- 对每个意图判断它属于：待办、日程、购物、提醒、追问、长期记忆。
- 如果信息不足，不要猜；生成 add_check_in 或在 feedback.question 中追问。
- 这一阶段可以保留较细粒度动作；是否合并成一个主活动由第三步决定。
- 如果 payload.validation.errors 存在，说明上一轮 JSON 没有通过本地完整性校验；必须修正 errors 指出的缺失，并重新输出完整 JSON。
- 输出必须是 JSON，不要 Markdown，不要解释。

输出 JSON：
{
  "feedback": {
    "title": "短标题",
    "detail": "说明识别出了哪些意图",
    "question": "可选追问"
  },
  "actions": [],
  "memory_candidates": [],
  "proactive_checkins": []
}

${ACTION_SCHEMA}
`.trim();

const COVERAGE_PROMPT = `
你是 AI 秘书的覆盖率检查员。你的任务是检查第一步结果有没有漏掉 rawText 中的任何生活管理意图。

规则：
- 请检查 rawText 中的每个意图是否都被 actions 覆盖。
- 如果有遗漏，指出遗漏，并补充 actions。
- 不要删除已有正确 action。
- 不要做最终产品合并；这一阶段只负责“没有遗漏”。
- 如果信息不足，不要猜具体时间；补充 add_check_in 或在遗漏说明中指出需要追问。
- 如果 payload.validation.errors 存在，说明上一轮 JSON 没有通过本地完整性校验；必须修正 errors 指出的缺失，并重新输出完整 JSON。
- 输出必须是 JSON，不要 Markdown，不要解释。

输出 JSON：
{
  "coverage": "complete|incomplete",
  "missing_intents": [],
  "revised_actions": [],
  "memory_candidates": [],
  "proactive_checkins": []
}

${ACTION_SCHEMA}
`.trim();

const PLANNING_PROMPT = `
你是面向个人生活管理产品的 AI 秘书规划器。你不会重新发现意图；你只把已经覆盖完整的理解结果，整理成产品最终要保存的结构化动作。

必须只输出 JSON，不要 Markdown，不要解释。JSON 格式：
{
  "feedback": { "title": "短标题", "detail": "给用户看的简短反馈", "question": "可选追问" },
  "actions": [],
  "memoryWrites": [
    {
      "type": "household|preference|recurring_pattern|travel_habit|weather_preference|assistant_behavior|open_loop",
      "summary": "简洁长期记忆，80字以内",
      "tags": ["用于本地召回的关键词"],
      "entities": ["牛奶|苏州|孩子等实体"],
      "confidence": 0.0,
      "sensitivity": "low|medium|high",
      "requiresConfirmation": true,
      "evidence": "本次输入中支持这条记忆的证据"
    }
  ]
}

${ACTION_SCHEMA}

产品行为规则：
- 一个真实生活活动只生成一个主活动，不要把同一件事拆成多个并列待办。例如“周日去上海，在上海吃晚饭，准备高铁往返”是一个上海出行/吃饭活动，而不是“去上海”“在上海吃饭”“订高铁票”三个主事项。
- 与主活动强相关的提醒、确认、准备项，优先生成 add_check_in，并用 relatedRef 挂到主活动或主待办下面；不要作为并列 add_task 展示。
- 不同确认项必须拆成不同 add_check_in。例如高铁票、收拾行李、餐馆订位是 3 个独立确认项，不能合并成“高铁票订好了吗？行李收拾好了吗？餐馆订位了吗？”一个问题。
- “提醒我……”“到时候提醒我……”如果依赖某个未来活动，必须是 add_check_in；askAt 设在活动前一晚 20:00，除非用户明确给出提醒时间。
- 多天连续安排要合并成一个主事项。例如“周四和周五请假”只生成一个“申请周四和周五请假”待办，不要拆成周四/周五两个待办。
- 请假、报备、和老板沟通这类准备提醒，应作为主请假待办下面的 add_check_in。
- 用户说需要买某物：新增购物项，并创建一个今日待办。
- 用户说已经买好或已下单某物：更新购物状态，不要再创建购买待办。
- 用户提到出行：新增一个 life_event；把订票、行李、酒店、路线、餐馆订位等分别生成独立 check-in，挂在同一个 life_event 下。
- 用户提到孩子兴趣班但缺持续时间：生成 check-in 追问持续多久和提前多久出门。
- 用户表达疲惫、压力或低能量：添加 mood log，并降低反馈语气压力。
- 只在用户明确表达完成/买好/下单时使用 mark 或 update。
- priority 用于 add_task 和 add_life_event，不用于 check-in。high 表示有明确后果、外部承诺、需要他人配合、阻塞后续安排或用户明确说“重要/必须/尽快”；medium 表示正常计划内事项或有时间但后果不强；low 表示可选、顺手、无明确截止或用户表达“不急”。不要仅因为有 dueAt/startsAt 就设为 high。
- 时间必须用 ISO 8601；无法确定具体时间时必须省略 dueAt/startsAt，并用 feedback.question 或 add_check_in 向用户澄清。
- 不要编造 7:59、2:00、3:00 这类没有来源的时间。推断时间只能使用自然默认值：上午 9:00、下午 17:00、晚上 20:00、睡前提醒 21:30-22:30；否则省略。
- “今天12点前睡觉”如果没有“中午/今晚/凌晨/24点/零点”等上下文，语义不清晰。不要默认中午 12 点；生成今日睡觉目标，并立刻追问用户希望几点睡、几点提醒。确认前不要设置具体 dueAt。
- 第一、二步中出现的每个意图必须在最终结构中被保留：可以合并成主活动或附属 check-in，但不能消失。
- memory_candidates 当前只作为理解上下文，不要伪造成无意义待办；如果对当下有主动提醒价值，可生成 add_check_in。
- memoryContext 是经过本地压缩和筛选的长期记忆，只是候选背景。只有与当前输入相关时才使用，不要逐字复述，不要过度推断。
- 如果发现新的长期事实、偏好、重复模式或未闭环事项，请输出 memoryWrites。只保存未来有行动价值的记忆，不要保存流水账。
- recurring、自动提醒偏好、家庭习惯、出行习惯、天气提醒偏好默认 requiresConfirmation: true。
- 低风险且明确的事实可以 requiresConfirmation: false，例如“用户家里有多个孩子”，但 summary 仍要简洁。
- memoryContext.pendingConfirmations 里的内容尚未经过用户确认，不能当作事实使用；只可用于避免重复提出同一条记忆确认。
- feedback.detail 要概括本次识别出的事项数量或主要类型，避免只提其中一个事项。
- 如果 payload.validation.errors 存在，说明上一轮 JSON 没有通过本地完整性校验；必须修正 errors 指出的缺失，并把修正写进 actions，不要只修改 feedback 文案。
- 不要输出 id，后端会生成。

示例：
用户：“我今天想做到12点前睡觉，然后我这周四和周五希望请假，提醒我提前和老板说，然后我周日晚上计划去上海，在上海吃个晚饭，准备高铁往返，到时候提醒我要去订高铁票。”
正确结构：一个今日睡觉目标 + 一个澄清睡觉提醒时间的 check-in；一个“申请周四和周五请假”待办 + 一个老板沟通 check-in；一个“周日晚上去上海吃晚饭” life_event + 一个“确认高铁票” check-in。若还提到行李或餐馆订位，分别再生成“收拾行李”“预订餐馆位置” check-in。不要把上海拆成多个主待办，不要把周四/周五请假拆成两个待办。
`.trim();

const TRANSCRIPT_REPAIR_PROMPT = `
你是中文语音转写校准器，只负责把 ASR 原始转写修正成适合展示给用户和后续理解的文本。

重要规则：
- 你不是待办解析器，不要生成待办、日程或提醒。
- 只修正高概率语音识别错误、断句、重复、错序和标点；不要新增用户没说过的事实。
- 必须保留原文中的每个生活意图，不要为了通顺删掉半句话。
- 不要替用户消除真实语义歧义。例如“今天12点前睡觉”不能改成“今晚24:00前睡觉”，除非原始转写明确有“今晚/24点/零点”等信息。
- 如果修正后仍有关键歧义，transcript 放最佳修正版，needsUserConfirmation 设为 true，并给出一句用户能直接回答的问题。
- 如果只是时间语义本身需要产品追问，不代表转写失败。比如“今天12点前睡觉”本身可以 confidence 较高，但后续规划阶段仍会追问中午还是今晚。
- 如果 payload.validation.errors 存在，说明上一轮 JSON 没有通过本地完整性校验；必须修正 errors 指出的缺失，并重新输出完整 JSON。
- 输出必须是 JSON，不要 Markdown，不要解释。

输出 JSON：
{
  "transcript": "修正后的正式用户消息",
  "confidence": 0.0,
  "needsUserConfirmation": false,
  "question": "可选，只有关键内容不确定时填写",
  "repairs": [
    { "from": "原片段", "to": "修正片段", "reason": "简短原因" }
  ]
}
`.trim();

function configured() {
  return (
    process.env.AI_PROVIDER === "volcengine_agent_plan_runtime" &&
    process.env.ALLOW_AGENT_PLAN_RUNTIME === "true" &&
    process.env.AI_PARSE_ENABLED !== "false" &&
    Boolean(process.env.ARK_AGENT_PLAN_API_KEY)
  );
}

function runtimeTimezone() {
  return process.env.ASSISTANT_TIMEZONE || DEFAULT_TIMEZONE;
}

function timezoneForState(state: AssistantState) {
  return state.preferences.timezone || runtimeTimezone();
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
      priority: event.priority,
      status: event.status
    })),
    checkIns: state.checkIns.slice(0, 12).map((checkIn) => ({
      id: checkIn.id,
      title: checkIn.title,
      question: checkIn.question,
      relatedType: checkIn.relatedType,
      relatedId: checkIn.relatedId,
      askAt: checkIn.askAt,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function rawArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readArray(record: Record<string, unknown>, snakeKey: string, camelKey: string) {
  return rawArray(record[snakeKey] ?? record[camelKey]);
}

function normalizeActionArray(value: unknown) {
  return normalizeAiInterpretation({
    feedback: { title: "中间结果", detail: "中间结果" },
    actions: rawArray(value)
  })?.actions ?? [];
}

function normalizeIntentUnderstanding(value: unknown): IntentUnderstanding | null {
  if (!isRecord(value)) return null;
  const interpretation = normalizeAiInterpretation(value);
  if (!interpretation) return null;

  return {
    feedback: interpretation.feedback,
    actions: interpretation.actions,
    memoryCandidates: readArray(value, "memory_candidates", "memoryCandidates"),
    proactiveCheckins: readArray(value, "proactive_checkins", "proactiveCheckins")
  };
}

function normalizeCoverageReview(value: unknown): CoverageReview | null {
  if (!isRecord(value)) return null;
  const missingIntents = stringArray(value.missing_intents ?? value.missingIntents);
  const revisedSource = value.revised_actions ?? value.revisedActions ?? value.actions;
  const revisedActions = revisedSource ? normalizeActionArray(revisedSource) : [];
  const coverage = optionalString(value.coverage) === "complete" && missingIntents.length === 0 ? "complete" : "incomplete";

  return {
    coverage,
    missingIntents,
    revisedActions,
    memoryCandidates: readArray(value, "memory_candidates", "memoryCandidates"),
    proactiveCheckins: readArray(value, "proactive_checkins", "proactiveCheckins")
  };
}

function normalizeTranscriptRepair(value: unknown, rawTranscript: string): TranscriptRepair | null {
  if (!isRecord(value)) return null;

  const transcript = optionalString(value.transcript);
  const confidenceValue = optionalNumber(value.confidence);
  if (!transcript || confidenceValue === undefined) return null;
  const needsUserConfirmation =
    typeof value.needsUserConfirmation === "boolean"
      ? value.needsUserConfirmation
      : typeof value.needs_user_confirmation === "boolean"
        ? value.needs_user_confirmation
        : undefined;
  if (needsUserConfirmation === undefined || !Array.isArray(value.repairs)) return null;

  const confidence = Math.max(0, Math.min(1, confidenceValue));
  const repairs = rawArray(value.repairs)
    .filter(isRecord)
    .map((repair) => ({
      from: optionalString(repair.from),
      to: optionalString(repair.to),
      reason: optionalString(repair.reason) ?? "语音转写校准"
    }))
    .slice(0, 12);

  return {
    rawTranscript,
    transcript,
    confidence,
    needsUserConfirmation,
    question: optionalString(value.question),
    repairs
  };
}

async function requestAgentPlanJson({
  model,
  systemPrompt,
  payload,
  temperature = 0.2
}: {
  model: string;
  systemPrompt: string;
  payload: unknown;
  temperature?: number;
}) {
  const response = await requestAgentPlanChatCompletion({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) }
    ],
    temperature,
    response_format: { type: "json_object" }
  });
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Agent Plan returned an empty response.");
  }
  return parseJsonObject(content);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withValidationPayload(payload: unknown, errors: string[], previousResult: unknown) {
  const validation = {
    errors,
    previous_result: previousResult
  };
  return isRecord(payload) ? { ...payload, validation } : { input: payload, validation };
}

export async function requestValidatedAgentPlanJson<T>({
  model,
  systemPrompt,
  payload,
  temperature = 0.2,
  stageName,
  normalize,
  validate = () => []
}: {
  model: string;
  systemPrompt: string;
  payload: unknown;
  temperature?: number;
  stageName: string;
  normalize: (value: unknown) => T | null;
  validate?: (value: T, raw: unknown) => string[];
}) {
  async function run(attemptPayload: unknown, attemptTemperature: number) {
    try {
      const raw = await requestAgentPlanJson({
        model,
        systemPrompt,
        payload: attemptPayload,
        temperature: attemptTemperature
      });
      const value = normalize(raw);
      if (!value) {
        return {
          raw,
          value: null,
          errors: [`${stageName} 输出不符合预期 JSON schema。`]
        };
      }
      return {
        raw,
        value,
        errors: validate(value, raw)
      };
    } catch (error) {
      return {
        raw: undefined,
        value: null,
        errors: [`${stageName} 输出无法解析：${errorMessage(error)}`]
      };
    }
  }

  const first = await run(payload, temperature);
  if (first.value && !first.errors.length) return first.value;

  const retry = await run(withValidationPayload(payload, first.errors, first.raw), 0);
  if (retry.value && !retry.errors.length) return retry.value;

  throw new Error(`${stageName} failed validation: ${retry.errors.join(" ")}`);
}

export async function repairTranscriptWithAgentPlan({
  rawTranscript,
  model
}: {
  rawTranscript: string;
  model?: string;
}): Promise<TranscriptRepair> {
  if (!configured()) {
    throw new Error("Agent Plan transcript repair runtime is not configured.");
  }

  const trimmed = rawTranscript.trim();
  if (!trimmed) {
    return {
      rawTranscript,
      transcript: "",
      confidence: 0,
      needsUserConfirmation: true,
      question: "我没有听清刚才的内容，可以再说一遍吗？",
      repairs: []
    };
  }

  return requestValidatedAgentPlanJson({
    model: resolveAgentPlanLanguageModel(model),
    systemPrompt: TRANSCRIPT_REPAIR_PROMPT,
    payload: {
      now: new Date().toISOString(),
      localNow: localNowText(runtimeTimezone()),
      timezone: runtimeTimezone(),
      rawTranscript: trimmed
    },
    temperature: 0,
    stageName: "Agent Plan transcript repair",
    normalize: (value) => normalizeTranscriptRepair(value, trimmed),
    validate: (repair) => validateTranscriptRepair(trimmed, repair)
  });
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

function validateTranscriptRepair(rawTranscript: string, repair: TranscriptRepair) {
  const errors: string[] = [];
  if (!repair.transcript.trim()) {
    errors.push("transcript 不能为空。");
  }
  if (repair.confidence < 0 || repair.confidence > 1) {
    errors.push("confidence 必须在 0 到 1 之间。");
  }
  if (repair.needsUserConfirmation && !repair.question?.trim()) {
    errors.push("needsUserConfirmation 为 true 时必须提供 question。");
  }
  if (rawTranscript.length >= 8 && repair.transcript.length < Math.max(4, rawTranscript.length * 0.35)) {
    errors.push("transcript 相比原始转写过短，可能丢失了用户意图。");
  }
  return errors;
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

function rawHasThursdayFridayLeave(rawText: string) {
  return /(周四|星期四)/.test(rawText) && /(周五|星期五)/.test(rawText) && /请假/.test(rawText);
}

function rawHasShanghaiTrip(rawText: string) {
  return /上海/.test(rawText) && /(周日|周天|星期日|星期天)/.test(rawText) && /(去|高铁|火车|往返|晚饭|吃饭|订票)/.test(rawText);
}

function rawHasSuzhouTrip(rawText: string) {
  return /苏州/.test(rawText) && /(去|出差|旅行|出行|周|星期|明天|后天)/.test(rawText);
}

function rawRequestsMilk(rawText: string) {
  return /牛奶/.test(rawText) && /(买|需要|没有|没了|缺|下单|订)/.test(rawText);
}

function rawHasKidsClass(rawText: string) {
  return /(孩子|小孩|儿子|女儿|兴趣班)/.test(rawText) && /兴趣班/.test(rawText);
}

function hasAction(actions: InterpretAction[], type: InterpretAction["type"], pattern: RegExp) {
  return actions.some((action) => action.type === type && pattern.test(actionText(action)));
}

function hasRelatedCheckIn(actions: InterpretAction[], pattern: RegExp, relatedType?: "task" | "shopping_item" | "life_event" | "project") {
  return actions.some(
    (action) =>
      action.type === "add_check_in" &&
      (!relatedType || action.relatedType === relatedType) &&
      pattern.test(actionText(action))
  );
}

const travelPrepCategories = [
  {
    key: "ticket",
    pattern: /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返/,
    title: "确认高铁票",
    question: "高铁票订好了吗？"
  },
  {
    key: "luggage",
    pattern: /行李|收拾/,
    title: "收拾行李",
    question: "行李收拾好了吗？"
  },
  {
    key: "restaurant",
    pattern: /餐馆|餐厅|饭店|餐位|订位|定位置|订位置|定座|订座|定座位|订座位/,
    title: "预订餐馆位置",
    question: "餐馆位置订好了吗？"
  }
] as const;

function travelPrepCategoriesIn(text: string) {
  return travelPrepCategories.filter((category) => category.pattern.test(text));
}

function containsMultipleTravelPrepCategories(text: string) {
  return travelPrepCategoriesIn(text).length > 1;
}

function hasSeparateTravelPrepCheckIn(actions: InterpretAction[], pattern: RegExp) {
  return actions.some((action) => {
    if (action.type !== "add_check_in" || action.relatedType !== "life_event") return false;
    const text = actionText(action);
    return pattern.test(text) && !containsMultipleTravelPrepCategories(text);
  });
}

function sameRelatedAnchor(
  first: Extract<InterpretAction, { type: "add_check_in" }>,
  second: Extract<InterpretAction, { type: "add_check_in" }>
) {
  if (first.relatedRef || second.relatedRef) return first.relatedRef === second.relatedRef;
  if (first.relatedId || second.relatedId) return first.relatedId === second.relatedId;
  return first.relatedType === second.relatedType;
}

function splitCombinedTravelPrepCheckIns(interpretation: AiInterpretation): AiInterpretation {
  const actions: InterpretAction[] = [];

  for (const action of interpretation.actions) {
    if (action.type !== "add_check_in" || action.relatedType !== "life_event") {
      actions.push(action);
      continue;
    }

    const categories = travelPrepCategoriesIn(actionText(action));
    if (categories.length <= 1) {
      actions.push(action);
      continue;
    }

    categories.forEach((category) => {
      const hasExistingSeparate = interpretation.actions.some((other) => {
        if (other === action || other.type !== "add_check_in" || other.relatedType !== "life_event") return false;
        const text = actionText(other);
        return sameRelatedAnchor(action, other) && category.pattern.test(text) && !containsMultipleTravelPrepCategories(text);
      });
      if (hasExistingSeparate) return;
      actions.push({
        type: "add_check_in",
        title: category.title,
        question: category.question,
        relatedType: action.relatedType,
        relatedRef: action.relatedRef,
        relatedId: action.relatedId,
        askAt: action.askAt
      });
    });
  }

  return { ...interpretation, actions };
}

function rawActionSource(raw: unknown, key = "actions") {
  if (!isRecord(raw)) return [];
  return rawArray(raw[key]);
}

function validateNormalizedActionCount(raw: unknown, normalizedCount: number, key = "actions") {
  const source = rawActionSource(raw, key);
  if (!source.length) return [];
  const schemaErrors = validateActionArraySchema(source, key);
  if (schemaErrors.length) return schemaErrors;
  return source.length === normalizedCount
    ? []
    : [`${key} 中有 ${source.length - normalizedCount} 个 action 没有通过 schema 校验，不能被静默丢弃。`];
}

function validateCoreIntentCoverage(rawText: string, actions: InterpretAction[], feedbackQuestion?: string, finalStructure = false) {
  const errors: string[] = [];
  const combinedText = [feedbackQuestion, ...actions.map(actionText)].filter(Boolean).join(" ");

  if (rawHasAmbiguousSleepDeadline(rawText)) {
    const sleepTasks = actions.filter(
      (action): action is Extract<InterpretAction, { type: "add_task" }> =>
        action.type === "add_task" && /(睡觉|睡|上床|休息)/.test(actionText(action))
    );
    if (!sleepTasks.length) {
      errors.push("原文包含“今天12点前睡觉”意图，但最终 actions 缺少睡觉目标 add_task。");
    }
    if (sleepTasks.some((task) => Boolean(task.dueAt))) {
      errors.push("“今天12点前睡觉”语义不清，确认前睡觉目标不应写入具体 dueAt。");
    }
    if (!/(睡|休息|12点|十二点)/.test(combinedText) || !/(中午|今晚|24|几点|提醒)/.test(combinedText)) {
      errors.push("“今天12点前睡觉”需要在 feedback.question 或 add_check_in 中追问中午/今晚/提醒时间。");
    }
  }

  if (rawHasThursdayFridayLeave(rawText)) {
    const hasCombinedLeaveTask = actions.some((action) => {
      const text = actionText(action);
      return action.type === "add_task" && /请假/.test(text) && /周四|星期四|四/.test(text) && /周五|星期五|五/.test(text);
    });
    if (!hasCombinedLeaveTask) {
      errors.push("原文包含周四和周五请假，最终 actions 必须有一个覆盖两天的请假 add_task。");
    }
    const hasBossReminder = finalStructure
      ? hasRelatedCheckIn(actions, /老板|领导|请假|提前/, "task")
      : actions.some((action) => action.type === "add_check_in" && /老板|领导|请假|提前/.test(actionText(action)));
    if (/老板|领导|提前|提醒/.test(rawText) && !hasBossReminder) {
      errors.push(
        finalStructure
          ? "原文要求提醒提前和老板说，请假提醒必须作为 relatedType=task 的 add_check_in 返回。"
          : "原文要求提醒提前和老板说，actions 中必须覆盖老板沟通提醒。"
      );
    }
  }

  if (rawHasShanghaiTrip(rawText)) {
    if (finalStructure && !hasAction(actions, "add_life_event", /上海/)) {
      errors.push("原文包含周日去上海安排，最终 actions 缺少上海 life_event。");
    } else if (!finalStructure && !actions.some((action) => /上海/.test(actionText(action)))) {
      errors.push("原文包含上海安排，但 actions 中没有覆盖上海相关意图。");
    }
    const prepCheckInText = actions
      .filter((action) => action.type === "add_check_in" && action.relatedType === "life_event")
      .map(actionText)
      .join(" ");
    const shanghaiText = finalStructure ? prepCheckInText : combinedText;
    if (/(高铁|火车|车票|订票|买票|票务|往返)/.test(rawText) && !/(高铁|火车|车票|订票|买票|票务|票)/.test(shanghaiText)) {
      errors.push("上海行程提到票务/高铁，必须在 relatedType=life_event 的 add_check_in 中包含票务确认。");
    }
    if (/行李|收拾/.test(rawText) && !/行李|收拾/.test(shanghaiText)) {
      errors.push("上海行程提到行李，必须在 relatedType=life_event 的 add_check_in 中包含行李确认。");
    }
    const hasShanghaiPrepReminder = finalStructure
      ? hasRelatedCheckIn(actions, /上海|行前|高铁|火车|车票|票|行李|收拾/, "life_event")
      : actions.some((action) => /上海|行前|高铁|火车|车票|票|行李|收拾/.test(actionText(action)));
    if (/提醒|到时候|准备/.test(rawText) && !hasShanghaiPrepReminder) {
      errors.push(
        finalStructure
          ? "上海行程的准备提醒必须挂到 life_event 下面，不能作为并列主待办或只写在 feedback 里。"
          : "上海行程的准备提醒必须在 actions 中体现，不能只写在 feedback 里。"
      );
    }
    const requestedPrepCategories = travelPrepCategoriesIn(rawText);
    if (finalStructure && requestedPrepCategories.length > 1) {
      requestedPrepCategories.forEach((category) => {
        if (!hasSeparateTravelPrepCheckIn(actions, category.pattern)) {
          errors.push(`上海行程中的“${category.title}”必须是独立 relatedType=life_event 的 add_check_in，不能和其他确认项合并。`);
        }
      });
    }
  }

  if (rawHasSuzhouTrip(rawText) && !actions.some((action) => /苏州/.test(actionText(action)))) {
    errors.push("原文包含苏州出行安排，但 actions 中没有覆盖苏州相关意图。");
  }

  if (rawRequestsMilk(rawText) && !actions.some((action) => /牛奶/.test(actionText(action)))) {
    errors.push("原文包含牛奶购买/下单意图，但 actions 中没有覆盖牛奶。");
  }

  if (rawHasKidsClass(rawText)) {
    if (!actions.some((action) => /兴趣班/.test(actionText(action)))) {
      errors.push("原文包含孩子兴趣班安排，但 actions 中没有覆盖兴趣班。");
    }
    if (!/(持续|多久|结束|多长时间)/.test(rawText) && !/(持续|多久|结束|多长时间)/.test(combinedText)) {
      errors.push("孩子兴趣班缺少持续时间时，需要在 feedback.question 或 add_check_in 中追问持续多久。");
    }
  }

  return errors;
}

function validateUnderstanding(rawText: string, understanding: IntentUnderstanding, raw: unknown) {
  return [
    ...validateAiInterpretationSchema(raw),
    ...validateCoreIntentCoverage(rawText, understanding.actions, understanding.feedback.question)
  ];
}

function validateCoverage(rawText: string, coverage: CoverageReview, raw: unknown) {
  const revisedKey = isRecord(raw) && Array.isArray(raw.revised_actions)
    ? "revised_actions"
    : isRecord(raw) && Array.isArray(raw.revisedActions)
      ? "revisedActions"
      : "actions";
  const errors = [
    ...validateNormalizedActionCount(raw, coverage.revisedActions.length, revisedKey),
    ...validateCoreIntentCoverage(rawText, coverage.revisedActions)
  ];
  if (!isRecord(raw) || (!Array.isArray(raw.revised_actions) && !Array.isArray(raw.revisedActions))) {
    errors.push("revised_actions 必须返回完整 action 列表，不能省略或改名为其他字段。");
  }
  if (!coverage.revisedActions.length) {
    errors.push("revised_actions 必须返回完整 action 列表，不能省略。");
  }
  return errors;
}

function validateFinalInterpretation(rawText: string, interpretation: AiInterpretation, raw?: unknown) {
  return [
    ...(raw === undefined ? [] : validateAiInterpretationSchema(raw)),
    ...validateCoreIntentCoverage(rawText, interpretation.actions, interpretation.feedback.question, true)
  ];
}

function shouldRetryWithoutResponseFormat(status: number, bodyText: string) {
  return status === 400 && /response_format|json_object/i.test(bodyText) && /not supported|not valid|invalid/i.test(bodyText);
}

function shouldRetryWithoutThinking(status: number, bodyText: string) {
  return status === 400 && /thinking/i.test(bodyText) && /not supported|not valid|invalid|mismatch/i.test(bodyText);
}

function resolveThinkingConfig(): AgentPlanChatCompletionRequest["thinking"] {
  const explicit = process.env.ARK_AGENT_PLAN_THINKING;
  if (explicit === "disabled" || explicit === "enabled") return { type: explicit };
  if (process.env.ARK_AGENT_PLAN_DISABLE_THINKING === "true") return { type: "disabled" as const };
  return undefined;
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
  const thinking = requestBody.thinking ?? resolveThinkingConfig();
  const initialBody = thinking ? { ...requestBody, thinking } : requestBody;

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

  let currentBody = initialBody;
  let { response, text } = await post(currentBody);
  if (!response.ok && currentBody.response_format && shouldRetryWithoutResponseFormat(response.status, text)) {
    const { response_format: _responseFormat, ...retryBody } = currentBody;
    currentBody = retryBody;
    ({ response, text } = await post(retryBody));
  }
  if (!response.ok && currentBody.thinking && shouldRetryWithoutThinking(response.status, text)) {
    const { thinking: _thinking, ...retryBody } = currentBody;
    currentBody = retryBody;
    ({ response, text } = await post(retryBody));
  }

  if (!response.ok) {
    throw new Error(`Agent Plan request failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text) as AgentPlanChatCompletionResponse;
}

function localNowText(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "medium"
  }).format(new Date());
}

async function understandInputWithAgentPlan({
  rawText,
  inputType,
  state,
  model,
  now,
  timezone,
  memoryContext
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  model: string;
  now: string;
  timezone: string;
  memoryContext: MemoryContext;
}) {
  return requestValidatedAgentPlanJson({
    model,
    systemPrompt: UNDERSTANDING_PROMPT,
    payload: {
      now,
      localNow: localNowText(timezone),
      timezone,
      rawText,
      inputType,
      memoryContext,
      state: summarizeState(state)
    },
    temperature: 0.1,
    stageName: "Agent Plan understanding",
    normalize: normalizeIntentUnderstanding,
    validate: (understanding, raw) => validateUnderstanding(rawText, understanding, raw)
  });
}

async function checkCoverageWithAgentPlan({
  rawText,
  understanding,
  model,
  now,
  timezone,
  memoryContext
}: {
  rawText: string;
  understanding: IntentUnderstanding;
  model: string;
  now: string;
  timezone: string;
  memoryContext: MemoryContext;
}) {
  return requestValidatedAgentPlanJson({
    model,
    systemPrompt: COVERAGE_PROMPT,
    payload: {
      now,
      localNow: localNowText(timezone),
      timezone,
      rawText,
      memoryContext,
      feedback: understanding.feedback,
      actions: understanding.actions,
      memory_candidates: understanding.memoryCandidates,
      proactive_checkins: understanding.proactiveCheckins
    },
    temperature: 0.1,
    stageName: "Agent Plan coverage",
    normalize: normalizeCoverageReview,
    validate: (coverage, raw) => validateCoverage(rawText, coverage, raw)
  });
}

async function planFinalActionsWithAgentPlan({
  rawText,
  inputType,
  state,
  understanding,
  coverage,
  model,
  now,
  timezone,
  memoryContext
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  understanding: IntentUnderstanding;
  coverage: CoverageReview;
  model: string;
  now: string;
  timezone: string;
  memoryContext: MemoryContext;
}) {
  const payload = {
    now,
    localNow: localNowText(timezone),
    timezone,
    rawText,
    inputType,
    memoryContext,
    state: summarizeState(state),
    understanding: {
      feedback: understanding.feedback,
      actions: understanding.actions,
      memory_candidates: understanding.memoryCandidates,
      proactive_checkins: understanding.proactiveCheckins
    },
    coverage: {
      coverage: coverage.coverage,
      missing_intents: coverage.missingIntents,
      revised_actions: coverage.revisedActions,
      memory_candidates: coverage.memoryCandidates.length ? coverage.memoryCandidates : understanding.memoryCandidates,
      proactive_checkins: coverage.proactiveCheckins.length ? coverage.proactiveCheckins : understanding.proactiveCheckins
    }
  };

  return requestValidatedAgentPlanJson({
    model,
    systemPrompt: PLANNING_PROMPT,
    payload,
    temperature: 0.2,
    stageName: "Agent Plan planning",
    normalize: (value) => {
      const interpretation = normalizeAiInterpretation(value);
      return interpretation ? splitCombinedTravelPrepCheckIns(interpretation) : null;
    },
    validate: (interpretation, raw) => validateFinalInterpretation(rawText, interpretation, raw)
  });
}

export async function interpretWithAgentPlan({
  rawText,
  inputType,
  state,
  model,
  onProgress
}: {
  rawText: string;
  inputType: "text" | "voice";
  state: AssistantState;
  model?: string;
  onProgress?: ProgressReporter;
}): Promise<AiInterpretation> {
  if (!configured()) {
    throw new Error("Agent Plan runtime is not configured.");
  }

  const modelId = resolveAgentPlanLanguageModel(model);
  const now = new Date().toISOString();
  const timezone = timezoneForState(state);
  const memoryContext = selectRelevantMemories(rawText, state);
  onProgress?.({
    stage: "understanding",
    status: "active",
    title: "理解原文",
    detail: "正在拆解你说到的每件事。"
  });
  const understanding = await understandInputWithAgentPlan({
    rawText,
    inputType,
    state,
    model: modelId,
    now,
    timezone,
    memoryContext
  });
  onProgress?.({
    stage: "understanding",
    status: "complete",
    title: "理解原文",
    detail: "已完成原文理解。"
  });

  onProgress?.({
    stage: "coverage",
    status: "active",
    title: "检查遗漏",
    detail: "正在确认没有漏掉前半句、日期或提醒。"
  });
  const coverage = await checkCoverageWithAgentPlan({ rawText, understanding, model: modelId, now, timezone, memoryContext });
  onProgress?.({
    stage: "coverage",
    status: coverage.coverage === "complete" ? "complete" : "attention",
    title: "检查遗漏",
    detail: coverage.missingIntents.length
      ? `补上了 ${coverage.missingIntents.length} 个遗漏意图。`
      : "没有发现遗漏。"
  });

  onProgress?.({
    stage: "planning",
    status: "active",
    title: "整理事项",
    detail: "正在合并主活动，并把提醒挂到合适的位置。"
  });
  const interpretation = await planFinalActionsWithAgentPlan({
    rawText,
    inputType,
    state,
    understanding,
    coverage,
    model: modelId,
    now,
    timezone,
    memoryContext
  });
  onProgress?.({
    stage: "planning",
    status: "complete",
    title: "整理事项",
    detail: "已生成待办、活动和附属提醒。"
  });

  return interpretation;
}
