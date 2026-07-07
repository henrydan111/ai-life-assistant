export const agentPlanLanguageModels = [
  {
    id: "doubao-seed-2.0-lite",
    label: "Doubao Seed 2.0 Lite",
    description: "Fast general-purpose option for daily assistant parsing."
  },
  {
    id: "doubao-seed-2.0-pro",
    label: "Doubao Seed 2.0 Pro",
    description: "Use for complex planning, long chains, and heavier reasoning."
  },
  {
    id: "doubao-seed-2.0-mini",
    label: "Doubao Seed 2.0 Mini",
    description: "Use when latency and cost matter more than nuanced reasoning."
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    description: "Default model for this product: economical, quick, and strong enough for structured planning."
  },
  {
    id: "glm-5.2",
    label: "GLM 5.2",
    description: "Good long-context option when the workspace history grows."
  },
  {
    id: "minimax-m3",
    label: "MiniMax M3",
    description: "Agent-oriented alternative for tool-heavy workflows."
  }
] as const;

export type AgentPlanLanguageModel = (typeof agentPlanLanguageModels)[number]["id"];

export const defaultAgentPlanLanguageModel: AgentPlanLanguageModel = "deepseek-v4-flash";

export function isAgentPlanLanguageModel(value: unknown): value is AgentPlanLanguageModel {
  return typeof value === "string" && agentPlanLanguageModels.some((model) => model.id === value);
}
