/** How well a name matches what was typed: lower is better, and `undefined` is no match. Both are lower case already. The
 * name itself first (`exact`), then one that begins with it (`prefix`), one a word of which does (`boundary`: after one of
 * `markers`), one that has it anywhere (`includes`), and last one that has its letters in order (`fuzzy`). Each is a tier
 * of its own (`TIER` apart, so no penalty reaches the next); within one, an earlier and a shorter match is better. From
 * searchRanking.ts of the project in THIRD_PARTY_NOTICES.md, with its tiers kept apart. */
const TIER = 100_000;
export function scoreQueryMatch({ value, query, markers, ...base }: { value: string; query: string; markers: readonly string[]; exact: number; prefix: number; boundary: number; includes: number; fuzzy: number }) {
  if (!value || !query) return undefined;
  if (value === query) return base.exact * TIER;
  const penalty = Math.min(64, Math.max(0, value.length - query.length));
  if (value.startsWith(query)) return base.prefix * TIER + penalty;
  const boundary = Math.min(...markers.map(marker => value.indexOf(marker + query)).filter(at => at >= 0).map(at => at + 1));
  if (boundary < Infinity) return base.boundary * TIER + boundary * 2 + penalty;
  const includes = value.indexOf(query);
  if (includes >= 0) return base.includes * TIER + includes * 2 + penalty;
  const fuzzy = subsequence(value, query);
  return fuzzy === undefined ? undefined : base.fuzzy * TIER + fuzzy;
}

/** The letters of `query` in `value` in their order, with what lies between them and before the first as the cost. */
function subsequence(value: string, query: string) {
  let at = 0, first = -1, previous = -1, gaps = 0;
  for (let k = 0; k < value.length; k++) {
    if (value[k] !== query[at]) continue;
    if (first < 0) first = k;
    if (previous >= 0) gaps += k - previous - 1;
    previous = k;
    if (++at === query.length) return first * 2 + gaps * 3 + (k - first + 1 - query.length) + Math.min(64, value.length - query.length);
  }
  return undefined;
}
