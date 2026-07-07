import { requestAgentPlanChatCompletion } from "./provider";

const bareIdentifierStringKeys = [
  "type",
  "ref",
  "relatedRef",
  "relatedId",
  "relatedType",
  "status",
  "category",
  "cadence",
  "targetTimeRelation",
  "scope",
  "priority",
  "taskType",
  "horizon",
  "energyRequired",
  "expectedAnswerKind",
  "targetField",
  "slot"
];

function quoteBareIdentifierStringValues(content: string) {
  const keyPattern = bareIdentifierStringKeys.join("|");
  const pattern = new RegExp(`"(${keyPattern})"\\s*:\\s*([A-Za-z_][A-Za-z0-9_./:-]*)(\\s*[,}])`, "g");
  return content.replace(pattern, (_match, key: string, value: string, suffix: string) => {
    if (value === "true" || value === "false" || value === "null") {
      return `"${key}":${value}${suffix}`;
    }
    return `"${key}":"${value}"${suffix}`;
  });
}

export function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : content;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Agent Plan response did not contain a JSON object.");
  }
  const candidate = raw.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate) as unknown;
  } catch (initialError) {
    const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, "$1");
    if (withoutTrailingCommas !== candidate) {
      try {
        return JSON.parse(withoutTrailingCommas) as unknown;
      } catch {
        // Fall through to the narrow schema-key repair below.
      }
    }
    const withQuotedBareIdentifiers = quoteBareIdentifierStringValues(withoutTrailingCommas);
    if (withQuotedBareIdentifiers !== withoutTrailingCommas) {
      try {
        return JSON.parse(withQuotedBareIdentifiers) as unknown;
      } catch {
        // Keep the original parser error; it is usually the most actionable.
      }
    }
    throw initialError;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function requestAgentPlanJson({
  model,
  systemPrompt,
  payload,
  temperature = 0.2
}: {
  model: string;
  systemPrompt: string;
  payload: unknown;
  temperature?: number;
}) {
  const response = await requestAgentPlanChatCompletion({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) }
    ],
    temperature,
    response_format: { type: "json_object" }
  });
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Agent Plan returned an empty response.");
  }
  return parseJsonObject(content);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withValidationPayload(payload: unknown, errors: string[], previousResult: unknown) {
  const validation = {
    errors,
    previous_result: previousResult
  };
  return isRecord(payload) ? { ...payload, validation } : { input: payload, validation };
}

export async function requestValidatedAgentPlanJson<T>({
  model,
  systemPrompt,
  payload,
  temperature = 0.2,
  stageName,
  normalize,
  validate = () => []
}: {
  model: string;
  systemPrompt: string;
  payload: unknown;
  temperature?: number;
  stageName: string;
  normalize: (value: unknown) => T | null;
  validate?: (value: T, raw: unknown) => string[];
}) {
  async function run(attemptPayload: unknown, attemptTemperature: number) {
    try {
      const raw = await requestAgentPlanJson({
        model,
        systemPrompt,
        payload: attemptPayload,
        temperature: attemptTemperature
      });
      const value = normalize(raw);
      if (!value) {
        return {
          raw,
          value: null,
          errors: [`${stageName} 输出不符合预期 JSON schema。`]
        };
      }
      return {
        raw,
        value,
        errors: validate(value, raw)
      };
    } catch (error) {
      return {
        raw: undefined,
        value: null,
        errors: [`${stageName} 输出无法解析：${errorMessage(error)}`]
      };
    }
  }

  const first = await run(payload, temperature);
  if (first.value && !first.errors.length) return first.value;

  const retry = await run(withValidationPayload(payload, first.errors, first.raw), 0);
  if (retry.value && !retry.errors.length) return retry.value;

  throw new Error(`${stageName} failed validation: ${retry.errors.join(" ")}`);
}
