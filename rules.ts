/**
 * Rule-Based Classifier (v2 — Weighted Scoring)
 *
 * Scores a request across 15 weighted dimensions and maps the aggregate
 * score to a tier using configurable boundaries. Confidence is calibrated
 * via sigmoid — low confidence triggers the fallback classifier.
 *
 * Handles 70-80% of requests in < 1ms with zero cost.
 */

import type { Tier, ScoringResult, ScoringConfig } from "./types.js";

type DimensionScore = { name: string; score: number; signal: string | null };

// ─── Keyword Matching ───
//
// A plain substring test counted `class` in "classic", `story` in "history",
// `edit` in "credit" and `fix` in "prefix", so everyday prose picked up code,
// creative and agentic signals it did not carry. Alphabetic keywords now have
// to start at a word boundary. Short ASCII keywords additionally have to end
// at one, after an optional inflection, graded by how much a stray suffix can
// change the word: a three-letter keyword takes only the English endings that
// cannot spell another word (fix → fixes, never pip → pipe or def → defer); a
// four-to-six-letter keyword also takes the common German and Romance endings,
// because the lists spell those languages in ASCII too (beweis → beweise,
// klasse → klassen); anything longer stays trailing-open like the substring
// test it replaces, since its false-positive surface is small and its
// inflection surface is large. Non-ASCII alphabetic keywords keep a
// trailing-open match because several are deliberate stems (`оптимизаци`,
// `рассуждени`). CJK, Hangul and Arabic keywords keep the substring test:
// those scripts have no word boundaries, or attach particles and articles
// directly to the word.

const UNSEGMENTED_SCRIPT =
  /[؀-ۿ　-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const ASCII_PHRASE = /^[a-z0-9' -]+$/;
const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}])";
const BOUNDED_LAST_WORD_LENGTH = 6;
const SHORT_SUFFIXES = "(?:s|ed|ing)?";
const SIBILANT_PLURAL = "es";
const MID_SUFFIXES =
  "(?:s|es|ed|d|ing|er|ers|ly|ment|ments|ation|ations|e|en|n|a|as|o|os|em|et|ung|ungen)?";
const DROPPED_E_SUFFIXES = "(?:ing|ed|es|er|ers|ation|ations)";
const DOUBLED_CONSONANT_SUFFIXES = "(?:ing|ed|er|ers)";

type KeywordMatcher = {
  /** Cheap substring pre-check; the regex only runs when this is present. */
  needle: string;
  pattern: RegExp | null;
};

const matcherCache = new Map<string, KeywordMatcher>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordMatcher(keyword: string): KeywordMatcher {
  const cached = matcherCache.get(keyword);
  if (cached) return cached;

  const kw = keyword.toLowerCase();
  let matcher: KeywordMatcher;
  if (UNSEGMENTED_SCRIPT.test(kw) || kw.length === 0) {
    matcher = { needle: kw, pattern: null };
  } else {
    const lead = WORD_CHAR.test(kw[0]) ? BOUNDARY_BEFORE : "";
    const escaped = escapeRegExp(kw);
    let body = escaped;
    let trail = "";
    let needle = kw;
    const lastWord = kw.slice(kw.lastIndexOf(" ") + 1);
    if (
      WORD_CHAR.test(kw[kw.length - 1]) &&
      ASCII_PHRASE.test(kw) &&
      lastWord.length <= BOUNDED_LAST_WORD_LENGTH
    ) {
      // ASCII phrases contain no regex metacharacters, so `escaped` slices
      // align with `kw` slices below.
      const forms: string[] = [];
      if (/\d$/.test(kw)) {
        // "step 1" must not absorb "step 10".
        forms.push(escaped);
      } else if (lastWord.length <= 3) {
        forms.push(`${escaped}${SHORT_SUFFIXES}`);
        if (/(?:x|s|z|ch|sh)$/.test(kw)) forms.push(`${escaped}${SIBILANT_PLURAL}`);
      } else {
        forms.push(`${escaped}${MID_SUFFIXES}`);
        if (kw.endsWith("e")) {
          forms.push(`${escaped.slice(0, -1)}${DROPPED_E_SUFFIXES}`);
          needle = kw.slice(0, -1);
        } else if (kw.endsWith("y")) {
          forms.push(`${escaped.slice(0, -1)}(?:ies|ied)`);
          needle = kw.slice(0, -1);
        } else if (/[aeiou][bdgmnprt]$/.test(kw)) {
          // debug → debugging, plan → planned
          forms.push(`${escaped}${kw[kw.length - 1]}${DOUBLED_CONSONANT_SUFFIXES}`);
        }
      }
      body = `(?:${forms.join("|")})`;
      trail = BOUNDARY_AFTER;
    }
    matcher = { needle, pattern: new RegExp(`${lead}${body}${trail}`, "u") };
  }
  matcherCache.set(keyword, matcher);
  return matcher;
}

/** Whether lower-cased `text` contains `keyword` as a word (or as a substring for CJK). */
function matchesKeyword(text: string, keyword: string): boolean {
  const { needle, pattern } = keywordMatcher(keyword);
  if (!text.includes(needle)) return false;
  return pattern === null ? true : pattern.test(text);
}

// ─── Dimension Scorers ───
// Each returns a score in [-1, 1] and an optional signal string.

function scoreTokenCount(
  estimatedTokens: number,
  thresholds: { simple: number; complex: number },
): DimensionScore {
  if (estimatedTokens < thresholds.simple) {
    return { name: "tokenCount", score: -1.0, signal: `short (${estimatedTokens} tokens)` };
  }
  if (estimatedTokens > thresholds.complex) {
    return { name: "tokenCount", score: 1.0, signal: `long (${estimatedTokens} tokens)` };
  }
  return { name: "tokenCount", score: 0, signal: null };
}

function scoreKeywordMatch(
  text: string,
  keywords: string[],
  name: string,
  signalLabel: string,
  thresholds: { low: number; high: number },
  scores: { none: number; low: number; high: number },
): DimensionScore {
  const matches = keywords.filter((kw) => matchesKeyword(text, kw));
  if (matches.length >= thresholds.high) {
    return {
      name,
      score: scores.high,
      signal: `${signalLabel} (${matches.slice(0, 3).join(", ")})`,
    };
  }
  if (matches.length >= thresholds.low) {
    return {
      name,
      score: scores.low,
      signal: `${signalLabel} (${matches.slice(0, 3).join(", ")})`,
    };
  }
  return { name, score: scores.none, signal: null };
}

function scoreMultiStep(text: string): DimensionScore {
  const patterns = [/first.*then/i, /step \d/i, /\d\.\s/];
  const hits = patterns.filter((p) => p.test(text));
  if (hits.length > 0) {
    return { name: "multiStepPatterns", score: 0.5, signal: "multi-step" };
  }
  return { name: "multiStepPatterns", score: 0, signal: null };
}

function scoreQuestionComplexity(prompt: string): DimensionScore {
  const count = (prompt.match(/\?/g) || []).length;
  if (count > 3) {
    return { name: "questionComplexity", score: 0.5, signal: `${count} questions` };
  }
  return { name: "questionComplexity", score: 0, signal: null };
}

/**
 * Score agentic task indicators.
 * Returns agenticScore (0-1) based on keyword matches:
 * - 4+ matches = 1.0 (high agentic)
 * - 3 matches = 0.6 (moderate agentic, triggers auto-agentic mode)
 * - 1-2 matches = 0.2 (low agentic)
 *
 * Thresholds raised because common keywords were pruned from the list.
 */
function scoreAgenticTask(
  text: string,
  keywords: string[],
): { dimensionScore: DimensionScore; agenticScore: number } {
  let matchCount = 0;
  const signals: string[] = [];

  for (const keyword of keywords) {
    if (matchesKeyword(text, keyword)) {
      matchCount++;
      if (signals.length < 3) {
        signals.push(keyword);
      }
    }
  }

  // Threshold-based scoring (raised thresholds after keyword pruning)
  if (matchCount >= 4) {
    return {
      dimensionScore: {
        name: "agenticTask",
        score: 1.0,
        signal: `agentic (${signals.join(", ")})`,
      },
      agenticScore: 1.0,
    };
  } else if (matchCount >= 3) {
    return {
      dimensionScore: {
        name: "agenticTask",
        score: 0.6,
        signal: `agentic (${signals.join(", ")})`,
      },
      agenticScore: 0.6,
    };
  } else if (matchCount >= 1) {
    return {
      dimensionScore: {
        name: "agenticTask",
        score: 0.2,
        signal: `agentic-light (${signals.join(", ")})`,
      },
      agenticScore: 0.2,
    };
  }

  return {
    dimensionScore: { name: "agenticTask", score: 0, signal: null },
    agenticScore: 0,
  };
}

// ─── Main Classifier ───

export function classifyByRules(
  prompt: string,
  systemPrompt: string | undefined,
  estimatedTokens: number,
  config: ScoringConfig,
): ScoringResult {
  // Score against user prompt only — system prompts contain boilerplate keywords
  // (tool definitions, skill descriptions, behavioral rules) that dominate scoring
  // and make every request score identically. See GitHub issue #50.
  const userText = prompt.toLowerCase();

  // Score the base dimensions against user text only; the agentic dimension is
  // appended below, so the scored total is one more than this list.
  const dimensions: DimensionScore[] = [
    // Token count uses total estimated tokens (system + user) — context size matters for model selection
    scoreTokenCount(estimatedTokens, config.tokenCountThresholds),
    scoreKeywordMatch(
      userText,
      config.codeKeywords,
      "codePresence",
      "code",
      { low: 1, high: 2 },
      { none: 0, low: 0.5, high: 1.0 },
    ),
    scoreKeywordMatch(
      userText,
      config.reasoningKeywords,
      "reasoningMarkers",
      "reasoning",
      { low: 1, high: 2 },
      { none: 0, low: 0.7, high: 1.0 },
    ),
    scoreKeywordMatch(
      userText,
      config.technicalKeywords,
      "technicalTerms",
      "technical",
      { low: 2, high: 4 },
      { none: 0, low: 0.5, high: 1.0 },
    ),
    scoreKeywordMatch(
      userText,
      config.creativeKeywords,
      "creativeMarkers",
      "creative",
      { low: 1, high: 2 },
      { none: 0, low: 0.5, high: 0.7 },
    ),
    scoreKeywordMatch(
      userText,
      config.simpleKeywords,
      "simpleIndicators",
      "simple",
      { low: 1, high: 2 },
      { none: 0, low: -1.0, high: -1.0 },
    ),
    scoreMultiStep(userText),
    scoreQuestionComplexity(prompt),

    // 6 new dimensions
    scoreKeywordMatch(
      userText,
      config.imperativeVerbs,
      "imperativeVerbs",
      "imperative",
      { low: 1, high: 2 },
      { none: 0, low: 0.3, high: 0.5 },
    ),
    scoreKeywordMatch(
      userText,
      config.constraintIndicators,
      "constraintCount",
      "constraints",
      { low: 1, high: 3 },
      { none: 0, low: 0.3, high: 0.7 },
    ),
    scoreKeywordMatch(
      userText,
      config.outputFormatKeywords,
      "outputFormat",
      "format",
      { low: 1, high: 2 },
      { none: 0, low: 0.4, high: 0.7 },
    ),
    scoreKeywordMatch(
      userText,
      config.referenceKeywords,
      "referenceComplexity",
      "references",
      { low: 1, high: 2 },
      { none: 0, low: 0.3, high: 0.5 },
    ),
    scoreKeywordMatch(
      userText,
      config.negationKeywords,
      "negationComplexity",
      "negation",
      { low: 2, high: 3 },
      { none: 0, low: 0.3, high: 0.5 },
    ),
    scoreKeywordMatch(
      userText,
      config.domainSpecificKeywords,
      "domainSpecificity",
      "domain-specific",
      { low: 1, high: 2 },
      { none: 0, low: 0.5, high: 0.8 },
    ),
  ];

  // Score agentic task indicators — user prompt only
  // System prompt describes assistant behavior, not user's intent.
  // e.g. a coding assistant system prompt with "edit files" / "fix bugs" should NOT
  // force every request into agentic mode.
  const agenticResult = scoreAgenticTask(userText, config.agenticTaskKeywords);
  dimensions.push(agenticResult.dimensionScore);
  const agenticScore = agenticResult.agenticScore;

  // Collect signals
  const signals = dimensions.filter((d) => d.signal !== null).map((d) => d.signal!);

  // Compute weighted score
  const weights = config.dimensionWeights;
  let weightedScore = 0;
  for (const d of dimensions) {
    const w = weights[d.name] ?? 0;
    weightedScore += d.score * w;
  }

  // Count reasoning markers for override — only check USER prompt, not system prompt
  // This prevents system prompts with "step by step" from triggering REASONING for simple queries
  const reasoningMatches = config.reasoningKeywords.filter((kw) => matchesKeyword(userText, kw));

  // Direct reasoning override: 2+ reasoning markers = high confidence REASONING
  if (reasoningMatches.length >= 2) {
    const confidence = calibrateConfidence(
      Math.max(weightedScore, 0.3), // ensure positive for confidence calc
      config.confidenceSteepness,
    );
    return {
      score: weightedScore,
      tier: "REASONING",
      confidence: Math.max(confidence, 0.85),
      signals,
      agenticScore,
      dimensions,
    };
  }

  // Map weighted score to tier using boundaries
  const { simpleMedium, mediumComplex, complexReasoning } = config.tierBoundaries;
  let tier: Tier;
  let distanceFromBoundary: number;

  if (weightedScore < simpleMedium) {
    tier = "SIMPLE";
    distanceFromBoundary = simpleMedium - weightedScore;
  } else if (weightedScore < mediumComplex) {
    tier = "MEDIUM";
    distanceFromBoundary = Math.min(weightedScore - simpleMedium, mediumComplex - weightedScore);
  } else if (weightedScore < complexReasoning) {
    tier = "COMPLEX";
    distanceFromBoundary = Math.min(
      weightedScore - mediumComplex,
      complexReasoning - weightedScore,
    );
  } else {
    tier = "REASONING";
    distanceFromBoundary = weightedScore - complexReasoning;
  }

  // Calibrate confidence via sigmoid of distance from nearest boundary
  const confidence = calibrateConfidence(distanceFromBoundary, config.confidenceSteepness);

  // If confidence is below threshold → ambiguous
  if (confidence < config.confidenceThreshold) {
    return { score: weightedScore, tier: null, confidence, signals, agenticScore, dimensions };
  }

  return { score: weightedScore, tier, confidence, signals, agenticScore, dimensions };
}

/**
 * Sigmoid confidence calibration.
 * Maps distance from tier boundary to [0.5, 1.0] confidence range.
 */
function calibrateConfidence(distance: number, steepness: number): number {
  return 1 / (1 + Math.exp(-steepness * distance));
}
