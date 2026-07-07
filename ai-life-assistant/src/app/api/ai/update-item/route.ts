import { NextResponse } from "next/server";
import { applyItemUpdatePlan, normalizeItemUpdatePlan, type ItemUpdatePlan } from "@/lib/assistant/itemUpdate";
import { canUseAgentPlan, requestValidatedAgentPlanJson, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import type { AssistantCheckIn, AssistantItemRef, AssistantState } from "@/types/domain";

export const runtime = "nodejs";

type UpdateItemRequest = {
  rawText?: string;
  inputType?: "text" | "voice";
  model?: string;
  state?: AssistantState;
  target?: AssistantItemRef;
};

const SYSTEM_PROMPT = `
你是一个个人生活助理。用户正在通过对话修改一个已经存在的指定事项。

只输出 JSON，不要 Markdown，不要解释。JSON 格式：
{
  "title": "可选：新标题",
  "dueAt": "可选：新的 ISO 8601 时间",
  "completed": false,
  "deleted": false,
  "relatedCheckIns": [
    {
      "create": false,
      "id": "关联提醒 id",
      "matchText": "可选：用于匹配提醒标题或问题的一小段原文",
      "title": "可选：新的提醒标题",
      "question": "可选：新的提醒问题",
      "askAt": "可选：新的 ISO 8601 提醒时间",
      "status": "pending|answered|dismissed"
    }
  ],
  "feedback": { "title": "短标题", "detail": "简短反馈", "question": "可选追问" }
}

规则：
- 只修改给定 target 及其 relatedCheckIns，不要新增主事项。
- 当 target 是主事项时，payload.currentItem.relatedCheckIns 包含它下面全部提醒/确认项；用户说“高铁票那个”“行李提醒”“餐馆订位”时，应根据这些上下文更新对应 relatedCheckIns。
- relatedCheckIns.status 与网页状态一致：pending 表示待完成，answered 表示已完成，dismissed 表示已删除/隐藏。
- 如果用户更新的是 target 下面已有提醒的一部分，请改 relatedCheckIns，不要反问是否新增提醒。
- 例如已有提醒同时追踪多个准备项，用户确认其中一部分已完成、另一部分未完成，应保留该提醒为 pending，并把 question 改成只提醒未完成部分。
- 不同确认项必须拆成不同 relatedCheckIns。例如高铁票、行李、餐馆订位要分别输出 3 个提醒，不能合并成一个 question。
- 如果用户要求往已有提醒里增加新的准备项或确认项，可以输出 {"create": true, "title": "...", "question": "...", "askAt": "..."} 来创建新的关联提醒。
- 如果需要把一个合并提醒拆开，应先把旧合并提醒 status 设为 dismissed，再用 create:true 创建每个独立提醒。
- 如果 target 本身就是一个合并提醒，也可以把 target 这条提醒 status 设为 dismissed，并用 create:true 创建同一父事项下的多个独立提醒。
- 当用户明确表示“照常提醒/到时候提醒”且已有 relatedCheckIns 可更新时，feedback.question 应省略。
- 如果用户明确说关联提醒里的所有事项都完成了，可以把对应 relatedCheckIns.status 设为 answered。
- 不要因为关联提醒的一部分完成了，就把整个 target 的 completed 设为 true。
- 用户明确说完成、做完、搞定、已完成时，completed 为 true。
- 用户明确说删除、取消、不用了、不要了时，deleted 为 true。
- 用户说“改到/移到/推迟到/提前到”时，优先输出 dueAt。
- 用户说“改成/改为/重命名为”时，输出 title。
- 无法确定的字段请省略，不要猜。
- 时间必须使用 ISO 8601。日期相对词要基于 now 解析。
- 如果 payload.validation.errors 存在，说明上一轮 JSON 没有通过本地完整性校验；必须修正 errors 指出的缺失，并重新输出完整 JSON。
`.trim();

function isValidRequest(body: unknown): body is UpdateItemRequest {
  return Boolean(body) && typeof body === "object";
}

function relatedTypeForTarget(target: AssistantItemRef) {
  if (target.kind === "life_event") return "life_event";
  if (target.kind === "shopping_item") return "shopping_item";
  if (target.kind === "task") return "task";
  return undefined;
}

function relatedCheckInsForTarget(state: AssistantState, target: AssistantItemRef) {
  if (target.kind === "check_in") {
    return state.checkIns.filter((checkIn) => checkIn.id === target.id && checkIn.status !== "dismissed");
  }
  const relatedType = relatedTypeForTarget(target);
  return state.checkIns.filter(
    (checkIn) => checkIn.relatedId === target.id && checkIn.status !== "dismissed" && checkIn.relatedType === relatedType
  );
}

function summarizeRelatedCheckIns(checkIns: AssistantCheckIn[]) {
  return checkIns.map((checkIn) => ({
    id: checkIn.id,
    title: checkIn.title,
    question: checkIn.question,
    relatedType: checkIn.relatedType,
    askAt: checkIn.askAt,
    status: checkIn.status
  }));
}

function summarizeTargetState(state: AssistantState, target: AssistantItemRef) {
  const relatedCheckIns = summarizeRelatedCheckIns(relatedCheckInsForTarget(state, target));
  if (target.kind === "task") return { item: state.tasks.find((task) => task.id === target.id), relatedCheckIns };
  if (target.kind === "life_event") return { item: state.lifeEvents.find((event) => event.id === target.id), relatedCheckIns };
  if (target.kind === "shopping_item") return { item: state.shoppingItems.find((item) => item.id === target.id), relatedCheckIns };
  return { item: state.checkIns.find((checkIn) => checkIn.id === target.id), relatedCheckIns };
}

function inputRequestsTicketReminder(text: string) {
  return (
    /(额外|还是|正常|照常|到时候|提醒).*(订|买).*(高铁票|车票|票|票务)/.test(text) ||
    /(订|买).*(高铁票|车票|票|票务).*(额外|还是|正常|照常|到时候|提醒)/.test(text)
  );
}

function inputConfirmsTicketButLeavesLuggage(text: string) {
  const ticketDone =
    /(高铁票|车票|票).*(订好|买好|订了|买了|已订|已买|已经订|已经买)/.test(text) ||
    /(订好|买好|订了|买了|已订|已买|已经订|已经买).*(高铁票|车票|票)/.test(text);
  const luggagePending =
    /行李.*(还没|没|未|没有).*收拾/.test(text) ||
    /(还没|没|未|没有).*收拾.*行李/.test(text);
  return ticketDone && luggagePending;
}

const travelPrepCategories = [
  {
    key: "ticket",
    pattern: /高铁票|车票|火车票|机票|订票|买票|票务|高铁|往返/,
    title: "确认高铁票"
  },
  {
    key: "luggage",
    pattern: /行李|收拾/,
    title: "收拾行李"
  },
  {
    key: "restaurant",
    pattern: /餐馆|餐厅|饭店|餐位|订位|定位置|订位置|定座|订座|定座位|订座位/,
    title: "预订餐馆位置"
  }
] as const;

function travelPrepCategoriesIn(text: string) {
  return travelPrepCategories.filter((category) => category.pattern.test(text));
}

function updateMatchesCheckIn(update: NonNullable<ItemUpdatePlan["relatedCheckIns"]>[number], checkIn: AssistantCheckIn) {
  if (update.id && update.id === checkIn.id) return true;
  if (!update.matchText) return false;
  return `${checkIn.title} ${checkIn.question}`.includes(update.matchText);
}

function plannedUpdateText(update: NonNullable<ItemUpdatePlan["relatedCheckIns"]>[number], relatedCheckIns: AssistantCheckIn[]) {
  const matched = relatedCheckIns.find((checkIn) => updateMatchesCheckIn(update, checkIn));
  return [update.title, update.question, matched?.title, matched?.question].filter(Boolean).join(" ");
}

function updateContainsOnlyCategory(
  update: NonNullable<ItemUpdatePlan["relatedCheckIns"]>[number],
  relatedCheckIns: AssistantCheckIn[],
  category: (typeof travelPrepCategories)[number]
) {
  const text = plannedUpdateText(update, relatedCheckIns);
  if (!category.pattern.test(text)) return false;
  return travelPrepCategoriesIn(text).length === 1;
}

function isCombinedTravelPrepCheckIn(checkIn: AssistantCheckIn) {
  return travelPrepCategoriesIn(`${checkIn.title} ${checkIn.question}`).length > 1;
}

function updateDismissesCheckIn(update: NonNullable<ItemUpdatePlan["relatedCheckIns"]>[number], checkIn: AssistantCheckIn) {
  return update.status === "dismissed" && updateMatchesCheckIn(update, checkIn);
}

function plannedQuestionForCheckIn(
  plan: ItemUpdatePlan,
  relatedCheckIns: AssistantCheckIn[],
  pattern: RegExp
) {
  const updates = plan.relatedCheckIns ?? [];
  return updates
    .filter((update) => {
      if (update.question && pattern.test(update.question)) return true;
      const matched = relatedCheckIns.find((checkIn) => updateMatchesCheckIn(update, checkIn));
      return Boolean(matched && pattern.test(matched.question));
    })
    .map((update) => {
      const matched = relatedCheckIns.find((checkIn) => updateMatchesCheckIn(update, checkIn));
      return update.question ?? matched?.question ?? "";
    })
    .join(" ");
}

function validateItemUpdatePlan({
  rawText,
  state,
  target,
  plan
}: {
  rawText: string;
  state: AssistantState;
  target: AssistantItemRef;
  plan: ItemUpdatePlan;
}) {
  const errors: string[] = [];
  const relatedCheckIns = relatedCheckInsForTarget(state, target);
  const relatedUpdates = plan.relatedCheckIns ?? [];

  if (target.kind === "life_event" && inputRequestsTicketReminder(rawText) && relatedCheckIns.length > 0) {
    const ticketQuestion = plannedQuestionForCheckIn(plan, relatedCheckIns, /高铁票|车票|订票|买票|票务/);
    if (!relatedUpdates.length) {
      errors.push("用户要求额外提醒订票，但输出缺少 relatedCheckIns 更新。");
    } else if (!ticketQuestion) {
      errors.push("用户要求额外提醒订票，但 relatedCheckIns.question 没有包含高铁票/订票/票务。");
    }
    if (plan.feedback?.question) {
      errors.push("已有关联提醒可更新时，不应再反问是否添加提醒。");
    }
  }

  if (target.kind === "life_event" && inputConfirmsTicketButLeavesLuggage(rawText) && relatedCheckIns.length > 0) {
    const luggageQuestion = plannedQuestionForCheckIn(plan, relatedCheckIns, /行李/);
    if (!relatedUpdates.length) {
      errors.push("用户更新了行前确认的部分状态，但输出缺少 relatedCheckIns 更新。");
    } else if (!luggageQuestion || /高铁票|车票|订票|买票|票务/.test(luggageQuestion)) {
      errors.push("用户已确认票务完成且行李未完成，relatedCheckIns.question 应只保留行李提醒。");
    }
    if (plan.completed) {
      errors.push("不能因为行前确认的一部分完成就把整个行程标记完成。");
    }
  }

  const canUpdateTravelPrep =
    target.kind === "life_event" ||
    (target.kind === "check_in" && relatedCheckIns.some((checkIn) => checkIn.relatedType === "life_event"));
  const requestedPrepCategories = canUpdateTravelPrep ? travelPrepCategoriesIn(rawText) : [];
  relatedUpdates
    .filter((update) => update.create && (!update.title || !update.question || !update.askAt))
    .forEach(() => {
      errors.push("create:true 的 relatedCheckIns 必须包含 title、question 和 askAt，不能依赖本地默认值。");
    });
  if (requestedPrepCategories.length > 1) {
    requestedPrepCategories.forEach((category) => {
      const hasSeparateUpdate = relatedUpdates.some((update) => updateContainsOnlyCategory(update, relatedCheckIns, category));
      if (!hasSeparateUpdate) {
        errors.push(`用户提到“${category.title}”，必须作为独立 relatedCheckIns 输出，不能和其他确认项合并在同一个 question。`);
      }
    });
    const combinedPrepCheckIns = relatedCheckIns.filter(isCombinedTravelPrepCheckIn);
    if (combinedPrepCheckIns.length) {
      const dismissesCombinedPrep =
        (target.kind === "check_in" && plan.deleted && combinedPrepCheckIns.some((checkIn) => checkIn.id === target.id)) ||
        combinedPrepCheckIns.some((checkIn) => relatedUpdates.some((update) => updateDismissesCheckIn(update, checkIn)));
      if (!dismissesCombinedPrep) {
        errors.push("拆分合并行前提醒时，必须明确把旧合并提醒 status 设为 dismissed 或删除当前合并提醒。");
      }
    }
  }

  return errors;
}

async function requestUpdatePlan(
  body: Required<Pick<UpdateItemRequest, "rawText" | "state" | "target">> & UpdateItemRequest
) {
  const userPayload = {
    now: new Date().toISOString(),
    rawText: body.rawText,
    inputType: body.inputType === "voice" ? "voice" : "text",
    target: body.target,
    currentItem: summarizeTargetState(body.state, body.target)
  };

  return requestValidatedAgentPlanJson({
    model: resolveAgentPlanLanguageModel(body.model),
    systemPrompt: SYSTEM_PROMPT,
    payload: userPayload,
    temperature: 0.1,
    stageName: "Agent Plan item update",
    normalize: normalizeItemUpdatePlan,
    validate: (plan) =>
      validateItemUpdatePlan({
        rawText: body.rawText,
        state: body.state,
        target: body.target,
        plan
      })
  });
}

async function planWithAgentPlan(body: Required<Pick<UpdateItemRequest, "rawText" | "state" | "target">> & UpdateItemRequest) {
  return requestUpdatePlan(body);
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidRequest(body) || typeof body.rawText !== "string" || !body.state || !body.target) {
    return NextResponse.json({ error: "rawText, state, and target are required." }, { status: 400 });
  }

  const inputType = body.inputType === "voice" ? "voice" : "text";

  if (!canUseAgentPlan()) {
    return NextResponse.json({ error: "AI 修改服务未配置，无法保存这次更新。" }, { status: 503 });
  }

  try {
    const plan = await planWithAgentPlan({
      rawText: body.rawText,
      inputType,
      state: body.state,
      target: body.target,
      model: body.model
    });
    const result = applyItemUpdatePlan(body.state, body.target, body.rawText, inputType, plan);
    return NextResponse.json({
      ...result,
      provider: "volcengine_agent_plan_runtime",
      model: resolveAgentPlanLanguageModel(body.model)
    });
  } catch (error) {
    console.warn("Agent Plan item update failed.", error);
    return NextResponse.json({ error: "AI 修改失败，未保存这次更新。请稍后重试。" }, { status: 502 });
  }
}
