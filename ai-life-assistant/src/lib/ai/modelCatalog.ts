export const agentPlanLanguageModels = [
  {
    id: "doubao-seed-2.0-code",
    label: "Doubao Seed 2.0 Code",
    description: "偏代码任务，不建议作为生活助理默认模型。"
  },
  {
    id: "doubao-seed-2.0-lite",
    label: "Doubao Seed 2.0 Lite",
    description: "推荐默认。结构稳定，关闭 Thinking 后响应更快。"
  },
  {
    id: "doubao-seed-2.0-pro",
    label: "Doubao Seed 2.0 Pro",
    description: "适合复杂规划，但日常解析会更慢。"
  },
  {
    id: "doubao-seed-2.0-mini",
    label: "Doubao Seed 2.0 Mini",
    description: "速度最快，适合轻量输入。"
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    description: "成本友好，但当前三步解析链路较慢。"
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    description: "能力更强，但延迟和成本更高。"
  },
  {
    id: "glm-5.2",
    label: "GLM 5.2",
    description: "适合长上下文，但结构输出稳定性需观察。"
  },
  {
    id: "kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    description: "偏代码与长上下文，不建议做默认生活解析。"
  },
  {
    id: "kimi-k2.6",
    label: "Kimi K2.6",
    description: "可用于长上下文助手任务。"
  },
  {
    id: "minimax-m3",
    label: "MiniMax M3",
    description: "偏 Agent 工作流，当前解析速度偏慢。"
  },
  {
    id: "minimax-m2.7",
    label: "MiniMax M2.7",
    description: "适合复杂多步任务，不适合默认低延迟入口。"
  }
] as const;

export type AgentPlanLanguageModel = (typeof agentPlanLanguageModels)[number]["id"];

export const defaultAgentPlanLanguageModel: AgentPlanLanguageModel = "doubao-seed-2.0-lite";

export function isAgentPlanLanguageModel(value: unknown): value is AgentPlanLanguageModel {
  return typeof value === "string" && agentPlanLanguageModels.some((model) => model.id === value);
}
