/**
 * Regression tests for the 2026-11 audit: inputs that produced a wrong
 * classification, a NaN ranking, an unbounded scan or a fabricated figure.
 * Each case names the input that used to fail.
 */
import { describe, expect, it } from "vitest";

import { route } from "./index.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import { RulesStrategy } from "./strategy.js";
import { classifyByRules } from "./rules.js";
import { calculateModelCost, selectModel, type ModelPricing } from "./selector.js";
import { sampleForScan, scanLimit } from "./tokens.js";
import { parseModelCatalog, toRoutingCatalog } from "./catalog.js";
import type { RouterOptions, RoutingConfig, Tier, TierConfig } from "./types.js";

const pricing = new Map<string, ModelPricing>([
  ["anthropic/claude-sonnet-5", { inputPrice: 3, outputPrice: 15 }],
  ["anthropic/claude-opus-4.8", { inputPrice: 5, outputPrice: 25 }],
  ["openai/gpt-5.3-codex", { inputPrice: 1.75, outputPrice: 14 }],
  ["openai/gpt-5-mini", { inputPrice: 0.25, outputPrice: 2 }],
  ["google/gemini-3.5-flash", { inputPrice: 1.5, outputPrice: 9 }],
  ["google/gemini-2.5-flash", { inputPrice: 0.3, outputPrice: 2.5 }],
  ["deepseek/deepseek-v4-pro", { inputPrice: 0.435, outputPrice: 0.87 }],
  ["moonshot/kimi-k3", { inputPrice: 3, outputPrice: 15 }],
]);

const options = (extra: Partial<RouterOptions> = {}): RouterOptions => ({
  config: DEFAULT_ROUTING_CONFIG,
  modelPricing: pricing,
  ...extra,
});

describe("Chinese task keywords", () => {
  // `\b` without the `u` flag only sees ASCII word characters, so these
  // alternatives sat inside a boundary that can never fire between two Han
  // characters and every prompt below classified as chat.
  it.each([
    ["请修复这个报错", "debug"],
    ["请重构这个模块", "code_edit"],
    ["提取所有字段", "extraction"],
    ["证明这个定理", "reasoning"],
  ])("classifies %s as %s", (prompt, taskType) => {
    expect(route(prompt, undefined, 512, options()).taskType).toBe(taskType);
  });
});

describe("code-agent detection", () => {
  const web = { hasTools: true, requiresTools: true, toolCount: 1, toolNames: ["web_search"] };

  it("does not treat a bare language name in a web lookup as code work", () => {
    for (const prompt of [
      "look up current java coffee bean prices online",
      "search the web for python snake habitat facts",
    ]) {
      const decision = route(prompt, undefined, 512, options(web));
      expect(decision.taskType).toBe("tool_agent");
      expect(decision.model).not.toBe("openai/gpt-5.3-codex");
    }
  });

  it("still routes real code work with tools to the code-agent pool", () => {
    for (const prompt of [
      "Fix the TypeScript payment retry bug, run tests, and update the patch.",
      "Write a python script that parses the CSV and run it",
      "```ts\nconst x = 1\n``` refactor this",
    ]) {
      const decision = route(prompt, undefined, 512, options({ hasTools: true, requiresTools: true }));
      expect(decision.taskType).toBe("code_agent");
    }
  });
});

describe("parallel tool-call detection", () => {
  it("does not read 'add' out of 'address' when matching tool operation verbs", () => {
    const decision = route(
      "Please update my address to 12 Main St and send me a confirmation",
      undefined,
      512,
      options({
        hasTools: true,
        requiresTools: true,
        toolCount: 2,
        toolNames: ["add_item", "send_email"],
      }),
    );
    expect(decision.taskType).toBe("tool_agent");
  });

  it("still detects two distinct operation verbs", () => {
    const decision = route(
      "Add milk to my list and delete the eggs entry",
      undefined,
      512,
      options({
        hasTools: true,
        requiresTools: true,
        toolCount: 2,
        toolNames: ["add_task", "delete_task"],
      }),
    );
    expect(decision.taskType).toBe("tool_agent_parallel");
  });
});

describe("airline reservation ids", () => {
  it("does not count shouted six-letter words as two reservation ids", () => {
    const airline = {
      hasTools: true,
      requiresTools: true,
      toolCount: 3,
      toolNames: ["get_reservation_details", "cancel_reservation", "search_flights"],
    };
    const shouted = route("CANCEL MY FLIGHT please", undefined, 512, options(airline));
    expect(shouted.reasoning).toContain("agentRisk=standard");
    const twoIds = route(
      "Cancel reservations ZFA04Y and 4WQ150",
      undefined,
      512,
      options(airline),
    );
    expect(twoIds.reasoning).toContain("agentRisk=high");
  });
});

describe("portfolio ranking robustness", () => {
  it("does not let an unpriced candidate win on cost", () => {
    const withoutDeepseek = new Map(pricing);
    withoutDeepseek.delete("deepseek/deepseek-v4-pro");
    const decision = route(
      "Return the pricier of my two orders and exchange the other one for a larger size",
      undefined,
      1024,
      options({
        modelPricing: withoutDeepseek,
        hasTools: true,
        requiresTools: true,
        toolCount: 4,
        toolNames: ["get_order_details", "return_delivered_order_items", "exchange_delivered_order_items", "get_product_details"],
      }),
    );
    const unpriced = decision.candidateScores?.find((c) => c.model === "deepseek/deepseek-v4-pro");
    expect(unpriced?.cost).toBe(0);
  });

  it("ignores a malformed performance profile instead of scoring NaN", () => {
    const decision = route(
      "Summarize the plot of Hamlet in two sentences.",
      undefined,
      512,
      options({
        modelPerformance: {
          "google/gemini-2.5-flash": {
            measuredAt: "2026-11-01T00:00:00Z",
            latencyMs: 900,
            outputTokensPerSecond: Number.NaN,
            samples: Number.NaN,
          },
        },
      }),
    );
    for (const candidate of decision.candidateScores ?? []) {
      expect(Number.isFinite(candidate.score)).toBe(true);
    }
  });
});

describe("cost fields", () => {
  const tiers = {
    SIMPLE: { primary: "acme/nan", fallback: [] },
    MEDIUM: { primary: "acme/nan", fallback: [] },
    COMPLEX: { primary: "acme/nan", fallback: [] },
    REASONING: { primary: "acme/nan", fallback: [] },
  } satisfies Record<Tier, TierConfig>;
  const badPricing = new Map<string, ModelPricing>([
    ["acme/nan", { inputPrice: Number.NaN, outputPrice: 1 }],
  ]);

  it("treats a non-finite price as unknown rather than reporting NaN", () => {
    const decision = selectModel("SIMPLE", 1, "rules", "", tiers, badPricing, 1000, 1000);
    expect(Number.isFinite(decision.costEstimate)).toBe(true);
    expect(decision.savings).toBe(0);
    const cost = calculateModelCost("acme/nan", badPricing, 1000, 1000);
    expect(Number.isFinite(cost.costEstimate)).toBe(true);
    expect(cost.savings).toBe(0);
  });

  it("reports no savings for an unpriced model in calculateModelCost", () => {
    expect(calculateModelCost("acme/unknown", new Map(), 1000, 1000).savings).toBe(0);
  });
});

describe("promotions", () => {
  const promoConfig = (startDate: string, endDate: string): RoutingConfig => ({
    ...DEFAULT_ROUTING_CONFIG,
    strategy: "rules",
    promotions: [
      {
        name: "typo",
        startDate,
        endDate,
        tierOverrides: { SIMPLE: { primary: "acme/promo" } },
      },
    ],
  });
  const now = new Date("2026-11-08T00:00:00Z");

  it("ignores a promotion whose dates do not parse instead of applying it forever", () => {
    for (const [start, end] of [
      ["2026-13-01", "2026-12-01"],
      ["2026-11-01", "soon"],
    ]) {
      const decision = new RulesStrategy().route("hi", undefined, 64, {
        config: promoConfig(start, end),
        modelPricing: pricing,
        now,
      });
      expect(decision.model).not.toBe("acme/promo");
    }
  });

  it("still applies a promotion inside a valid window", () => {
    const decision = new RulesStrategy().route("hi", undefined, 64, {
      config: promoConfig("2026-11-01", "2026-11-15"),
      modelPricing: pricing,
      now,
    });
    expect(decision.tierConfigs?.[decision.tier].primary).toBe("acme/promo");
  });
});

describe("scan bounds", () => {
  it("bounds the sample even at the smallest limit", () => {
    const long = "x".repeat(100_000);
    expect(sampleForScan(long, 1).length).toBeLessThanOrEqual(2);
    expect(sampleForScan(long, scanLimit(0)).length).toBeLessThanOrEqual(2);
  });

  it("treats a non-numeric truncation setting as the default bound", () => {
    expect(scanLimit(Number.NaN)).toBe(8_000);
    expect(sampleForScan("x".repeat(100_000), scanLimit(Number.NaN)).length).toBeLessThanOrEqual(8_001);
  });
});

describe("rules signals", () => {
  const scoring = DEFAULT_ROUTING_CONFIG.scoring;
  const signalsOf = (prompt: string) =>
    classifyByRules(prompt, undefined, 20, scoring).signals.join(" | ");

  it("does not call a sentence that ends in a number multi-step", () => {
    expect(signalsOf("I was born in 1990. How old am I?")).not.toContain("multi-step");
  });

  it("still sees a numbered list as multi-step", () => {
    expect(signalsOf("Do this:\n1. install it\n2. configure it")).toContain("multi-step");
  });

  it("counts full-width question marks", () => {
    expect(signalsOf("这是什么？为什么？怎么做？什么时候？")).toContain("4 questions");
  });
});

describe("routing catalog adapter", () => {
  it("keeps bundled vision evidence when the catalog omits the vision category", () => {
    const catalog = parseModelCatalog({
      data: [
        {
          id: "anthropic/claude-haiku-4.5",
          categories: ["chat"],
          pricing: { input: 1, output: 5 },
          context_window: 200_000,
          max_output: 64_000,
        },
      ],
    });
    expect(toRoutingCatalog(catalog).modelCapabilities["anthropic/claude-haiku-4.5"].supportsVision).toBe(true);
  });

  it("lets explicit host evidence turn vision off", () => {
    const catalog = parseModelCatalog({
      data: [
        {
          id: "acme/seer",
          categories: ["chat", "vision"],
          pricing: { input: 1, output: 5 },
        },
      ],
    });
    const routing = toRoutingCatalog(catalog, {
      verifiedCapabilities: {
        "acme/seer": { contextWindow: 1, maxOutputTokens: 1, supportsTools: false, supportsVision: false },
      },
    });
    expect(routing.modelCapabilities["acme/seer"].supportsVision).toBe(false);
  });
});

describe("language band", () => {
  it("does not give Japanese extraction the Mandarin band", () => {
    const decision = route(
      "次の文章から氏名と住所を抽出して、JSONで出力してください。山田太郎、東京都。",
      undefined,
      512,
      options({ requiresStructuredOutput: true }),
    );
    expect(decision.taskType).toBe("extraction");
    const kimi = decision.candidateScores?.find((c) => c.model === "moonshot/kimi-k3");
    if (kimi) expect(kimi.quality).toBeLessThan(1);
  });
});
