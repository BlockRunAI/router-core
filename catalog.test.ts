import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ROUTING_CONFIG, MODEL_KINDS, parseModelCatalog, route, toRoutingCatalog,
} from "./index.js";
import type { ModelCapabilities } from "./index.js";

const chat = (id = "openai/gpt-6.1-sol", extra: Record<string, unknown> = {}) => ({
  id, name: "GPT-6.1 Sol", categories: ["chat", "vision", "reasoning"],
  context_window: 1_050_000, max_output: 128_000, billing_mode: "paid",
  pricing: { input: 2, output: 10 }, ...extra,
});
const media = (kind: "image" | "video" | "music", id = `future/${kind}-next`) => ({
  id, name: `New ${kind}`, categories: [kind],
  pricing: { [kind === "image" ? "per_image" : kind === "video" ? "per_second" : "per_track"]: 0.12 },
});

describe("unified model catalog", () => {
  it("discovers current chat and media models and keeps gateway prices in their original units", () => {
    const catalog = parseModelCatalog({ data: [chat(), ...[media("image"), media("video"), media("music")]] });
    expect(MODEL_KINDS.map(kind => catalog[kind].length)).toEqual([1, 1, 1, 1]);
    expect(catalog.models).toHaveLength(4);
    expect(catalog.chat[0]).toMatchObject({
      id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", free: false,
      contextWindow: 1_050_000, maxOutputTokens: 128_000, pricing: { input: 2, output: 10 },
    });
    expect(catalog.image[0].pricing).toEqual({ per_image: 0.12 });
    expect(catalog.video[0].pricing).toEqual({ per_second: 0.12 });
    expect(catalog.music[0].pricing).toEqual({ per_track: 0.12 });
  });

  it("accepts newly listed and multi-category IDs, including version and colon suffixes", () => {
    const catalog = parseModelCatalog({ data: [
      chat("new-provider/model-7.2:free", { name: "Next Model", categories: ["chat", "image", "vision"], pricing: { input: 1, output: 3, per_image: 0.4 } }),
      media("image", "xai/grok-imagine-image-pro"), media("image", "zai/cogview-4"),
      media("video", "bytedance/seedance-1.5-pro"),
    ] });
    expect(catalog.chat[0].name).toBe("Next Model");
    expect(catalog.chat[0].kinds).toEqual(["chat", "image"]);
    expect(catalog.image).toHaveLength(3);
    expect(catalog.video[0].id).toBe("bytedance/seedance-1.5-pro");
  });

  it("requires an explicit free billing mode as well as zero token prices", () => {
    const catalog = parseModelCatalog({ data: [
      chat("acme/zero", { pricing: { input: 0, output: 0 } }),
      chat("acme/free", { billing_mode: "free", pricing: { input: 0, output: 0 } }),
      chat("acme/not-free", { billing_mode: "free", pricing: { input: 0, output: 1 } }),
    ] });
    expect(catalog.chat.map(m => m.free)).toEqual([false, true, false]);
  });

  it.each([null, {}, { data: null }, { data: {} }, [], { error: "offline" }])("rejects malformed envelopes rather than clearing a host cache: %j", value => {
    expect(() => parseModelCatalog(value)).toThrow(TypeError);
  });

  it("allows an explicitly empty catalog and does not borrow models from another network", () => {
    const base = parseModelCatalog({ data: [chat(), media("video", "azure/sora-2")] });
    const solana = parseModelCatalog({ data: [chat()] });
    expect(base.video).toHaveLength(1);
    expect(solana.video).toEqual([]);
    expect(parseModelCatalog({ data: [] }).models).toEqual([]);
  });

  it("drops hidden, unavailable, malformed and incorrectly priced rows", () => {
    const catalog = parseModelCatalog({ data: [
      null, 42, chat("../escape"), chat("acme/missing", { categories: null }),
      chat("acme/hidden", { hidden: true }), chat("acme/off", { available: false }),
      chat("acme/ambiguous", { available: "true" }), chat("acme/bad", { pricing: { input: -1, output: 1 } }),
      chat("acme/infinite", { pricing: { input: Infinity, output: 1 } }),
      { ...media("image"), pricing: { per_image: NaN } },
      { ...media("video"), pricing: { per_image: 0.1 } },
      { ...media("music"), pricing: { per_track: "0.1" } },
      chat(),
    ] });
    expect(catalog.models.map(m => m.id)).toEqual(["openai/gpt-6.1-sol"]);
  });

  it("treats the last duplicate as authoritative, including a retirement or invalid replacement", () => {
    const catalog = parseModelCatalog({ data: [
      chat("acme/update"), chat("acme/remove"), chat("acme/invalid"),
      chat("acme/update", { name: "Updated" }), chat("acme/remove", { available: false }),
      chat("acme/invalid", { pricing: null }),
    ] });
    expect(catalog.models.map(m => [m.id, m.name])).toEqual([["acme/update", "Updated"]]);
  });

  it("does not truncate a growing catalog or modify the caller's payload", () => {
    const input = { data: Array.from({ length: 600 }, (_, i) => chat(`acme/model-${i}`)) };
    const original = structuredClone(input);
    const catalog = parseModelCatalog(input);
    expect(catalog.chat).toHaveLength(600);
    input.data[0].categories.push("music");
    expect(catalog.chat[0].categories).not.toContain("music");
    expect(input.data.slice(1)).toEqual(original.data.slice(1));
  });
});

describe("chat routing catalog adapter", () => {
  it("feeds GPT-6.1 Sol's verified tools and live limits into the existing router", () => {
    const catalog = parseModelCatalog({ data: [chat(), media("image")] });
    const routing = toRoutingCatalog(catalog);
    expect(routing.modelPricing.size).toBe(1);
    expect(routing.modelCapabilities["openai/gpt-6.1-sol"]).toEqual({
      contextWindow: 1_050_000, maxOutputTokens: 128_000, supportsTools: true, supportsVision: true,
    });
    const decision = route("Search the latest news using web_search", undefined, 256, {
      config: DEFAULT_ROUTING_CONFIG, ...routing, hasTools: true, requiresTools: true, toolNames: ["web_search"],
    });
    expect(decision.model).toBe("openai/gpt-6.1-sol");
    expect(decision.candidates?.every(id => id === "openai/gpt-6.1-sol")).toBe(true);
    expect(routing.unavailableModels).toContain("openai/gpt-6-astra");
  });

  it("does not infer tool support from a new model's name or categories", () => {
    const catalog = parseModelCatalog({ data: [chat("future/tool-agent", { categories: ["chat", "tools"] })] });
    expect(toRoutingCatalog(catalog).modelCapabilities["future/tool-agent"].supportsTools).toBe(false);
    const capabilities: ModelCapabilities = { contextWindow: 500_000, maxOutputTokens: 32_000, supportsTools: true, supportsVision: false };
    const routing = toRoutingCatalog(catalog, { verifiedCapabilities: { "future/tool-agent": capabilities } });
    expect(routing.modelCapabilities["future/tool-agent"].supportsTools).toBe(true);
    expect(routing.modelCapabilities["future/tool-agent"].contextWindow).toBe(1_050_000);
  });

  it("uses verified fallback limits only when the live catalog lacks valid limits", () => {
    const routing = toRoutingCatalog(parseModelCatalog({ data: [
      chat("openai/gpt-6.1-sol", { context_window: -1, max_output: 0 }),
      chat("future/unknown", { context_window: Infinity, max_output: "large" }),
    ] }));
    expect(routing.modelCapabilities["openai/gpt-6.1-sol"].contextWindow).toBe(1_050_000);
    expect(routing.modelCapabilities["future/unknown"]).toMatchObject({ contextWindow: 0, maxOutputTokens: 0, supportsTools: false });
  });

  it("removes absent custom chain and promotion IDs without injecting media into chat", () => {
    const config = structuredClone(DEFAULT_ROUTING_CONFIG);
    config.tiers.SIMPLE = { primary: "custom/offline", fallback: ["openai/gpt-6.1-sol"] };
    config.promotions = [{ name: "test", startDate: "2026-01-01", endDate: "2027-01-01", tierOverrides: { SIMPLE: { primary: "custom/promo" } } }];
    const routing = toRoutingCatalog(parseModelCatalog({ data: [chat(), media("image"), media("video"), media("music")] }), { config });
    expect(routing.unavailableModels).toEqual(expect.arrayContaining(["custom/offline", "custom/promo"]));
    expect([...routing.modelPricing.keys()]).toEqual(["openai/gpt-6.1-sol"]);
  });

  it("performs no network requests during parsing, adaptation or routing", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("unexpected network"); });
    try {
      const routing = toRoutingCatalog(parseModelCatalog({ data: [chat()] }));
      route("hello", undefined, 256, { config: DEFAULT_ROUTING_CONFIG, ...routing });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
});
