import { defaultAgentPlanLanguageModel, isAgentPlanLanguageModel } from "@/lib/ai/modelCatalog";
import { DEFAULT_TIMEZONE } from "@/lib/time/parseTime";
import type { AgentPlanChatCompletionRequest, AgentPlanChatCompletionResponse } from "./types";

function configured() {
  return (
    process.env.AI_PROVIDER === "volcengine_agent_plan_runtime" &&
    process.env.ALLOW_AGENT_PLAN_RUNTIME === "true" &&
    process.env.AI_PARSE_ENABLED !== "false" &&
    Boolean(process.env.ARK_AGENT_PLAN_API_KEY)
  );
}

export function runtimeTimezone() {
  return process.env.ASSISTANT_TIMEZONE || DEFAULT_TIMEZONE;
}

function endpoint() {
  const base = process.env.ARK_AGENT_PLAN_OPENAI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/plan/v3";
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

function shouldRetryWithoutResponseFormat(status: number, bodyText: string) {
  return status === 400 && /response_format|json_object/i.test(bodyText) && /not supported|not valid|invalid/i.test(bodyText);
}

function shouldRetryWithoutThinking(status: number, bodyText: string) {
  return status === 400 && /thinking/i.test(bodyText) && /not supported|not valid|invalid|mismatch/i.test(bodyText);
}

function resolveThinkingConfig(): AgentPlanChatCompletionRequest["thinking"] {
  const explicit = process.env.ARK_AGENT_PLAN_THINKING;
  if (explicit === "disabled" || explicit === "enabled") return { type: explicit };
  if (process.env.ARK_AGENT_PLAN_DISABLE_THINKING === "true") return { type: "disabled" as const };
  return undefined;
}

export function canUseAgentPlan() {
  return configured();
}

export function resolveAgentPlanLanguageModel(model?: string) {
  return isAgentPlanLanguageModel(model)
    ? model
    : process.env.ARK_AGENT_PLAN_CHAT_MODEL ?? defaultAgentPlanLanguageModel;
}

export async function requestAgentPlanChatCompletion(
  requestBody: AgentPlanChatCompletionRequest
): Promise<AgentPlanChatCompletionResponse> {
  const thinking = requestBody.thinking ?? resolveThinkingConfig();
  const initialBody = thinking ? { ...requestBody, thinking } : requestBody;

  async function post(body: AgentPlanChatCompletionRequest) {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ARK_AGENT_PLAN_API_KEY}`
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    return { response, text };
  }

  let currentBody = initialBody;
  let { response, text } = await post(currentBody);
  if (!response.ok && currentBody.response_format && shouldRetryWithoutResponseFormat(response.status, text)) {
    const { response_format: _responseFormat, ...retryBody } = currentBody;
    currentBody = retryBody;
    ({ response, text } = await post(retryBody));
  }
  if (!response.ok && currentBody.thinking && shouldRetryWithoutThinking(response.status, text)) {
    const { thinking: _thinking, ...retryBody } = currentBody;
    currentBody = retryBody;
    ({ response, text } = await post(retryBody));
  }

  if (!response.ok) {
    throw new Error(`Agent Plan request failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text) as AgentPlanChatCompletionResponse;
}
