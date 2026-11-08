/**
 * Request-size helpers shared by the rules and portfolio strategies.
 *
 * The router never tokenizes — it is on the hot path and model-agnostic — so
 * sizes are estimates. The estimate only has to be honest enough for the
 * decisions that consume it: the long-context task type, the COMPLEX
 * override and the per-model capacity filter.
 */

// Han, kana, Hangul, CJK punctuation and fullwidth forms. Every production
// tokenizer spends roughly one token per character here, so the Latin
// four-characters-per-token rule under-counts these scripts about fourfold:
// a 200k-character Chinese contract would read as 50k tokens, slip under the
// 80k long-context boundary and pass the capacity filter for models that
// cannot hold it.
const CJK_CHARS = /[　-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

/** Approximate token count: one per CJK character, one per four of anything else. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjk = text.match(CJK_CHARS)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/** The scan window the feature regexes read, bounded so a pasted document cannot stall routing. */
export function scanLimit(promptTruncationChars: number): number {
  return Math.max(1, Math.min(8_000, promptTruncationChars));
}

/**
 * Feature regexes need request shape and intent, not the entire document.
 * Sample both ends so a long pasted artifact keeps the task instruction at
 * either boundary, while the full length still drives capacity decisions.
 */
export function sampleForScan(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const prefixLength = Math.ceil(limit / 2);
  return `${value.slice(0, prefixLength)}\n${value.slice(-(limit - prefixLength))}`;
}
