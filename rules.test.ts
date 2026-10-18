import { describe, expect, it } from "vitest";

import { classifyByRules } from "./rules.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";

const scoring = DEFAULT_ROUTING_CONFIG.scoring;
const signalsFor = (prompt: string) =>
  classifyByRules(prompt, undefined, Math.ceil(prompt.length / 4), scoring).signals;

describe("classifyByRules keyword matching", () => {
  it("does not count a keyword that only appears inside a longer word", () => {
    // "classic" is not `class`, "history" is not `story`, "credit" is not `edit`,
    // "pipeline" is not `pip`, "prefix" is not `fix`.
    expect(signalsFor("I need a recipe for a classic dinner party")).not.toContainEqual(
      expect.stringContaining("code"),
    );
    expect(signalsFor("Tell me the history of the Roman Empire")).not.toContainEqual(
      expect.stringContaining("creative"),
    );
    expect(
      signalsFor("Why does my credit card pipeline report a prefix mismatch?"),
    ).not.toContainEqual(expect.stringContaining("agentic"));
  });

  it("still matches ordinary English inflections of a keyword", () => {
    expect(signalsFor("I imported the classes and defined two functions")).toContainEqual(
      expect.stringContaining("code"),
    );
    expect(signalsFor("Keep editing until the tests pass, then deploying")).toContainEqual(
      expect.stringContaining("agentic"),
    );
  });

  it("keeps substring matching for CJK keywords, which have no word boundaries", () => {
    expect(signalsFor("请帮我定义一个函数来处理输入")).toContainEqual(
      expect.stringContaining("code"),
    );
  });

  it("keeps stem matching for Cyrillic keywords", () => {
    // "оптимизаци" is a deliberate stem that must still hit "оптимизацию".
    expect(signalsFor("Проведи оптимизацию алгоритма для базы данных")).toContainEqual(
      expect.stringContaining("technical"),
    );
  });
});
