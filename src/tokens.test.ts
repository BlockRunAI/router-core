import { describe, expect, it } from "vitest";

import { estimateTokens, sampleForScan } from "./tokens.js";

describe("estimateTokens", () => {
  it("keeps the four-characters-per-token estimate for Latin text", () => {
    const text = "The quick brown fox jumps over the lazy dog.".repeat(10); // 440 chars
    expect(estimateTokens(text)).toBe(110);
  });

  it("counts a CJK character as roughly one token, not a quarter of one", () => {
    const text = "这是一段需要总结的中文合同文本。".repeat(100); // 1600 chars
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThanOrEqual(1400);
    expect(tokens).toBeLessThanOrEqual(1700);
  });

  it("adds the two estimates for mixed text", () => {
    const latin = "a".repeat(400); // 100 tokens
    const cjk = "中".repeat(100); // ~100 tokens
    expect(estimateTokens(latin + cjk)).toBe(200);
  });

  it("returns zero for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("sampleForScan", () => {
  it("returns short text unchanged", () => {
    expect(sampleForScan("hello", 10)).toBe("hello");
  });

  it("keeps both ends of a long text so the instruction survives at either boundary", () => {
    const text = `HEAD ${"x".repeat(100)} TAIL`;
    const sampled = sampleForScan(text, 20);
    expect(sampled.startsWith("HEAD")).toBe(true);
    expect(sampled.endsWith("TAIL")).toBe(true);
    expect(sampled.length).toBeLessThanOrEqual(21);
  });
});
