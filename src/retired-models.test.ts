/**
 * Provider retirements the gateways answer with a REDIRECT.
 *
 * A redirect is silent by design: the gateway rewrites the model id before it
 * prices or routes, so a retired id left in a chain never errors — the router
 * reports one model while another answers, and the host prices the decision
 * at a rate the gateway no longer charges. These tests keep every retired id
 * out of everything the router can return: the configured chains, the
 * affinity/evidence pools, and the verified-tool fallbacks (the last two are
 * only observable through `route`, so the corpus below is walked across every
 * profile and request shape).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CAPABILITIES } from "./model-capabilities.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import { route } from "./index.js";
import type { RouterOptions, Tier, TierConfig } from "./types.js";

/** Retired id -> the successor the gateways redirect it to. */
const REDIRECTED: Readonly<Record<string, string>> = {
  // 2026-11-24 (owner-approved).
  "openai/o1": "openai/gpt-5.4-mini",
  "openai/o1-mini": "openai/gpt-5.4-mini",
  "openai/o3-mini": "openai/gpt-5.4-mini",
  "openai/o4-mini": "openai/gpt-5.4-mini",
  "google/gemini-3.5-flash": "google/gemini-3.6-flash",
  // 2026-12-01: Google retires Gemini 2.5.
  "google/gemini-2.5-flash": "google/gemini-3.5-flash-lite",
  "google/gemini-2.5-pro": "google/gemini-3.8-flash",
  // 2026-12-11: OpenAI shuts down o3, gpt-5-mini and gpt-5-nano.
  "openai/o3": "openai/gpt-5.4-mini",
  "openai/gpt-5-mini": "openai/gpt-5.6-luna",
  "openai/gpt-5-nano": "openai/gpt-6-luna",
};

const TIER_SETS = ["tiers", "ecoTiers", "premiumTiers", "agenticTiers"] as const;

function chains(): Array<[string, TierConfig]> {
  const out: Array<[string, TierConfig]> = [];
  for (const set of TIER_SETS) {
    const tiers = DEFAULT_ROUTING_CONFIG[set] as Record<Tier, TierConfig> | null | undefined;
    if (!tiers) continue;
    for (const [tier, config] of Object.entries(tiers)) out.push([`${set}.${tier}`, config]);
  }
  return out;
}

const PRICING = new Map(
  Object.keys(DEFAULT_MODEL_CAPABILITIES).map((model) => [model, { inputPrice: 1, outputPrice: 3 }]),
);

const PROMPTS = [
  "What is the capital of France?",
  "Write a Python function that checks if a string is a valid IPv4 address.",
  "Prove that the sum of two odd integers is even, step by step.",
  "Una caja tiene 12 libros. Hay 4 cajas. ¿Cuántos libros hay en total?",
  "Which of the following is NOT a prime? (a) 17 (b) 21 (c) 23. Answer with the letter only.",
  "Cancel order B-42 and book the 9am flight to SFO.",
  "What's the weather in Tokyo, Paris, and New York?",
  "Extract all email addresses from this text as JSON: bob@x.com",
  "帮我提取这段文字中的所有邮箱，输出 JSON：bob@x.com",
  "Investigate why the checkout p95 regressed. Check the CDN config, the gateway logs and the slow query log.",
  "debug: TypeError: Cannot read properties of undefined (reading 'map')",
  "Summarize this contract: " + "lorem ipsum ".repeat(400),
  "Design a multi-tenant billing system: data model, service boundaries, failure modes and a migration plan.",
];

const SHAPES: Array<Partial<RouterOptions>> = [
  {},
  { hasTools: true, requiresTools: true, toolCount: 4, toolNames: ["cancel_order", "book_flight", "search_flights", "get_user"] },
  { hasVision: true },
  { requiresStructuredOutput: true },
  { hasTools: true, requiresTools: false, toolCount: 12, toolNames: ["read_file", "write_file", "run_shell", "search_code"] },
];

describe("retired models", () => {
  it("no configured chain names a retired id", () => {
    for (const [name, config] of chains()) {
      for (const model of [config.primary, ...config.fallback]) {
        expect(REDIRECTED[model], `${name} names ${model}, redirected to ${REDIRECTED[model]}`).toBeUndefined();
      }
    }
  });

  it("no chain lists a model twice (a successor written in place must not duplicate a rung)", () => {
    for (const [name, config] of chains()) {
      const models = [config.primary, ...config.fallback];
      expect(new Set(models).size, `${name}: ${models.join(", ")}`).toBe(models.length);
    }
  });

  it("route never returns a retired id, from any profile or request shape", () => {
    for (const profile of [undefined, "eco", "auto", "premium"] as const) {
      PROMPTS.forEach((prompt, i) => {
        const decision = route(prompt, undefined, 1024, {
          config: DEFAULT_ROUTING_CONFIG,
          modelPricing: PRICING,
          routingProfile: profile,
          ...SHAPES[i % SHAPES.length],
        });
        for (const model of [decision.model, ...(decision.candidates ?? [])]) {
          expect(REDIRECTED[model], `${profile ?? "default"} #${i} returned ${model}`).toBeUndefined();
        }
      });
    }
  });

  it("route never returns a retired id on a web-research turn (its own curated fallback order)", () => {
    // The web-research fallback order is a separate list in portfolio.ts that
    // the corpus above never reaches: it needs web tools and a research prompt.
    for (const profile of [undefined, "eco", "auto", "premium"] as const) {
      for (const prompt of [
        "Research the following clues across multiple public sources and identify the country.",
        "Search the official documentation for the current API timeout setting.",
      ]) {
        const decision = route(prompt, undefined, 2048, {
          config: DEFAULT_ROUTING_CONFIG,
          modelPricing: PRICING,
          routingProfile: profile,
          hasTools: true,
          requiresTools: true,
          toolCount: 2,
          toolNames: ["web_search", "web_fetch"],
        });
        expect(decision.reasoning).toContain("deepWebResearch=");
        for (const model of [decision.model, ...(decision.candidates ?? [])]) {
          expect(REDIRECTED[model], `${profile ?? "default"} web research returned ${model}`).toBeUndefined();
        }
      }
    }
  });

  it("every successor has capability evidence the eligibility stage can use", () => {
    for (const successor of new Set(Object.values(REDIRECTED))) {
      expect(DEFAULT_MODEL_CAPABILITIES[successor], successor).toBeDefined();
      expect(DEFAULT_MODEL_CAPABILITIES[successor].supportsTools, successor).toBe(true);
    }
  });
});
