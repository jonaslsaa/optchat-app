/** The colours a profile's badge can have, T3 Code's eighteen for a project: the letters in the colour, on a tint of it. Whole
 * class names, for Tailwind to find. */
const COLOURS = [
  'text-gray-600 dark:text-gray-400', 'text-red-600 dark:text-red-400', 'text-orange-600 dark:text-orange-400',
  'text-amber-600 dark:text-amber-400', 'text-yellow-600 dark:text-yellow-400', 'text-lime-600 dark:text-lime-400',
  'text-green-600 dark:text-green-400', 'text-emerald-600 dark:text-emerald-400', 'text-teal-600 dark:text-teal-400',
  'text-cyan-600 dark:text-cyan-400', 'text-sky-600 dark:text-sky-400', 'text-blue-600 dark:text-blue-400',
  'text-indigo-600 dark:text-indigo-400', 'text-violet-600 dark:text-violet-400', 'text-purple-600 dark:text-purple-400',
  'text-fuchsia-600 dark:text-fuchsia-400', 'text-pink-600 dark:text-pink-400', 'text-rose-600 dark:text-rose-400',
] as const;

/** What a profile's badge shows, from its name alone, so it is the same everywhere and nothing is kept: two letters and one of
 * the colours, both as T3 Code derives a project's. The letters are the first of the first word, and then a digit of that
 * word, or the first letter of the last word, or the word's own last letter: `t3code` is T3, `kahoot-work` KW, `work` WK. */
export function badge(name: string) {
  const text = name.normalize('NFKC').trim(), words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const [first = '?', ...rest] = Array.from(words[0] ?? '');
  const second = rest.find(glyph => /\p{N}/u.test(glyph)) ?? (words.length > 1 ? Array.from(words.at(-1) ?? '')[0] : rest.at(-1)) ?? (words.length ? first : '');
  let colour = 0;
  for (const glyph of text.toLocaleLowerCase('en-US') || 'profile') colour = (colour * 31 + (glyph.codePointAt(0) ?? 0)) % COLOURS.length;
  return { letters: Array.from(`${first}${second}`.toUpperCase()).slice(0, 2).join(''), colour: COLOURS[colour] };
}
