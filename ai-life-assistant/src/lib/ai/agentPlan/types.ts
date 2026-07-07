import type { AiProcessingUpdate } from "@/types/domain";

export type AgentPlanChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type AgentPlanChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentPlanChatCompletionRequest = {
  model: string;
  messages: AgentPlanChatMessage[];
  temperature?: number;
  response_format?: { type: "json_object" };
  thinking?: { type: "disabled" | "enabled" };
};

export type ProgressReporter = (update: AiProcessingUpdate) => void;
