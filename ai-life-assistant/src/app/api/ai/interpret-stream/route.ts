import { NextResponse } from "next/server";
import { applyInterpretation } from "@/lib/ai/applyInterpretation";
import { canUseAgentPlan, interpretWithAgentPlan, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import { buildSafePlanningFailureResult } from "@/lib/ai/agentPlan/safeFailure";
import { resolvePendingConfirmations } from "@/lib/confirmation/resolvePendingConfirmations";
import { parseLocalInput } from "@/lib/parser/parseLocalInput";
import type { InterpretResult } from "@/lib/store/interpretResult";
import type { AiProcessingUpdate, AssistantState, ParseFeedback, TranscriptRepair } from "@/types/domain";

export const runtime = "nodejs";

type InterpretRequest = {
  rawText?: string;
  originalText?: string;
  transcriptRepair?: TranscriptRepair;
  inputType?: "text" | "voice";
  model?: string;
  state?: AssistantState;
};

type StreamMessage =
  | ({ type: "progress" } & AiProcessingUpdate)
  | ({ type: "result" } & InterpretResult);

function isValidRequest(body: unknown): body is InterpretRequest {
  return Boolean(body) && typeof body === "object";
}

function streamLine(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, message: StreamMessage) {
  controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
}

function mergeFeedback(confirmation: ParseFeedback, next: ParseFeedback): ParseFeedback {
  return {
    title: "已更新确认信息，也整理了新事项",
    detail: [confirmation.detail, next.detail].filter(Boolean).join(" "),
    question: next.question ?? confirmation.question
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

  const rawText = body.rawText;
  const originalText = typeof body.originalText === "string" ? body.originalText : undefined;
  const transcriptRepair = body.transcriptRepair;
  const state = body.state;
  const model = body.model;
  const inputType = body.inputType === "voice" ? "voice" : "text";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendProgress = (update: AiProcessingUpdate) => {
        streamLine(controller, encoder, { type: "progress", ...update });
      };
      let confirmationForFallback:
        | ReturnType<typeof resolvePendingConfirmations>
        | null = null;

      try {
        const confirmation = resolvePendingConfirmations(rawText, inputType, state, {
          originalText,
          transcriptRepair
        });
        confirmationForFallback = confirmation;
        if (confirmation) {
          sendProgress({
            stage: "saving",
            status: "complete",
            title: "已更新确认信息",
            detail: confirmation.feedback.detail
          });
        }
        if (confirmation && !confirmation.unhandledText) {
          sendProgress({
            stage: "done",
            status: "complete",
            title: "整理完成",
            detail: confirmation.feedback.detail
          });
          streamLine(controller, encoder, {
            type: "result",
            ...confirmation,
            provider: "local_confirmation_resolver"
          });
          return;
        }

        const planningText = confirmation?.unhandledText ?? rawText;
        const planningState = confirmation?.state ?? state;

        if (!canUseAgentPlan()) {
          sendProgress({
            stage: "saving",
            status: "attention",
            title: "先帮你记下",
            detail: "AI 深度整理暂时不可用，我会用本地方式先保存。"
          });
          const result = parseLocalInput(planningText, planningState, inputType);
          const feedback = confirmation ? mergeFeedback(confirmation.feedback, result.feedback) : result.feedback;
          sendProgress({
            stage: "saving",
            status: "complete",
            title: "已保存",
            detail: feedback.detail
          });
          sendProgress({
            stage: "done",
            status: "complete",
            title: "整理完成",
            detail: feedback.detail
          });
          streamLine(controller, encoder, {
            type: "result",
            ...result,
            feedback,
            provider: confirmation ? "local_confirmation_resolver+local_parser_fallback" : "local_parser_fallback"
          });
          return;
        }

        const interpretation = await interpretWithAgentPlan({
          rawText: planningText,
          inputType,
          state: planningState,
          model,
          onProgress: sendProgress
        });

        sendProgress({
          stage: "saving",
          status: "active",
          title: "保存总览",
          detail: "正在更新今日事项、后续安排和提醒。"
        });
        const result = applyInterpretation(planningText, inputType, planningState, interpretation, {
          originalText,
          transcriptRepair
        });
        const feedback = confirmation ? mergeFeedback(confirmation.feedback, result.feedback) : result.feedback;
        sendProgress({
          stage: "saving",
          status: "complete",
          title: "保存总览",
          detail: "已更新你的总览。"
        });
        sendProgress({
          stage: "done",
          status: "complete",
          title: "整理完成",
          detail: feedback.detail
        });
        streamLine(controller, encoder, {
          ...result,
          feedback,
          type: "result",
          provider: confirmation ? "local_confirmation_resolver+volcengine_agent_plan_runtime" : "volcengine_agent_plan_runtime",
          model: resolveAgentPlanLanguageModel(model)
        });
      } catch (error) {
        console.warn("Agent Plan streamed interpretation failed.", error);
        if (confirmationForFallback) {
          const result = {
            ...confirmationForFallback,
            feedback: {
              title: "已更新确认信息",
              detail: `${confirmationForFallback.feedback.detail} 另外一句我没有安全保存，先没有修改。`
            }
          };
          sendProgress({
            stage: "done",
            status: "attention",
            title: result.feedback.title,
            detail: result.feedback.detail
          });
          streamLine(controller, encoder, {
            ...result,
            type: "result",
            provider: "local_confirmation_resolver"
          });
          return;
        }
        const result = buildSafePlanningFailureResult(state, model);
        sendProgress({
          stage: "saving",
          status: "attention",
          title: "没有保存事项",
          detail: result.feedback.detail
        });
        sendProgress({
          stage: "done",
          status: "attention",
          title: result.feedback.title,
          detail: result.feedback.detail
        });
        streamLine(controller, encoder, {
          ...result,
          type: "result",
          provider: result.provider,
          model: result.model
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
