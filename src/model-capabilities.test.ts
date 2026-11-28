import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_CAPABILITIES } from "./model-capabilities.js";

describe("generated model capability snapshot", () => {
  it.each([
    "anthropic/claude-fable-5.1",
    "anthropic/claude-fable-5.2",
    "anthropic/claude-opus-5.5",
    "anthropic/claude-sonnet-5.5",
    "google/gemini-3.8-flash",
    "google/gemini-4-argon",
    "google/gemini-4-carbon",
    "google/gemini-4-hydrogen",
    "google/gemini-4-neon",
    "mistral/mistral-large-4",
    "nvidia/nemotron-3.5-bolt",
    "openai/gpt-5.1",
    "openai/gpt-5.6-luna-pro",
    "openai/gpt-6-astra",
    "openai/gpt-6-luna",
    "openai/gpt-6-sol",
    "openai/gpt-6.1-terra",
    "openai/gpt-6.2-astra",
    "openai/gpt-6.2-sol",
    "poolside/laguna-xs-2.1",
    "qwen/qwen3.8-flash",
    "qwen/qwen3.8-max",
    "tencent/hy4-preview",
    "xai/grok-4.6",
    "xai/grok-4.7",
    "xiaomi/mimo-v2.5",
  ])("accepts a live-probed tool call from %s", (model) => {
    expect(DEFAULT_MODEL_CAPABILITIES[model]?.supportsTools).toBe(true);
  });

  it.each([
    "deepseek/deepseek-v4-flash-vision-exp",
  ])("keeps %s out of tool-required routes after an invalid tool response", (model) => {
    expect(DEFAULT_MODEL_CAPABILITIES[model]?.supportsTools).toBe(false);
  });

  // Paid twice on Base (2026-11-28) and answered 500 after payment both
  // times: no tool evidence, so it fails closed until a probe succeeds.
  it("keeps poolside/laguna-s-2.1 out of tool-required routes while the gateway 500s it", () => {
    expect(DEFAULT_MODEL_CAPABILITIES["poolside/laguna-s-2.1"]?.supportsTools).toBe(false);
  });
});
