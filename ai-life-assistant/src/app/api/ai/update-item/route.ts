import { NextResponse } from "next/server";
import { applyItemUpdatePlan, normalizeItemUpdatePlan } from "@/lib/assistant/itemUpdate";
import { canUseAgentPlan, requestAgentPlanChatCompletion, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import type { AssistantItemRef, AssistantState } from "@/types/domain";

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
  "feedback": { "title": "短标题", "detail": "简短反馈", "question": "可选追问" }
}

规则：
- 只修改给定 target，不要新增事项。
- 用户明确说完成、做完、搞定、已完成时，completed 为 true。
- 用户明确说删除、取消、不用了、不要了时，deleted 为 true。
- 用户说“改到/移到/推迟到/提前到”时，优先输出 dueAt。
- 用户说“改成/改为/重命名为”时，输出 title。
- 无法确定的字段请省略，不要猜。
- 时间必须使用 ISO 8601。日期相对词要基于 now 解析。
`.trim();

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

function isValidRequest(body: unknown): body is UpdateItemRequest {
  return Boolean(body) && typeof body === "object";
}

function summarizeTargetState(state: AssistantState, target: AssistantItemRef) {
  if (target.kind === "task") return state.tasks.find((task) => task.id === target.id);
  if (target.kind === "life_event") return state.lifeEvents.find((event) => event.id === target.id);
  if (target.kind === "shopping_item") return state.shoppingItems.find((item) => item.id === target.id);
  return state.checkIns.find((checkIn) => checkIn.id === target.id);
}

async function planWithAgentPlan(body: Required<Pick<UpdateItemRequest, "rawText" | "state" | "target">> & UpdateItemRequest) {
  const payload = await requestAgentPlanChatCompletion({
    model: resolveAgentPlanLanguageModel(body.model),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          now: new Date().toISOString(),
          rawText: body.rawText,
          inputType: body.inputType === "voice" ? "voice" : "text",
          target: body.target,
          currentItem: summarizeTargetState(body.state, body.target)
        })
      }
    ],
    temperature: 0.1,
    response_format: { type: "json_object" }
  });
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Agent Plan returned an empty response.");
  const plan = normalizeItemUpdatePlan(parseJsonObject(content));
  if (!plan) throw new Error("Agent Plan response did not match the expected schema.");
  return plan;
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
