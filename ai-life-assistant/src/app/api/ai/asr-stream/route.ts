import { NextResponse } from "next/server";
import { repairTranscriptWithAgentPlan } from "@/lib/ai/agentPlan";
import { transcribePcmStreamWithAgentPlan } from "@/lib/ai/speechPlan";

export const runtime = "nodejs";

async function* requestBodyChunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (!request.body) {
    return NextResponse.json({ error: "Streaming audio body is required." }, { status: 400 });
  }

  try {
    const startedAt = Date.now();
    const rawTranscript = await transcribePcmStreamWithAgentPlan(requestBodyChunks(request.body));
    const repair = await repairTranscriptWithAgentPlan({
      rawTranscript,
      model: request.headers.get("X-Agent-Model") ?? undefined,
      timezone: request.headers.get("X-Assistant-Timezone") ?? undefined
    });
    return NextResponse.json({
      transcript: repair.transcript,
      rawTranscript,
      repair,
      provider: "volcengine_agent_plan_asr_stream_with_repair",
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Streaming ASR request failed.",
        provider: "volcengine_agent_plan_asr_stream_with_repair"
      },
      { status: 502 }
    );
  }
}
