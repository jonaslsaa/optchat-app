/** The colours a profile's badge can have: the letters in the colour, on a tint of it. They are T3 Code's for a project, less
 * its red, which here says a window's Pi failed. On a light page each is the lightest shade of its hue whose letters read at
 * 4.5:1 or better on their tint, which makes the warm ones darker than T3 Code has them. Whole class names, for Tailwind to find. */
const COLOURS = [
  'text-gray-600 dark:text-gray-400', 'text-orange-800 dark:text-orange-400', 'text-amber-800 dark:text-amber-400',
  'text-yellow-800 dark:text-yellow-400', 'text-lime-800 dark:text-lime-400', 'text-green-800 dark:text-green-400',
  'text-emerald-800 dark:text-emerald-400', 'text-teal-800 dark:text-teal-400', 'text-cyan-800 dark:text-cyan-400',
  'text-sky-700 dark:text-sky-400', 'text-blue-700 dark:text-blue-400', 'text-indigo-600 dark:text-indigo-400',
  'text-violet-700 dark:text-violet-400', 'text-purple-700 dark:text-purple-400', 'text-fuchsia-700 dark:text-fuchsia-400',
  'text-pink-800 dark:text-pink-400', 'text-rose-800 dark:text-rose-400',
] as const;

/** What a profile's badge shows, from its name alone, so it is the same everywhere and nothing is kept: two letters and one of
 * the colours, both by T3 Code's rules for a project. The letters are the first of the first word, and then a digit of that
 * word, or the first letter of the last word, or the word's own last letter: `t3code` is T3, `kahoot-work` KW, `work` WK. */
export function badge(name: string) {
  const text = name.normalize('NFKC').trim(), words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const [first = '?', ...rest] = Array.from(words[0] ?? '');
  const second = rest.find(glyph => /\p{N}/u.test(glyph)) ?? (words.length > 1 ? Array.from(words.at(-1) ?? '')[0] : rest.at(-1)) ?? (words.length ? first : '');
  let colour = 0;
  for (const glyph of text.toLocaleLowerCase('en-US') || 'profile') colour = (colour * 31 + (glyph.codePointAt(0) ?? 0)) % COLOURS.length;
  return { letters: Array.from(`${first}${second}`.toUpperCase()).slice(0, 2).join(''), colour: COLOURS[colour] };
}
