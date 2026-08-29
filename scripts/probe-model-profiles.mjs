#!/usr/bin/env node
/**
 * Live performance probe → model-profiles.generated.json
 *
 * Pays for real, uncached, non-streaming completions against the BlockRun
 * gateway and records what the router treats as weak speed/reliability
 * priors: mean latency, p95 latency, output tokens/second, error rate and the
 * sample count. It also fires one function-calling request per model and
 * records whether a well-formed tool call came back — that is the only
 * evidence `sync-model-capabilities.mjs` accepts for `supportsTools`.
 *
 * These numbers are never task-quality labels (see model-profiles.ts).
 *
 * Usage:
 *   npm i --no-save @blockrun/llm            # one-off; the package has no runtime deps
 *   BLOCKRUN_WALLET_KEY=0x… node scripts/probe-model-profiles.mjs [--samples 3] [--concurrency 4]
 *       [--catalog path/to/models.json] [--only id,id] [--skip id,id]
 *
 * Writes model-profiles.generated.json and scripts/probe-tools.json next to
 * the repository root. Cost: roughly (models × (samples+1) × 512 tokens) —
 * about $1 for the whole catalog at 2026-08 prices.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_URL = "https://blockrun.ai/api/v1/models";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const SAMPLES = Number(flag("samples", 3));
const CONCURRENCY = Number(flag("concurrency", 4));
const MAX_TOKENS = 512;
const ONLY = flag("only", "")?.split(",").filter(Boolean) ?? [];
const SKIP = new Set(flag("skip", "")?.split(",").filter(Boolean) ?? []);

// Never probed: $30+/M "pro" reasoning SKUs. None sits in a chain, and one
// 512-token sample costs more than the rest of a provider's family combined.
const EXPENSIVE_OUTPUT_PER_M = 100;

const PROMPTS = [
  "Write a Python function that checks if a string is a valid IPv4 address. Include edge cases and a docstring.",
  "Write a Python function that finds the longest common subsequence of two strings. Include type hints and examples.",
  "Write a Python function that implements a simple LRU cache using OrderedDict. Include usage examples.",
];

const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
};

const key = process.env.BLOCKRUN_WALLET_KEY || process.env.BASE_CHAIN_WALLET_KEY;
if (!key) {
  console.error("BLOCKRUN_WALLET_KEY is required (a Base wallet holding USDC).");
  process.exit(1);
}

const { LLMClient } = await import("@blockrun/llm");
const client = new LLMClient({ privateKey: key, timeout: 180_000 });

async function loadCatalog() {
  const path = flag("catalog", null);
  const json = path
    ? JSON.parse(readFileSync(resolve(path), "utf8"))
    : await fetch(CATALOG_URL).then((r) => r.json());
  return json.data.filter(
    (m) =>
      m.context_window &&
      (m.billing_mode === "paid" || m.billing_mode === "free") &&
      (m.pricing?.output ?? 0) < EXPENSIVE_OUTPUT_PER_M,
  );
}

function pct(values, p) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function sample(model, prompt) {
  const start = performance.now();
  try {
    const res = await client.chatCompletion(model, [{ role: "user", content: prompt }], {
      maxTokens: MAX_TOKENS,
      temperature: 0.7,
    });
    const latencyMs = performance.now() - start;
    const out = res.usage?.completion_tokens ?? 0;
    const content = res.choices?.[0]?.message?.content ?? "";
    return {
      ok: true,
      latencyMs,
      outputTokens: out,
      tps: out > 0 ? out / (latencyMs / 1000) : 0,
      finish: res.choices?.[0]?.finish_reason ?? null,
      emptyContent: content.trim().length === 0,
    };
  } catch (err) {
    return { ok: false, latencyMs: performance.now() - start, error: String(err?.message ?? err).slice(0, 200) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A model "supports tools" when a well-formed call comes back. One attempt
// with tool_choice "auto" is not enough evidence of *absence*: a capable
// model may simply answer in prose, and a free tier may 429 under the probe's
// own concurrency. So a miss is retried with tool_choice "required", and a
// rate-limit or transient 5xx is retried after a pause. Only after every
// attempt fails is the model recorded as tool-incapable.
async function toolProbe(model) {
  const attempts = ["auto", "required", "required"];
  let last = { supportsTools: false };
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(4_000);
    try {
      const res = await client.chatCompletion(
        model,
        [{ role: "user", content: "What is the weather in Tokyo right now? Use the get_weather tool." }],
        { maxTokens: 256, tools: [WEATHER_TOOL], toolChoice: attempts[i] },
      );
      const calls = res.choices?.[0]?.message?.tool_calls ?? [];
      const call = calls[0];
      let wellFormed = false;
      if (call?.function?.name === "get_weather") {
        try {
          const parsed = JSON.parse(call.function.arguments ?? "{}");
          wellFormed = typeof parsed.city === "string" && parsed.city.length > 0;
        } catch {
          wellFormed = false;
        }
      }
      last = {
        supportsTools: wellFormed,
        toolCalls: calls.length,
        toolChoice: attempts[i],
        finish: res.choices?.[0]?.finish_reason ?? null,
      };
      if (wellFormed) return last;
    } catch (err) {
      last = { supportsTools: false, toolChoice: attempts[i], error: String(err?.message ?? err).slice(0, 200) };
    }
  }
  return last;
}

async function probe(model) {
  const runs = [];
  for (let i = 0; i < SAMPLES; i++) {
    runs.push(await sample(model, PROMPTS[i % PROMPTS.length]));
  }
  const tools = await toolProbe(model);
  const ok = runs.filter((r) => r.ok);
  const latencies = ok.map((r) => r.latencyMs);
  const tpsValues = ok.filter((r) => r.tps > 0).map((r) => r.tps);
  const profile =
    ok.length === 0
      ? null
      : {
          measuredAt: MEASURED_AT,
          latencyMs: Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)),
          p95LatencyMs: Number(pct(latencies, 95).toFixed(1)),
          outputTokensPerSecond: Number(
            (tpsValues.length ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0).toFixed(2),
          ),
          errorRate: Number((1 - ok.length / runs.length).toFixed(4)),
          samples: runs.length,
        };
  return { model, runs, tools, profile };
}

const MEASURED_AT = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const catalog = await loadCatalog();
const targets = catalog
  .map((m) => m.id)
  .filter((id) => (ONLY.length ? ONLY.includes(id) : true))
  .filter((id) => !SKIP.has(id));

console.log(`Probing ${targets.length} models × (${SAMPLES} + 1 tool) requests, concurrency ${CONCURRENCY}, at ${MEASURED_AT}`);

const results = {};
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const model = targets[cursor++];
    const r = await probe(model);
    results[model] = r;
    const p = r.profile;
    console.log(
      p
        ? `  ${model}: ${p.latencyMs}ms avg, p95 ${p.p95LatencyMs}ms, ${p.outputTokensPerSecond} tok/s, err ${p.errorRate}, tools=${r.tools.supportsTools}`
        : `  ${model}: ALL FAILED (${r.runs[0]?.error ?? "?"}), tools=${r.tools.supportsTools}`,
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const profiles = Object.fromEntries(
  Object.values(results)
    .filter((r) => r.profile)
    .sort((a, b) => a.model.localeCompare(b.model))
    .map((r) => [r.model, r.profile]),
);
const toolsOut = Object.fromEntries(
  Object.values(results)
    .sort((a, b) => a.model.localeCompare(b.model))
    .map((r) => [
      r.model,
      {
        supportsTools: r.tools.supportsTools,
        probedAt: MEASURED_AT,
        ...(r.tools.error ? { error: r.tools.error } : {}),
        // A 429 is the probe's own concurrency hitting a free-tier limit, not
        // a dead model; only a run that failed for some other reason is
        // recorded as unavailable.
        ...(r.runs.every((x) => !x.ok) && !r.runs.every((x) => /429/.test(x.error ?? ""))
          ? { unavailable: true, error: r.runs[0]?.error }
          : {}),
        ...(r.runs.every((x) => !x.ok) && r.runs.every((x) => /429/.test(x.error ?? ""))
          ? { rateLimited: true }
          : {}),
        ...(r.runs.some((x) => x.ok && x.emptyContent) ? { emptyCompletionSeen: true } : {}),
      },
    ]),
);

// A partial run (--only / --skip) merges into the committed files so a
// re-probe of a few models never discards the rest of the catalog.
const partial = ONLY.length > 0 || SKIP.size > 0;
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
const profilesPath = resolve(ROOT, "model-profiles.generated.json");
const toolsPath = resolve(ROOT, "scripts/probe-tools.json");
const mergedProfiles = partial ? sortKeys({ ...readJson(profilesPath), ...profiles }) : profiles;
const mergedTools = partial ? sortKeys({ ...readJson(toolsPath), ...toolsOut }) : toolsOut;
writeFileSync(profilesPath, JSON.stringify(mergedProfiles, null, 2) + "\n");
writeFileSync(toolsPath, JSON.stringify(mergedTools, null, 2) + "\n");
writeFileSync(resolve(ROOT, "scripts/probe-raw.local.json"), JSON.stringify(results, null, 2) + "\n");

const dead = Object.entries(toolsOut).filter(([, v]) => v.unavailable).map(([k]) => k);
console.log(`\nWrote ${Object.keys(profiles).length} profiles. Dead at the gateway: ${dead.length ? dead.join(", ") : "none"}`);
