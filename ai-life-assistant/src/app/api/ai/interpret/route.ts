import { NextResponse } from "next/server";
import { applyInterpretation } from "@/lib/ai/applyInterpretation";
import { canUseAgentPlan, interpretWithAgentPlan, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import { confirmationTraceMeta, withoutConfirmationTrace } from "@/lib/ai/agentPlan/debugTrace";
import { buildSafePlanningFailureResult } from "@/lib/ai/agentPlan/safeFailure";
import { resolvePendingConfirmations } from "@/lib/confirmation/resolvePendingConfirmations";
import { parseLocalInput } from "@/lib/parser/parseLocalInput";
import type { AssistantState, ParseFeedback, TranscriptRepair } from "@/types/domain";

export const runtime = "nodejs";

type InterpretRequest = {
  rawText?: string;
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
  inputType?: "text" | "voice";
  model?: string;
  state?: AssistantState;
  clientRequestId?: string;
  baseRevision?: number;
  debugTrace?: boolean;
};

function isValidRequest(body: unknown): body is InterpretRequest {
  return Boolean(body) && typeof body === "object";
}

function mergeFeedback(confirmation: ParseFeedback, next: ParseFeedback): ParseFeedback {
  return {
    title: "已更新确认信息，也整理了新事项",
    detail: [confirmation.detail, next.detail].filter(Boolean).join(" "),
    question: next.question ?? confirmation.question
  };
}

function requestMeta(body: InterpretRequest) {
  return {
    clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
    baseRevision: typeof body.baseRevision === "number" ? body.baseRevision : undefined
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
  const meta = requestMeta(body);
  const confirmation = resolvePendingConfirmations(body.rawText, inputType, body.state, {
    originalText: body.originalText,
    transcriptRepair: body.transcriptRepair
  });
  if (confirmation && !confirmation.unhandledText) {
    return NextResponse.json({
      ...withoutConfirmationTrace(confirmation),
      ...confirmationTraceMeta(body, confirmation),
      ...meta,
      provider: "local_confirmation_resolver"
    });
  }

  const planningText = confirmation?.unhandledText ?? body.rawText;
  const planningState = confirmation?.state ?? body.state;
  const planningInputOptions = confirmation
    ? {
        inputId: confirmation.sourceInputId,
        appendInput: false
      }
    : undefined;

  if (!canUseAgentPlan()) {
    const result = parseLocalInput(planningText, planningState, inputType, planningInputOptions);
    return NextResponse.json({
      ...result,
      ...meta,
      feedback: confirmation ? mergeFeedback(confirmation.feedback, result.feedback) : result.feedback,
      ...confirmationTraceMeta(body, confirmation),
      provider: confirmation ? "local_confirmation_resolver+local_parser_fallback" : "local_parser_fallback"
    });
  }

  try {
    const interpretation = await interpretWithAgentPlan({
      rawText: planningText,
      inputType,
      state: planningState,
      model: body.model
    });
    const result = applyInterpretation(planningText, inputType, planningState, interpretation, {
      originalText: body.originalText,
      transcriptRepair: body.transcriptRepair,
      ...planningInputOptions
    });
    return NextResponse.json({
      ...result,
      ...meta,
      feedback: confirmation ? mergeFeedback(confirmation.feedback, result.feedback) : result.feedback,
      ...confirmationTraceMeta(body, confirmation),
      provider: confirmation ? "local_confirmation_resolver+volcengine_agent_plan_runtime" : "volcengine_agent_plan_runtime",
      model: resolveAgentPlanLanguageModel(body.model)
    });
  } catch (error) {
    console.warn("Agent Plan interpretation failed.", error);
    if (confirmation) {
      return NextResponse.json({
        ...withoutConfirmationTrace(confirmation),
        ...confirmationTraceMeta(body, confirmation),
        ...meta,
        feedback: {
          title: "已更新确认信息",
          detail: `${confirmation.feedback.detail} 另外一句我没有安全保存，先没有修改。`
        },
        provider: "local_confirmation_resolver"
      });
    }
    return NextResponse.json({ ...buildSafePlanningFailureResult(body.state, body.model), ...meta });
  }
}
