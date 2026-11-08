#!/usr/bin/env node
/**
 * Public catalog → model-capabilities.ts
 *
 * Regenerates the built-in capability snapshot from BlockRun's public model
 * list (GET https://blockrun.ai/api/v1/models) so the hard-eligibility stage
 * never runs against a stale context window or output cap. Two fields come
 * from outside the catalog, because the catalog does not publish them:
 *
 *   supportsVision  ← the catalog's `categories` contains "vision"
 *   supportsTools   ← scripts/probe-tools.json, written by probe-model-profiles.mjs
 *                     from a real function-calling request. A model with no
 *                     probe result is written as `false`: constraint-first
 *                     routing fails closed on an unverified capability, so an
 *                     unprobed model can still be chosen for plain chat but
 *                     never for a tool-required request.
 *   overrides       ← scripts/capability-overrides.json, applied last. Every
 *                     entry must carry a `reason`; it exists for the case where
 *                     a probe measured a gateway incident rather than a model
 *                     capability, and it is emitted as a comment on the entry
 *                     so the exception stays visible in review.
 *
 * Only text models are emitted (image/video/music/speech rows carry no
 * context window). An id that is merely absent from the listing is NOT
 * treated as dead: the gateway keeps serving aliased and hidden ids, so a
 * model that a routing chain still names (src/config.ts, src/portfolio.ts)
 * keeps its previous entry, annotated, until a direct call proves it gone.
 * Dropping it would leave the eligibility stage with no context window or
 * tool flag for a model the router keeps selecting. Only an explicit
 * `available: false` row removes a routed id.
 *
 * Usage:
 *   node scripts/sync-model-capabilities.mjs [--catalog path/to/models.json]
 *   npm run typecheck && npm test   # then regenerate the decision snapshot if chains moved
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");
const SNAPSHOT_PATH = resolve(SRC, "model-capabilities.ts");
const CATALOG_URL = "https://blockrun.ai/api/v1/models";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const catalogPath = flag("catalog", null);
const catalog = catalogPath
  ? JSON.parse(readFileSync(resolve(catalogPath), "utf8"))
  : await fetch(CATALOG_URL).then((r) => r.json());

const toolsPath = resolve(ROOT, "scripts/probe-tools.json");
const toolProbe = existsSync(toolsPath) ? JSON.parse(readFileSync(toolsPath, "utf8")) : {};
const overridesPath = resolve(ROOT, "scripts/capability-overrides.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
for (const [id, o] of Object.entries(overrides)) {
  if (typeof o.reason !== "string" || !o.reason.trim()) {
    throw new Error(`capability-overrides.json: "${id}" needs a reason`);
  }
}

if (!catalog || !Array.isArray(catalog.data)) {
  throw new Error("Catalog response has no data array — refusing to overwrite the snapshot");
}

const textModels = catalog.data
  .filter((m) => typeof m.context_window === "number" && typeof m.max_output === "number")
  .filter((m) => m.billing_mode === "paid" || m.billing_mode === "free")
  .map((m) => ({
    id: m.id,
    contextWindow: m.context_window,
    maxOutputTokens: m.max_output,
    catalogVision: Array.isArray(m.categories) && m.categories.includes("vision"),
  }));

// Ids any routing chain or evidence list names. Read from source text so the
// script needs no build step.
const ID_LITERAL = /"([a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:+-]*)"/g;
const routedIds = new Set(
  ["config.ts", "portfolio.ts"].flatMap((file) =>
    [...readFileSync(resolve(SRC, file), "utf8").matchAll(ID_LITERAL)].map((match) => match[1]),
  ),
);

// The previous snapshot, so a routed id absent from this listing keeps the
// capability evidence it already had.
const previous = new Map();
if (existsSync(SNAPSHOT_PATH)) {
  const ENTRY =
    /"([^"]+)": \{[^\n]*\n\s*contextWindow: ([\d_]+),\n\s*maxOutputTokens: ([\d_]+),\n\s*supportsTools: (true|false),\n\s*supportsVision: (true|false),/g;
  for (const m of readFileSync(SNAPSHOT_PATH, "utf8").matchAll(ENTRY)) {
    previous.set(m[1], {
      contextWindow: Number(m[2].replace(/_/g, "")),
      maxOutputTokens: Number(m[3].replace(/_/g, "")),
      supportsTools: m[4] === "true",
      supportsVision: m[5] === "true",
    });
  }
}

const listed = new Set(catalog.data.map((m) => m.id));
const explicitlyUnavailable = new Set(
  catalog.data.filter((m) => m.available === false).map((m) => m.id),
);
const retained = [];
for (const id of routedIds) {
  if (listed.has(id) || explicitlyUnavailable.has(id)) continue;
  const prior = previous.get(id);
  if (!prior) continue;
  retained.push(id);
  textModels.push({ id, ...prior, retained: true });
}
textModels.sort((a, b) => a.id.localeCompare(b.id));

const fmt = (n) => n.toLocaleString("en-US").replace(/,/g, "_");
const today = new Date().toISOString().slice(0, 10);

const entries = textModels.map((m) => {
  const probe = toolProbe[m.id];
  const override = overrides[m.id] ?? {};
  const supportsTools = m.retained
    ? (override.supportsTools ?? m.supportsTools)
    : (override.supportsTools ?? probe?.supportsTools === true);
  const supportsVision = m.retained
    ? (override.supportsVision ?? m.supportsVision)
    : (override.supportsVision ?? m.catalogVision);
  const notes = [];
  if (m.retained) {
    notes.push(`absent from the ${today} listing but still routed — previous entry retained; probe before removing`);
  } else if (probe === undefined) notes.push("supportsTools: not probed — fails closed");
  else if (probe.unavailable) notes.push("supportsTools: gateway unavailable at probe time — fails closed");
  if (override.reason) notes.push(`override: ${override.reason}`);
  const note = notes.length ? ` // ${notes.join("; ")}` : "";
  return `    "${m.id}": {${note}
      contextWindow: ${fmt(m.contextWindow)},
      maxOutputTokens: ${fmt(m.maxOutputTokens)},
      supportsTools: ${supportsTools},
      supportsVision: ${supportsVision},
    },`;
});

const out = `/**
 * Model capabilities used for hard routing constraints.
 *
 * Hosts may inject fresher values through RouterOptions.modelCapabilities.
 * Keeping a small built-in snapshot makes the core safe and useful when a
 * product catalog is temporarily unavailable, without importing product code.
 *
 * GENERATED by scripts/sync-model-capabilities.mjs from the public catalog
 * (GET https://blockrun.ai/api/v1/models) on ${today}; supportsTools comes
 * from a live function-calling probe (scripts/probe-tools.json). Regenerate
 * rather than editing by hand — a hand edit is overwritten on the next sync.
 */
export type ModelCapabilities = {
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
};

export const DEFAULT_MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> =
  Object.freeze({
${entries.join("\n")}
  });
`;

writeFileSync(SNAPSHOT_PATH, out);
const probed = textModels.filter((m) => toolProbe[m.id] !== undefined).length;
console.log(
  `Wrote ${textModels.length} models to model-capabilities.ts (${probed} with tool-probe evidence, ${
    textModels.filter((m) => toolProbe[m.id]?.supportsTools).length
  } tool-capable).`,
);
if (retained.length > 0) {
  console.log(`Retained ${retained.length} routed id(s) absent from the listing: ${retained.join(", ")}`);
}
