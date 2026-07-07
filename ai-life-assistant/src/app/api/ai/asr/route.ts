import { NextResponse } from "next/server";
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
    const transcript = await transcribeWithAgentPlan(Buffer.from(await file.arrayBuffer()), file.type || "audio/webm");
    return NextResponse.json({ transcript, provider: "volcengine_agent_plan_asr" });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "ASR request failed.",
        provider: "volcengine_agent_plan_asr"
      },
      { status: 502 }
    );
  }
}
