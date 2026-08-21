/**
 * Decision-snapshot regression net.
 *
 * The other test files assert properties; this one pins outcomes. It routes a
 * fixed corpus — 22 prompts spanning every task type the classifier can emit,
 * crossed with 4 profiles and a rotation of tool/vision/structured-output
 * shapes — against frozen pricing and a frozen clock, and compares the
 * complete decisions against decisions.snapshot.json.
 *
 * Two kinds of change hit this file, and they should feel different:
 *
 *  - A refactor must leave the snapshot byte-identical. If this test fails on
 *    a change you believed was behavior-preserving, it was not.
 *  - A deliberate routing change (config tweak, scoring change, model EOL)
 *    must regenerate the snapshot: `UPDATE_DECISION_SNAPSHOT=1 npx vitest run
 *    decisions.snapshot.test.ts`. The resulting JSON diff in review is the
 *    change's decision-level footprint — reviewers see which requests moved,
 *    not just which weights did.
 *
 * Full decisions are pinned deliberately — reasoning strings included, since
 * hosts and the Python port assert on their wording. Costs are deterministic
 * because pricing and `now` are frozen. The one omission is `tierConfigs`:
 * it echoes the config for every row, so pinning it would turn any one-tier
 * config edit into an 88-row diff, and the selected chain is already pinned
 * through `candidates`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CAPABILITIES } from "./model-capabilities.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import { route } from "./index.js";

const SNAPSHOT_PATH = new URL("./decisions.snapshot.json", import.meta.url);

// Deterministic, deliberately varied prices; the anchor keeps real pricing so
// savings figures stay meaningful.
const PRICING = new Map(
  Object.keys(DEFAULT_MODEL_CAPABILITIES).map((model, index) => [
    model,
    { inputPrice: 0.1 + (index % 7) * 0.7, outputPrice: 0.4 + (index % 5) * 2.1 },
  ]),
);
PRICING.set("anthropic/claude-opus-4.7", { inputPrice: 5, outputPrice: 25 });

const NOW = new Date("2026-08-20T00:00:00Z");

const PROMPTS: readonly string[] = [
  "What is the capital of France?",
  "hi",
  "Explain the difference between TCP and UDP in one paragraph.",
  "Write a Python function that checks if a string is a valid IPv4 address. Include edge cases.",
  "Prove that the sum of two odd integers is even, step by step.",
  "Refactor this React component to use hooks:\n```jsx\nclass Foo extends React.Component { render() { return <div/> } }\n```",
  "Cancel order B-42 and book the 9am flight to SFO.",
  "What's the weather in Tokyo, Paris, and New York?",
  "帮我总结这篇文章的要点，不超过三句话。",
  "设计一个分布式限流器，要求支持滑动窗口和多机房容灾，并给出伪代码。",
  "debug: TypeError: Cannot read properties of undefined (reading 'map') at UserList.render",
  "Summarize the following contract clause and list any obligations: " + "lorem ipsum ".repeat(400),
  "Which of the following is NOT a prime? (a) 17 (b) 21 (c) 23 (d) 29. Answer with the letter only.",
  "Solve for x: 3x^2 - 12x + 9 = 0. Show your work.",
  "Extract all email addresses and phone numbers from this text as JSON: contact bob@x.com or 555-1234",
  "rm -rf the old build directory, then rerun the release pipeline and paste the log tail",
  "Investigate why the checkout page p95 regressed after Tuesday's deploy. Check the CDN config, the API gateway logs, and the database slow query log.",
  "Write a haiku about autumn rain.",
  "Translate 'the quick brown fox jumps over the lazy dog' into German, French, and Japanese.",
  "Plan a 7-day itinerary for Kyoto in November with a daily budget of $150, must include one onsen day and avoid Mondays for museums.",
  "Design the architecture for a multi-tenant SaaS billing system: requirements, data model, service boundaries, failure modes, migration plan from the legacy monolith, and a rollout strategy with feature flags.",
  "Here is our full incident log, produce a postmortem timeline: " +
    "07:14 api-gw 502 spike; 07:16 pod restart loop; ".repeat(1200),
];

// Rotated by prompt index so every profile sees every request shape.
const SHAPES: readonly Partial<Parameters<typeof route>[3]>[] = [
  {},
  {
    hasTools: true,
    requiresTools: true,
    toolCount: 4,
    toolNames: ["cancel_order", "book_flight", "search_flights", "get_user"],
  },
  { hasVision: true },
  { requiresStructuredOutput: true },
  {
    hasTools: true,
    requiresTools: false,
    toolCount: 12,
    toolNames: ["read_file", "write_file", "run_shell", "search_code"],
  },
];

const PROFILES = [undefined, "eco", "auto", "premium"] as const;

function routeCorpus(): unknown[] {
  const decisions: unknown[] = [];
  for (const profile of PROFILES) {
    for (let i = 0; i < PROMPTS.length; i++) {
      const decision = route(
        PROMPTS[i],
        i % 3 === 0 ? "You are a helpful assistant." : undefined,
        256 + (i % 4) * 1024,
        {
          config: DEFAULT_ROUTING_CONFIG,
          modelPricing: PRICING,
          routingProfile: profile,
          now: NOW,
          ...SHAPES[i % SHAPES.length],
        },
      );
      const { tierConfigs: _omitted, ...pinned } = decision;
      decisions.push({ prompt: i, profile: profile ?? "default", ...pinned });
    }
  }
  return decisions;
}

describe("decision snapshot", () => {
  it("routes the frozen corpus exactly as the committed snapshot records", () => {
    const actual = JSON.stringify(routeCorpus(), null, 1) + "\n";
    if (process.env.UPDATE_DECISION_SNAPSHOT) {
      writeFileSync(SNAPSHOT_PATH, actual);
      return;
    }
    const expected = readFileSync(SNAPSHOT_PATH, "utf8");
    expect(actual).toBe(expected);
  });
});
