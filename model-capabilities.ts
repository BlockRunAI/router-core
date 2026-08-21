/**
 * Model capabilities used for hard routing constraints.
 *
 * Hosts may inject fresher values through RouterOptions.modelCapabilities.
 * Keeping a small built-in snapshot makes the core safe and useful when a
 * product catalog is temporarily unavailable, without importing product code.
 */
export type ModelCapabilities = {
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
};

export const DEFAULT_MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> =
  Object.freeze({
    "anthropic/claude-fable-5": {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-haiku-4.5": {
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-opus-4.6": {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-opus-4.7": {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-opus-4.8": {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-opus-5": {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-sonnet-4.6": {
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      supportsTools: true,
      supportsVision: true,
    },
    "anthropic/claude-sonnet-5": {
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "deepseek/deepseek-chat": {
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsVision: false,
    },
    "deepseek/deepseek-reasoner": {
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsVision: false,
    },
    "deepseek/deepseek-v4-pro": {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: false,
    },
    "free/deepseek-v4-flash": {
      contextWindow: 1_000_000,
      maxOutputTokens: 16_384,
      supportsTools: false,
      supportsVision: false,
    },
    "free/seed-oss-36b": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: false,
      supportsVision: false,
    },
    "google/gemini-2.5-flash": {
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "google/gemini-2.5-flash-lite": {
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: false,
    },
    "google/gemini-2.5-pro": {
      contextWindow: 1_050_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "google/gemini-3-flash-preview": {
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      supportsTools: false,
      supportsVision: true,
    },
    "google/gemini-3.1-flash-lite": {
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
      supportsTools: true,
      supportsVision: false,
    },
    "google/gemini-3.1-pro": {
      contextWindow: 1_050_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "google/gemini-3.5-flash": {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "moonshot/kimi-k2.5": {
      contextWindow: 262_144,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: true,
    },
    "moonshot/kimi-k2.6": {
      contextWindow: 262_144,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "moonshot/kimi-k2.7": {
      contextWindow: 262_144,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "moonshot/kimi-k3": {
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: true,
    },
    "nvidia/nemotron-nano-9b-v2": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: false,
      supportsVision: false,
    },
    "nvidia/step-3.7-flash": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: false,
      supportsVision: false,
    },
    "openai/gpt-4.1": {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: true,
    },
    "openai/gpt-4o-mini": {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "openai/gpt-5-mini": {
      contextWindow: 200_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: false,
    },
    "openai/gpt-5.3-codex": {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: false,
    },
    "openai/gpt-5.4": {
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "openai/gpt-5.4-nano": {
      contextWindow: 1_050_000,
      maxOutputTokens: 32_768,
      supportsTools: true,
      supportsVision: false,
    },
    "openai/gpt-5.5": {
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "openai/gpt-5.6-terra": {
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
    },
    "openai/o3": {
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      supportsTools: true,
      supportsVision: false,
    },
    "openai/o4-mini": {
      contextWindow: 128_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: false,
    },
    "qwen/qwen3.7-max": {
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-3-mini": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-4-0709": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-4-1-fast-non-reasoning": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-4-1-fast-reasoning": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-4-fast-non-reasoning": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-4-fast-reasoning": {
      contextWindow: 131_072,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: false,
    },
    "xai/grok-4.5": {
      contextWindow: 500_000,
      maxOutputTokens: 16_384,
      supportsTools: true,
      supportsVision: true,
    },
    "zai/glm-5.1": {
      contextWindow: 200_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsVision: false,
    },
    "zai/glm-5.2": {
      contextWindow: 1_000_000,
      maxOutputTokens: 262_144,
      supportsTools: true,
      supportsVision: false,
    },
  });
