import { NextResponse } from "next/server";
import { applyInterpretation } from "@/lib/ai/applyInterpretation";
import { canUseAgentPlan, interpretWithAgentPlan, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import { createId } from "@/lib/id";
import { nowIso } from "@/lib/time/parseTime";
import type { AssistantState } from "@/types/domain";

export const runtime = "nodejs";

type InterpretRequest = {
  rawText?: string;
  inputType?: "text" | "voice";
  model?: string;
  state?: AssistantState;
};

function isValidRequest(body: unknown): body is InterpretRequest {
  return Boolean(body) && typeof body === "object";
}

function saveRawInputFallback(rawText: string, inputType: "text" | "voice", state: AssistantState) {
  const now = nowIso();
  const inputId = createId("input");
  return {
    state: {
      ...state,
      inputs: [
        {
          id: inputId,
          rawText,
          inputType,
          parsedSummary: "Saved raw input",
          createdAt: now
        },
        ...state.inputs
      ].slice(0, 60),
      tasks: [
        {
          id: createId("task"),
          title: rawText.length > 48 ? `${rawText.slice(0, 48)}...` : rawText,
          description: rawText,
          type: "task" as const,
          horizon: "today" as const,
          energyRequired: "low" as const,
          priority: "medium" as const,
          status: "todo" as const,
          sourceInputId: inputId,
          confidence: 0.35,
          createdAt: now,
          updatedAt: now
        },
        ...state.tasks
      ]
    },
    feedback: {
      title: "已暂存",
      detail: "AI 解析暂时失败，但我已经保存了你的原文，避免这次输入丢失。"
    }
  };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidRequest(body) || typeof body.rawText !== "string" || !body.state) {
    return NextResponse.json({ error: "rawText and state are required." }, { status: 400 });
  }

  const inputType = body.inputType === "voice" ? "voice" : "text";

  if (!canUseAgentPlan()) {
    return NextResponse.json({
      ...saveRawInputFallback(body.rawText, inputType, body.state),
      provider: "raw_input_fallback",
      error: "AI 解析服务未配置，已暂存原文。"
    });
  }

  try {
    const interpretation = await interpretWithAgentPlan({
      rawText: body.rawText,
      inputType,
      state: body.state,
      model: body.model
    });
    const result = applyInterpretation(body.rawText, inputType, body.state, interpretation);
    return NextResponse.json({
      ...result,
      provider: "volcengine_agent_plan_runtime",
      model: resolveAgentPlanLanguageModel(body.model)
    });
  } catch (error) {
    console.warn("Agent Plan interpretation failed.", error);
    return NextResponse.json({
      ...saveRawInputFallback(body.rawText, inputType, body.state),
      provider: "raw_input_fallback",
      error: error instanceof Error ? error.message : "AI interpretation failed."
    });
  }
}
