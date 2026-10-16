import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_CAPABILITIES } from "./model-capabilities.js";

describe("generated model capability snapshot", () => {
  it.each([
    "anthropic/claude-fable-5.1",
    "anthropic/claude-opus-5.5",
    "anthropic/claude-sonnet-5.5",
    "google/gemini-3.8-flash",
    "openai/gpt-5.1",
    "openai/gpt-6-astra",
    "openai/gpt-6-luna",
    "openai/gpt-6-sol",
    "xai/grok-4.6",
    "xai/grok-4.7",
    "xiaomi/mimo-v2.5",
  ])("accepts a live-probed tool call from %s", (model) => {
    expect(DEFAULT_MODEL_CAPABILITIES[model]?.supportsTools).toBe(true);
  });

  it.each([
    "deepseek/deepseek-v4-flash-vision-exp",
    "qwen/qwen3.8-flash",
  ])("keeps %s out of tool-required routes after an invalid tool response", (model) => {
    expect(DEFAULT_MODEL_CAPABILITIES[model]?.supportsTools).toBe(false);
  });
});
