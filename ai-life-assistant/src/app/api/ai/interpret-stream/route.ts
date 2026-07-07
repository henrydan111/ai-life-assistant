import { NextResponse } from "next/server";
import { applyInterpretation } from "@/lib/ai/applyInterpretation";
import { canUseAgentPlan, interpretWithAgentPlan, resolveAgentPlanLanguageModel } from "@/lib/ai/agentPlan";
import { buildSafePlanningFailureResult } from "@/lib/ai/agentPlan/safeFailure";
import { parseLocalInput } from "@/lib/parser/parseLocalInput";
import type { AiProcessingUpdate, AssistantState, TranscriptRepair } from "@/types/domain";

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
  | {
      type: "result";
      state?: AssistantState;
      feedback?: { title: string; detail: string; question?: string };
      provider: string;
      model?: string;
      error?: string;
    };

function isValidRequest(body: unknown): body is InterpretRequest {
  return Boolean(body) && typeof body === "object";
}

function streamLine(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, message: StreamMessage) {
  controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
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

      try {
        if (!canUseAgentPlan()) {
          sendProgress({
            stage: "saving",
            status: "attention",
            title: "先帮你记下",
            detail: "AI 深度整理暂时不可用，我会用本地方式先保存。"
          });
          const result = parseLocalInput(rawText, state, inputType);
          sendProgress({
            stage: "saving",
            status: "complete",
            title: "已保存",
            detail: result.feedback.detail
          });
          sendProgress({
            stage: "done",
            status: "complete",
            title: "整理完成",
            detail: result.feedback.detail
          });
          streamLine(controller, encoder, {
            type: "result",
            ...result,
            provider: "local_parser_fallback"
          });
          return;
        }

        const interpretation = await interpretWithAgentPlan({
          rawText,
          inputType,
          state,
          model,
          onProgress: sendProgress
        });

        sendProgress({
          stage: "saving",
          status: "active",
          title: "保存总览",
          detail: "正在更新今日事项、后续安排和提醒。"
        });
        const result = applyInterpretation(rawText, inputType, state, interpretation, {
          originalText,
          transcriptRepair
        });
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
          detail: result.feedback.detail
        });
        streamLine(controller, encoder, {
          ...result,
          type: "result",
          provider: "volcengine_agent_plan_runtime",
          model: resolveAgentPlanLanguageModel(model)
        });
      } catch (error) {
        console.warn("Agent Plan streamed interpretation failed.", error);
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
