<div align="center">

<img src="assets/banner.png" alt="router-core — one engine, shared by ClawRouter, Franklin, @blockrun/llm, blockrun-llm, ClawRouter-Hermes and dsh-clawrouter" width="820">

<h1>The routing engine underneath every BlockRun product</h1>

<p>ClawRouter, Franklin, Hermes and dsh-clawrouter look like four different products.<br>
They make the same routing decision, because they all run this package.<br><br>
<strong>One engine. No inference call. Same answer everywhere.</strong><br><br>
<em>Local, deterministic, and product-neutral — no wallet, no gateway, no network on the hot path.</em></p>

<br>

<img src="https://img.shields.io/badge/⚡_Sub--millisecond-yellow?style=for-the-badge" alt="Sub-millisecond">&nbsp;
<img src="https://img.shields.io/badge/🧭_Constraint--First-black?style=for-the-badge" alt="Constraint first">&nbsp;
<img src="https://img.shields.io/badge/🔒_Zero_Network_Calls-blue?style=for-the-badge" alt="Zero network calls">&nbsp;
<img src="https://img.shields.io/badge/🔁_Deterministic-success?style=for-the-badge" alt="Deterministic">&nbsp;
<img src="https://img.shields.io/badge/🔓_Open_Source-green?style=for-the-badge" alt="Open source">

[![CI](https://img.shields.io/github/actions/workflow/status/BlockRunAI/router-core/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/BlockRunAI/router-core/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520.19-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Router](https://img.shields.io/badge/Router_Core-V3.4-cc2028?style=flat-square)](#how-a-decision-is-made)

[Report](https://blockrun.ai/signal/router-v3-4-constraint-first-auto-routing) · [Live model health](https://blockrun.ai/observatory) · [Model pricing](https://blockrun.ai/models) · [BlockRun](https://blockrun.ai)

</div>

> **`@blockrun/router-core`** decides which model should answer a request. It classifies the request across 15 local dimensions, removes every model that *cannot* satisfy the request contract, ranks only the survivors on task fit, cost, speed and reliability, and returns the winner plus an ordered fallback chain — in about a quarter of a millisecond, with no inference call and no network access.
>
> It is deliberately product-neutral. There is no wallet, no gateway client, no proxy server, no agent loop, no payment handling, no telemetry transport, and no benchmark runner in this repository. Those live in the products. This is the part they share.

---

## Why this repository exists

Routing logic that lives inside a product gets shaped by that product. Four different products with four copies of "pick a model" is four different answers to the same question, four sets of stale model tables, and four places to fix a routing bug.

So the engine was extracted. Every product that routes a request now routes it here, and a fix lands once.

The **constraint-first** ordering is the design commitment worth naming: hard requirements decide *who may compete*, scoring decides *who wins*. A model that cannot call tools, cannot read an image, or cannot hold the conversation is dropped **before** anything is scored — because being cheap or fast never compensates for failing the contract.

---

## Who runs this engine

The banner above is the shape of it; the mechanism differs per package, and that difference is what decides how an upgrade propagates.

| Product | How it reaches Router Core | Where to look |
|---|---|---|
| [**ClawRouter**](https://github.com/BlockRunAI/ClawRouter) | Direct dependency. `src/router/index.ts` is a single `export * from "@blockrun/router-core"` — the product keeps its public router surface, the logic is all here. | `@blockrun/clawrouter` |
| [**Franklin**](https://github.com/BlockRunAI/Franklin) | Direct dependency. Imports `route()` and `DEFAULT_ROUTING_CONFIG`, then layers its own learned Elo weights on top of the shared decision. | `@blockrun/franklin` |
| [**blockrun-llm-ts**](https://github.com/BlockRunAI/blockrun-llm-ts) | Direct dependency. `src/router-adapter.ts` wires this engine to `smartChat()` and the `blockrun/auto` · `blockrun/eco` · `blockrun/premium` aliases. | `@blockrun/llm` |
| [**blockrun-llm**](https://github.com/BlockRunAI/blockrun-llm) | **Line-by-line Python port** under `blockrun_llm/router_core/`, pinned to an upstream commit of this repo. A `_js.py` shim reproduces JavaScript `toFixed`, `Date.parse` and ASCII regex semantics so an identical request routes identically in both languages. | `blockrun-llm` (PyPI) |
| [**ClawRouter-Hermes**](https://github.com/BlockRunAI/ClawRouter-Hermes) | Indirect. The plugin supervises a local `@blockrun/clawrouter` proxy, so every Hermes request is routed by this engine one process away. | `hermes-plugin-clawrouter` |
| [**dsh-clawrouter**](https://github.com/BlockRunAI/dsh-clawrouter) | Indirect. Built on `@blockrun/llm`, which carries Router Core with it. | `dsh-clawrouter` (npm) |

> The Go SDK ([blockrun-llm-go](https://github.com/BlockRunAI/blockrun-llm-go)) implements the same four-tier profile contract independently. It is **not** a port of this package, and its decisions are not guaranteed to match.

---

## Install

This package is **not published to npm**. Consumers install it straight from a commit tarball, which pins the routing engine to an exact, auditable revision:

```jsonc
// package.json
{
  "dependencies": {
    "@blockrun/router-core": "https://codeload.github.com/BlockRunAI/router-core/tar.gz/<commit-sha>"
  }
}
```

A tarball install runs no build step, so `dist/` is **committed to this repository** and CI fails the build when it drifts from source. Upgrading a consumer means bumping one SHA — and because the SHA is in the lockfile, a routing change can never arrive unnoticed.

Node ≥ 20.19. Zero runtime dependencies.

---

## Quick start

```ts
import { DEFAULT_ROUTING_CONFIG, route } from "@blockrun/router-core";

const decision = route(prompt, systemPrompt, maxOutputTokens, {
  config: DEFAULT_ROUTING_CONFIG,
  modelPricing,          // Map<modelId, { inputPrice, outputPrice }> per 1M tokens
  hasTools: true,        // tools are attached to this request
  requiresTools: true,   // ...and this turn actually has to use them
});

decision.model;       // the model that should serve the request
decision.candidates;  // ordered fallback chain — walk it on a 5xx or timeout
decision.reasoning;   // human-readable explanation of the pick
```

Real output from the bundled defaults (`node` on the committed `dist/`):

```jsonc
// route("What is the capital of France?", undefined, 256, { ... })
{
  "model": "google/gemini-2.5-flash",
  "tier": "SIMPLE",
  "taskType": "chat",
  "profile": "auto",
  "confidence": 0.77,
  "candidates": ["google/gemini-2.5-flash", "google/gemini-3-flash-preview", "deepseek/deepseek-chat", "…"],
  "reasoning": "score=-0.10 | short (8 tokens), simple (what is, capital of) | v3 task=chat agentRisk=standard … candidates=9"
}

// route("Prove that the sum of two odd integers is even, step by step.", undefined, 4096, { ... })
{
  "model": "deepseek/deepseek-v4-pro",
  "tier": "REASONING",
  "taskType": "reasoning",
  "confidence": 0.97,
  "candidates": ["deepseek/deepseek-v4-pro", "xai/grok-4-1-fast-reasoning", "xai/grok-4-fast-reasoning", "…"]
}

// same request, tools attached: "Cancel order B-42 and book the 9am flight to SFO."
{
  "model": "anthropic/claude-opus-4.8",
  "taskType": "tool_agent_parallel",
  "profile": "agentic",
  "reasoning": "… | agentic (tools) | v3 task=tool_agent_parallel agentRisk=high … candidates=12"
}
```

**Measured cost of a decision: ~0.05 ms warm, ~0.15 ms including JIT warm-up** (mixed prompt shapes up to 33KB, Node 22, M-series laptop — feature extraction is bounded, so a 400KB prompt still routes in under 0.1 ms). No process leaves the machine.

---

## How a decision is made

Four stages, all local, all deterministic for identical inputs, config, model metadata and time.

### 1 · Read deterministic request signals

A 15-dimension weighted scorer maps the request onto a capability tier, and a task classifier labels the *shape* of the work.

```
tokenCount · codePresence · reasoningMarkers · technicalTerms · creativeMarkers
simpleIndicators · multiStepPatterns · questionComplexity · imperativeVerbs
constraintCount · outputFormat · referenceComplexity · negationComplexity
domainSpecificity · agenticTask
```

Alongside the tier, the router derives task shape and risk from the prompt, the visible tool names and tool count, requested output size, and language: `chat`, `extraction`, `code_edit`, `code_agent`, `tool_agent`, `tool_agent_parallel`, `debug`, `reasoning`, `reasoning_mcq`, `reasoning_math`, `long_context`, `vision`.

This is not an LLM classifier on the hot path. Every feature is local, bounded, testable, and available *before* inference.

### 2 · Apply hard eligibility

Candidates that cannot satisfy the request are removed before anything is scored:

- no tool-calling support for a tool-required request
- no vision support for image input
- insufficient context window for the conversation
- insufficient max-output capacity for the requested length
- incompatible structured-output path
- absent from the active model catalog

**Capability errors never enter the preference stage.** This is what "constraint-first" means, and it is why the router fails closed rather than optimistically cheap.

### 3 · Rank the survivors

Six bounded factors, per profile. Auto's defaults:

| Component | Auto weight | Role |
|---|---:|---|
| Task quality | 0.47 | Prefer models validated for the detected work |
| Capability | 0.20 | Preserve the request contract after hard filtering |
| Estimated cost | 0.18 | Reward efficient qualified candidates |
| Speed | 0.07 | Improve ordinary interactive latency |
| Reliability | 0.03 | Prefer stable candidates |
| Curated order | 0.05 | Retain a small, explainable prior |

Eco raises the cost weight; Premium raises quality and reliability. High-stakes and latency-sensitive requests shift the balance **without** changing eligibility. An `affinityFloorGap` stops a candidate materially below the best task affinity from winning on price alone.

### 4 · Keep the recovery path

Everything that survived filtering stays, in rank order, as `decision.candidates`. Hosts walk that chain on a timeout or 5xx. The winner is chosen once — there is no mid-task model drift and no auxiliary routing request.

### Tiers and profiles

Four capability tiers — `SIMPLE`, `MEDIUM`, `COMPLEX`, `REASONING` — crossed with four routing profiles:

| Profile | Intent |
|---|---|
| `eco` | Cheapest capable model; the first stop is the free tier, so simple requests can cost $0.00 |
| `auto` | Default. Best balance of cost and quality |
| `premium` | Quality-critical work |
| `agentic` | Auto-selected when the turn actually needs tools; prefers models that keep going instead of stopping to ask |

Every decision is explainable: `tier`, `taskType`, `confidence`, ranked `candidates`, per-candidate `candidateScores` (quality / cost / speed / reliability) and a `reasoning` string.

---

## The benchmark

Two independent evidence streams feed this repository, and they answer different questions.

### Does the routing policy pick better? — the agent checkpoint

Routing quality is measured on **full agent sessions**, not prompt labels, because the only question that matters is whether the selected model *completes the task*. Three public benchmark families, run through one host framework with their own validators:

| Source family | Share of strict cohort | What it measures |
|---|---:|---|
| [τ-bench](https://github.com/sierra-research/tau-bench) family | 55% | Stateful tool use under domain policies |
| [BrowseComp](https://openai.com/index/browsecomp/) | 25% | Multi-hop web research ending in an exact answer |
| [Terminal-Bench](https://www.tbench.ai/benchmarks) | 20% | End-to-end terminal and repository work |

Three arms per task triple — previous rules router, this constraint-first router, and fixed flagship — sharing a frozen model catalog, pricing snapshot, tool surface and scorer.

**V3.4 checkpoint:** verified task success **49% → 57%** (+8 points). Normalized cost per *successful* task fell **6.4%**. Against pinning the flagship on every task, the router used **8.9%** of the normalized token cost while giving up 10 points of success.

And the limits, because a benchmark that only publishes wins is not evidence: the paired 95% interval on the quality gain is **−1.9 to +15.5 points** and crosses zero; the router is *not* statistically proven better across the production distribution; it does not match flagship quality; p95 session latency regressed. The machine-readable scorecard records `releaseEligible: false`.

📄 **Full method, figures and the four failure classes: [A Constraint-First Model Router for AI Agents](https://blockrun.ai/signal/router-v3-4-constraint-first-auto-routing)**

### How fast and reliable is each model? — the live performance run

`model-profiles.generated.json` carries speed and reliability observations refreshed from BlockRun's gateway benchmark and published live at **[blockrun.ai/observatory](https://blockrun.ai/observatory)**:

```jsonc
"openai/gpt-5.3-codex": {
  "measuredAt": "2026-07-21T10:21:31Z",
  "latencyMs": 4617.1,
  "p95LatencyMs": 5800.7,
  "outputTokensPerSecond": 12.48,
  "errorRate": 0,
  "samples": 3
}
```

Two rules govern this file, and both are load-bearing:

1. **These are weak priors, never task-quality labels.** They inform the `speed` and `reliability` terms only. A model is not "better" because it is fast.
2. **Historical numbers are never presented as a current provider SLA.** Hosts are expected to inject fresher observations (see below); the committed snapshot exists so the engine is safe and useful when a catalog is temporarily unavailable.

The repository ships 30 live profiles plus 13 auditable historical seeds, and a built-in capability snapshot for 46 models.

---

## Feeding the router live data

The engine never makes a network call. Everything current is **injected** by the host, which keeps routing on the hot path while still tracking a catalog that moves faster than this package releases.

```ts
const decision = route(prompt, systemPrompt, maxOutputTokens, {
  config: DEFAULT_ROUTING_CONFIG,
  modelPricing,          // required — current prices from your catalog
  modelCapabilities,     // optional — overrides the built-in 46-model snapshot
  modelPerformance,      // optional — fresh speed/reliability, e.g. the Observatory feed
  routingProfile: "auto",
  hasTools, toolCount, toolNames, requiresTools,
  hasVision,
  requiresStructuredOutput,
  now,                   // optional — override time for promotion-window tests
});
```

Wiring the live health feed to `modelPerformance` is the intended production setup:

```ts
import { LIVE_MODEL_PROFILES } from "@blockrun/router-core";

// The same feed the Observatory renders: per-model p50/p95/p99, uptime and
// error rate over a 24h window.
const { timestamp, models } = await fetch("https://blockrun.ai/api/v1/health/models").then((r) =>
  r.json(),
);

const modelPerformance = Object.fromEntries(
  models
    // `synthetic: true` means "no real traffic, showing a default" — those rows
    // carry zero latency and would poison the speed term. Skip them entirely
    // and let the committed prior stand in.
    .filter((m) => !m.synthetic && m.callCount24h > 0)
    .map((m) => [
      m.model,
      {
        measuredAt: timestamp,
        latencyMs: m.latency.avg,
        p95LatencyMs: m.latency.p95,
        // This feed measures latency, not throughput. `outputTokensPerSecond`
        // is required and feeds half the speed term, so carry the committed
        // prior forward rather than sending a 0 that reads as "slowest model".
        outputTokensPerSecond: LIVE_MODEL_PROFILES[m.model]?.outputTokensPerSecond ?? 100,
        errorRate: m.errorRate24h,
        samples: m.callCount24h,
      },
    ]),
);
```

Freshness is priced in: observations decay on a **30-day half-life** and are down-weighted below ten samples, so three quick probes can nudge a ranking but cannot overturn a curated order on a transient provider tail.

Omitted entries fall back to a weak historical prior rather than disqualifying a model — the router degrades, it does not fail.

---

## API

| Export | Purpose |
|---|---|
| `route(prompt, systemPrompt, maxOutputTokens, options)` | The entry point. Returns a `RoutingDecision`. |
| `DEFAULT_ROUTING_CONFIG` | Router Core V3.4 config: tiers, profiles, weights, promotions. |
| `DEFAULT_MODEL_CAPABILITIES` | Built-in capability snapshot (context, max output, tools, vision). |
| `LIVE_MODEL_PROFILES` / `HISTORICAL_MODEL_PROFILES` | Performance priors. |
| `PortfolioStrategy` / `RulesStrategy` | V3 portfolio scorer and the stable V2 rules selector. |
| `getStrategy` / `registerStrategy` | Swap in your own `RouterStrategy`. |
| `classifyByRules` | Tier classification on its own. |
| `inferToolRequirement` | Whether a turn actually needs the attached tools. |
| `getFallbackChain` / `getFallbackChainFiltered` | Ordered recovery chains. |
| `filterByToolCalling` / `filterByVision` / `filterByExcludeList` / `filterCandidatesByCapacity` | The hard filters, individually. |
| `calculateModelCost` | Cost estimate for a model and token count. |

### Escape hatches

- **One-line rollback.** `config.strategy = "rules"` reverts to the V2 tier selector without a code change.
- **Shadow evaluation.** `config.shadow = { strategy: "rules", sampleRate: 0.1 }` recomputes a comparison decision locally without changing the model that serves the request. The host emits decision metadata only — it never persists prompt content and never makes a second call.
- **Promotions.** Time-windowed `tierOverrides` that apply themselves inside their date range and are ignored outside it, so a launch promo needs no release.
- **Custom strategies.** Implement `RouterStrategy`, `registerStrategy(yours)`, point `config.strategy` at it.

---

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest — 94 tests across 4 files
npm run build       # tsup → dist/
npm run check       # all three, and what CI runs
```

Two rules keep consumers safe:

1. **`dist/` is committed and must match source.** Tarball installs run no build step, so a source edit without a rebuild would silently ship a stale artifact to every pinned consumer. CI runs `git diff --exit-code -- dist`.
2. **Routing changes need test coverage.** The decision path is the product for six downstream packages; `portfolio.test.ts`, `selector.test.ts`, `strategy.test.ts` and `tool-intent.test.ts` are the contract.

When the routing logic changes, the [Python port](https://github.com/BlockRunAI/blockrun-llm) has to follow — it is pinned to an upstream commit and its tests assert cross-language parity.

---

## From the BlockRun ecosystem

<table>
<tr>
<td width="50%">

### 🧭 router-core

**The routing engine underneath all of it**

You're here. Classify, filter, rank — locally, deterministically, in under a millisecond.

`"@blockrun/router-core": "https://codeload.github.com/BlockRunAI/router-core/tar.gz/<sha>"`

</td>
<td width="50%">

### 🦞 [ClawRouter](https://github.com/BlockRunAI/ClawRouter)

**The LLM router built for autonomous agents**

Wallet signatures instead of API keys, USDC per request instead of credit cards. This engine, wrapped in a proxy an agent can actually use.

`curl -fsSL https://blockrun.ai/ClawRouter-update | bash`

</td>
</tr>
<tr>
<td width="50%">

### 💵 [Franklin](https://github.com/BlockRunAI/Franklin)

**The AI agent with a wallet**

Spends USDC autonomously to get real work done. Routes with this engine, then personalizes with learned Elo weights.

`npm install -g @blockrun/franklin`

</td>
<td width="50%">

### 📦 [SDKs](https://github.com/BlockRunAI/blockrun-llm-ts)

**TypeScript · Python**

`smartChat()` / `smart_chat()` — one-line routed chat. The Python SDK carries a line-by-line port of this engine.

`npm install @blockrun/llm` · `pip install blockrun-llm`

</td>
</tr>
<tr>
<td width="50%">

### 🏛️ [ClawRouter-Hermes](https://github.com/BlockRunAI/ClawRouter-Hermes)

**ClawRouter for NousResearch Hermes**

Supervises the ClawRouter proxy for `hermes-agent`, with native Hermes ergonomics.

`pip install hermes-plugin-clawrouter`

</td>
<td width="50%">

### 🛡️ [dsh-clawrouter](https://github.com/BlockRunAI/dsh-clawrouter)

**A second brain for DeepSeek Harness**

A stronger model reviews the dangerous command before it runs. Built on the TypeScript SDK.

`dsh plugin --profile web add dsh-clawrouter`

</td>
</tr>
</table>

---

## More resources

| Resource | What it covers |
|---|---|
| [Constraint-first router report](https://blockrun.ai/signal/router-v3-4-constraint-first-auto-routing) | Full V3.4 method, figures, statistics and limits |
| [Observatory](https://blockrun.ai/observatory) | Live model latency, p95, uptime and error rate |
| [Model pricing](https://blockrun.ai/models) | Current catalog and prices |
| [Routing profiles](https://github.com/BlockRunAI/ClawRouter/blob/main/docs/routing-profiles.md) | Eco / Auto / Premium in product terms |
| [15-dimension classifier](https://github.com/BlockRunAI/ClawRouter/blob/main/docs/smart-llm-router-14-dimension-classifier.md) | How the scorer reads a request |
| [BlockRun docs](https://blockrun.ai/docs) | Gateway, payments, everything else |

---

## FAQ

**Can I use this without BlockRun?**
Yes. It is MIT-licensed and has no BlockRun dependency — you supply `modelPricing` and, optionally, `modelCapabilities`. The default config happens to be tuned against BlockRun's catalog; replace it and the engine routes across yours.

**Does it call an LLM to decide?**
No. There is no classifier model, no network access, and no I/O on the decision path. A warm decision costs ~0.05 ms.

**Is it deterministic?**
Yes, for identical inputs, configuration, model metadata and time. `options.now` exists so time-windowed promotions are testable.

**Why isn't it on npm?**
Commit-tarball installs pin the routing engine to an exact revision in the consumer's lockfile. Six packages depend on this decision path; a routing change should never arrive as a silent patch bump.

**Why is `dist/` in the repository?**
Because a tarball install runs no build step. CI verifies it matches source on every push.

---

<div align="center">

**MIT licensed** · Built by [BlockRun](https://blockrun.ai)

[Telegram](https://t.me/blockrunAI) · [Issues](https://github.com/BlockRunAI/router-core/issues) · [blockrun.ai](https://blockrun.ai)

</div>
