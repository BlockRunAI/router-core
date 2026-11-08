/**
 * The host's dead-model kill-switch (RouterOptions.unavailableModels).
 *
 * Exists because retargeting a dead chain rung used to take a core release
 * plus a repin in every consumer (issue #2); the free-tier retirements of
 * 2026-08 walked that path three times. A host that observes a 400/404/410 on
 * a direct call can now drop the rung locally, effective on the next request.
 *
 * The semantics under test are the ones that make it safe:
 *  - hard removal — a dead model must not resurface through the portfolio's
 *    eligibility fail-open or through evidence candidates;
 *  - promotion — killing a tier's primary promotes the first surviving rung;
 *  - fail-open on total loss — a tier whose chain is entirely dead keeps its
 *    original config, so the outage stays visible to the host that declared it;
 *  - no-op by default — an absent or empty list changes nothing (the decision
 *    snapshot pins that for the whole corpus).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CAPABILITIES } from "./model-capabilities.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import { applyUnavailableModels, route } from "./index.js";
import type { RouterOptions, Tier, TierConfig } from "./types.js";

const PRICING = new Map(
  Object.keys(DEFAULT_MODEL_CAPABILITIES).map((model) => [
    model,
    { inputPrice: 1, outputPrice: 3 },
  ]),
);

const NOW = new Date("2026-08-20T00:00:00Z");

function options(overrides: Partial<RouterOptions> = {}): RouterOptions {
  return { config: DEFAULT_ROUTING_CONFIG, modelPricing: PRICING, now: NOW, ...overrides };
}

const TIERS: Record<Tier, TierConfig> = {
  SIMPLE: { primary: "a/one", fallback: ["a/two", "a/three"] },
  MEDIUM: { primary: "b/one", fallback: ["b/two"] },
  COMPLEX: { primary: "c/one", fallback: [] },
  REASONING: { primary: "d/one", fallback: ["d/two"] },
};

describe("applyUnavailableModels", () => {
  it("is the identity for an absent or empty list", () => {
    expect(applyUnavailableModels(TIERS, undefined)).toBe(TIERS);
    expect(applyUnavailableModels(TIERS, [])).toBe(TIERS);
  });

  it("promotes the first surviving fallback when the primary is dead", () => {
    const result = applyUnavailableModels(TIERS, ["a/one"]);
    expect(result.SIMPLE).toEqual({ primary: "a/two", fallback: ["a/three"] });
    // Untouched tiers keep their original config objects.
    expect(result.MEDIUM).toBe(TIERS.MEDIUM);
  });

  it("removes dead rungs from the middle of a chain", () => {
    const result = applyUnavailableModels(TIERS, ["a/two"]);
    expect(result.SIMPLE).toEqual({ primary: "a/one", fallback: ["a/three"] });
  });

  it("keeps the original config when a tier's whole chain is dead", () => {
    const result = applyUnavailableModels(TIERS, ["c/one"]);
    expect(result.COMPLEX).toBe(TIERS.COMPLEX);
  });

  it("does not mutate its input", () => {
    applyUnavailableModels(TIERS, ["a/one", "b/one"]);
    expect(TIERS.SIMPLE.primary).toBe("a/one");
    expect(TIERS.MEDIUM.primary).toBe("b/one");
  });
});

describe("route with unavailableModels", () => {
  const PROMPT = "What is the capital of France?";

  it("never selects or lists a model the host declared dead", () => {
    const baseline = route(PROMPT, undefined, 256, options());
    const dead = baseline.model;
    const decision = route(PROMPT, undefined, 256, options({ unavailableModels: [dead] }));
    expect(decision.model).not.toBe(dead);
    expect(decision.candidates).not.toContain(dead);
  });

  it("keeps dead evidence candidates out of the portfolio chain", () => {
    // A math prompt pulls evidence candidates in beyond the configured tier
    // chain; killing one of those must remove it from the ranked candidates.
    const mathPrompt = "Solve for x: 3x^2 - 12x + 9 = 0. Show your work.";
    const baseline = route(mathPrompt, undefined, 1024, options());
    const evidence = baseline.candidates ?? [];
    expect(evidence.length).toBeGreaterThan(1);
    const dead = evidence[0];
    const decision = route(
      mathPrompt,
      undefined,
      1024,
      options({ unavailableModels: [dead] }),
    );
    expect(decision.model).not.toBe(dead);
    expect(decision.candidates).not.toContain(dead);
  });

  it("applies to the rules strategy as well", () => {
    const config = { ...DEFAULT_ROUTING_CONFIG, strategy: "rules" as const };
    const baseline = route(PROMPT, undefined, 256, options({ config }));
    const dead = baseline.model;
    const decision = route(
      PROMPT,
      undefined,
      256,
      options({ config, unavailableModels: [dead] }),
    );
    expect(decision.model).not.toBe(dead);
  });

  it("survives killing an entire tier chain by leaving the tier as configured", () => {
    const chain = [
      DEFAULT_ROUTING_CONFIG.tiers.SIMPLE.primary,
      ...DEFAULT_ROUTING_CONFIG.tiers.SIMPLE.fallback,
    ];
    // Declaring every SIMPLE rung dead leaves nothing live to offer; the
    // router returns the configured chain rather than inventing a model, so
    // the outage stays visible to the host that reported it.
    const decision = route(PROMPT, undefined, 256, options({ unavailableModels: chain }));
    expect(decision.model.length).toBeGreaterThan(0);
  });
});
