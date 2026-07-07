import { NextResponse } from "next/server";
import { applyInterpretation } from "@/lib/ai/applyInterpretation";
import { canUseAgentPlan, interpretWithAgentPlan, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import { parseLocalInput } from "@/lib/parser/parseLocalInput";
import type { AssistantState, TranscriptRepair } from "@/types/domain";

export const runtime = "nodejs";

type InterpretRequest = {
  rawText?: string;
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
  inputType?: "text" | "voice";
  model?: string;
  state?: AssistantState;
};

function isValidRequest(body: unknown): body is InterpretRequest {
  return Boolean(body) && typeof body === "object";
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
    const result = parseLocalInput(body.rawText, body.state, inputType);
    return NextResponse.json({
      ...result,
      provider: "local_parser_fallback"
    });
  }

  try {
    const interpretation = await interpretWithAgentPlan({
      rawText: body.rawText,
      inputType,
      state: body.state,
      model: body.model
    });
    const result = applyInterpretation(body.rawText, inputType, body.state, interpretation, {
      originalText: body.originalText,
      transcriptRepair: body.transcriptRepair
    });
    return NextResponse.json({
      ...result,
      provider: "volcengine_agent_plan_runtime",
      model: resolveAgentPlanLanguageModel(body.model)
    });
  } catch (error) {
    console.warn("Agent Plan interpretation failed.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI interpretation failed." },
      { status: 502 }
    );
  }
}
