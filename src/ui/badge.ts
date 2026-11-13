/** The colours a profile's badge can have: the letters in the colour, on a tint of it. Few enough to tell apart at this size,
 * and each reads on its tint in light and dark. Whole class names, for Tailwind to find. */
const HUES = [
  'text-red-800 dark:text-red-400', 'text-sky-800 dark:text-sky-400', 'text-amber-800 dark:text-amber-400', 'text-violet-800 dark:text-violet-400',
  'text-emerald-800 dark:text-emerald-400', 'text-pink-800 dark:text-pink-400', 'text-teal-800 dark:text-teal-400',
] as const;

/** What a profile's badge shows, from its name alone, so it is the same everywhere and nothing is kept: one or two letters
 * (the first of its first word, then the first of its last word, or a digit of the only one: `kahoot-work` is KW, `t3code`
 * T3, `personal` P) and one of a few colours. The colour is picked as T3 Code picks a project's. */
export function badge(name: string) {
  const text = name.normalize('NFKC').trim(), words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const [first = '?', ...rest] = Array.from(words[0] ?? ''), last = words.length > 1 ? Array.from(words.at(-1) ?? '')[0] : rest.find(glyph => /\p{N}/u.test(glyph));
  let hue = 0;
  for (const glyph of text.toLowerCase()) hue = (hue * 31 + (glyph.codePointAt(0) ?? 0)) % HUES.length;
  return { letters: `${first}${last ?? ''}`.toUpperCase(), colour: HUES[hue] };
}
