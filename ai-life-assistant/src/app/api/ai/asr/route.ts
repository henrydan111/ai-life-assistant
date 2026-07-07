import { NextResponse } from "next/server";
import { repairTranscriptWithAgentPlan } from "@/lib/ai/agentPlan";
import { transcribeWithAgentPlan } from "@/lib/ai/speechPlan";

export const runtime = "nodejs";

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

  try {
    const rawTranscript = await transcribeWithAgentPlan(Buffer.from(await file.arrayBuffer()), file.type || "audio/webm");
    const repair = await repairTranscriptWithAgentPlan({
      rawTranscript,
      model: request.headers.get("X-Agent-Model") ?? undefined
    });
    return NextResponse.json({
      transcript: repair.transcript,
      rawTranscript,
      repair,
      provider: "volcengine_agent_plan_asr_with_repair"
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "ASR request failed.",
        provider: "volcengine_agent_plan_asr_with_repair"
      },
      { status: 502 }
    );
  }
}
