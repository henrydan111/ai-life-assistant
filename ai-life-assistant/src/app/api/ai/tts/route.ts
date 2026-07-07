import { NextResponse } from "next/server";
import { synthesizeWithAgentPlan } from "@/lib/ai/speechPlan";

export const runtime = "nodejs";

type TtsRequest = {
  text?: string;
};

export async function POST(request: Request) {
  let body: TtsRequest;

  try {
    body = (await request.json()) as TtsRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }

  try {
    const result = await synthesizeWithAgentPlan(body.text);
    return new Response(new Uint8Array(result.audio), {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
        "X-AI-Provider": "volcengine_agent_plan_tts"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "TTS request failed.",
        provider: "volcengine_agent_plan_tts"
      },
      { status: 502 }
    );
  }
}
