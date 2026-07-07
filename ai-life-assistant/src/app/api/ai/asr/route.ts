import { NextResponse } from "next/server";
import { repairTranscriptWithAgentPlan } from "@/lib/ai/agentPlan";
import { transcribeWithAgentPlan } from "@/lib/ai/speechPlan";

export const runtime = "nodejs";

function rawTranscriptRepair(rawTranscript: string) {
  return {
    rawTranscript,
    transcript: rawTranscript,
    confidence: 0.45,
    needsUserConfirmation: true,
    question: "我先保留原始转写。你看这句话对吗？",
    repairs: []
  };
}

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid audio upload." }, { status: 400 });
  }

  const file = formData.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
  }

  let rawTranscript: string;
  try {
    rawTranscript = await transcribeWithAgentPlan(Buffer.from(await file.arrayBuffer()), file.type || "audio/webm");
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "ASR request failed.",
        provider: "volcengine_agent_plan_asr_with_repair"
      },
      { status: 502 }
    );
  }

  try {
    const repair = await repairTranscriptWithAgentPlan({
      rawTranscript,
      model: request.headers.get("X-Agent-Model") ?? undefined,
      timezone: request.headers.get("X-Assistant-Timezone") ?? formData.get("timezone")?.toString()
    });
    return NextResponse.json({
      transcript: repair.transcript,
      rawTranscript,
      repair,
      provider: "volcengine_agent_plan_asr_with_repair"
    });
  } catch (error) {
    return NextResponse.json({
      transcript: rawTranscript,
      rawTranscript,
      repair: rawTranscriptRepair(rawTranscript),
      repairError: error instanceof Error ? error.message : "Transcript repair failed.",
      provider: "volcengine_agent_plan_asr_raw_fallback"
    });
  }
}
