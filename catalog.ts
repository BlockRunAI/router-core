/** Pure public-catalog parsing. Fetching, caching and UI ordering belong to hosts. */
import { DEFAULT_MODEL_CAPABILITIES, type ModelCapabilities } from "./model-capabilities.js";
import type { ModelPricing } from "./selector.js";

export const MODEL_KINDS = ["chat", "image", "video", "music"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/** Gateway units are preserved: token prices per 1M tokens; media per unit. */
export interface CatalogPricing {
  input?: number;
  output?: number;
  per_image?: number;
  per_second?: number;
  per_track?: number;
  cache_read?: number;
  cache_write?: number;
  transaction_fee?: number;
  per_call_surcharge?: number;
  default_duration_seconds?: number;
  max_duration_seconds?: number;
}

export interface CatalogModel {
  id: string;
  name: string;
  categories: readonly string[];
  kinds: readonly ModelKind[];
  billingMode?: string;
  /** Zero pricing alone does not imply a free model. */
  free: boolean;
  pricing: CatalogPricing;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ModelCatalog {
  models: readonly CatalogModel[];
  chat: readonly CatalogModel[];
  image: readonly CatalogModel[];
  video: readonly CatalogModel[];
  music: readonly CatalogModel[];
  /**
   * IDs whose authoritative row says `available: false`. The gateway does not
   * reject these; it substitutes another model. Absence from the listing is
   * not unavailability: hidden IDs are still served.
   */
  unavailable: readonly string[];
}

const PRICE_KEYS = [
  "input", "output", "per_image", "per_second", "per_track", "cache_read", "cache_write",
  "transaction_fee", "per_call_surcharge", "default_duration_seconds", "max_duration_seconds",
] as const;
const UNIT_PRICE = { image: "per_image", video: "per_second", music: "per_track" } as const;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:+-]*$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const price = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const capacity = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/**
 * Normalize GET /api/v1/models without a model-ID allowlist. New provider IDs
 * appear immediately. Hidden/unavailable rows and invalid per-kind prices are
 * omitted. A malformed envelope throws so a host can retain its last good list;
 * an explicitly empty `data` array is a valid empty catalog.
 *
 * IDs explicitly marked `available: false` are also listed in `unavailable`.
 * Rows outside MODEL_KINDS (speech, sound effects) are omitted.
 *
 * Last duplicate wins, including a final unavailable/invalid row. No sorting,
 * price markup, network request, capability probe or media routing is performed.
 */
export function parseModelCatalog(value: unknown): ModelCatalog {
  if (!record(value) || !Array.isArray(value.data)) {
    throw new TypeError("Model catalog must contain a data array");
  }
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of value.data) {
    if (record(entry) && typeof entry.id === "string" && entry.id.length <= 200 && MODEL_ID.test(entry.id)) {
      entries.set(entry.id, entry);
    }
  }
  const result: ModelCatalog = { models: [], chat: [], image: [], video: [], music: [], unavailable: [] };
  const models: CatalogModel[] = [];
  const unavailable: string[] = [];
  for (const [id, entry] of entries) {
    if (entry.available === false) unavailable.push(id);
    if ((entry.available !== undefined && entry.available !== true) ||
        (entry.hidden !== undefined && entry.hidden !== false) ||
        !Array.isArray(entry.categories) || !record(entry.pricing)) continue;
    const categories = [...new Set(entry.categories.filter((c): c is string => typeof c === "string"))];
    const rawPricing = entry.pricing;
    const pricing: CatalogPricing = {};
    for (const key of PRICE_KEYS) if (price(rawPricing[key])) pricing[key] = rawPricing[key];
    const kinds = MODEL_KINDS.filter(kind => categories.includes(kind) && (kind === "chat"
      ? price(rawPricing.input) && price(rawPricing.output)
      : price(rawPricing[UNIT_PRICE[kind]])));
    if (!kinds.length) continue;
    const model: CatalogModel = {
      id, name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id,
      categories, kinds, pricing,
      free: kinds.includes("chat") && entry.billing_mode === "free" && pricing.input === 0 && pricing.output === 0,
      ...(typeof entry.billing_mode === "string" ? { billingMode: entry.billing_mode } : {}),
      ...(capacity(entry.context_window) !== undefined ? { contextWindow: capacity(entry.context_window) } : {}),
      ...(capacity(entry.max_output) !== undefined ? { maxOutputTokens: capacity(entry.max_output) } : {}),
    };
    models.push(model);
  }
  result.models = models;
  result.unavailable = unavailable;
  for (const kind of MODEL_KINDS) result[kind] = models.filter(model => model.kinds.includes(kind));
  return result;
}

export interface CatalogRoutingOptions {
  /** Host evidence, merged over (and overriding per ID) the bundled verified table. */
  verifiedCapabilities?: Readonly<Record<string, ModelCapabilities>>;
}

export interface RoutingCatalog {
  modelPricing: Map<string, ModelPricing>;
  modelCapabilities: Record<string, ModelCapabilities>;
  unavailableModels: string[];
}

/**
 * Adapt only the chat catalog for route(). Media never enters LLM candidate
 * chains. Tool support comes from verified evidence, never a name or category.
 * Unknown capacities are zero, rather than invented defaults.
 *
 * Only rows the gateway explicitly marks `available: false` become
 * unavailableModels. Configured IDs that are merely absent from the listing
 * stay routable: the gateway serves hidden IDs, and only the configured chain
 * knows about them.
 */
export function toRoutingCatalog(catalog: ModelCatalog, options: CatalogRoutingOptions = {}): RoutingCatalog {
  const verified = { ...DEFAULT_MODEL_CAPABILITIES, ...options.verifiedCapabilities };
  const modelPricing = new Map<string, ModelPricing>();
  const modelCapabilities: Record<string, ModelCapabilities> = {};
  for (const model of catalog.chat) {
    modelPricing.set(model.id, { inputPrice: model.pricing.input!, outputPrice: model.pricing.output! });
    const evidence = verified[model.id];
    modelCapabilities[model.id] = {
      contextWindow: model.contextWindow ?? evidence?.contextWindow ?? 0,
      maxOutputTokens: model.maxOutputTokens ?? evidence?.maxOutputTokens ?? 0,
      supportsTools: evidence?.supportsTools === true,
      supportsVision: model.categories.includes("vision"),
    };
  }
  return { modelPricing, modelCapabilities, unavailableModels: [...catalog.unavailable] };
}
