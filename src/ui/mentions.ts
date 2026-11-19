import type { Mention } from '../protocol.ts';

/** The `@` the caret is in, as Pi's terminal reads one: at the start of the message or after a space, then what is typed up to
 * the caret (`query`), which is a path. `quoted` is one opened with `@"`, for a path with a space in it, up to its closing quote. */
export interface Mentioning { start: number; query: string; quoted: boolean }
export function mentioned(text: string, caret: number): Mentioning | undefined {
  const before = text.slice(0, caret), plain = /(^|\s)@([^\s"]*)$/.exec(before), quoted = plain ? undefined : /(^|\s)@"([^"\n]*)$/.exec(before);
  const found = plain ?? quoted;
  return found ? { start: found.index + found[1].length, query: found[2], quoted: !!quoted } : undefined;
}

/** The message with the `@` the caret is in made the one picked, and where the caret goes: a file then has a space after
 * it, and a folder (`/` at its end) none, for one of its files to be picked next. A path with a space in it is quoted. What
 * the path had after the caret goes with it, up to its closing quote or the space after it. */
export function mention(text: string, caret: number, { start, quoted }: Mentioning, { path, dir }: Mention) {
  const named = dir ? `${path}/` : path, quote = quoted || /\s/.test(named), value = quote ? `@"${named}"` : `@${named}`, space = dir ? '' : ' ';
  const after = text.slice(caret), rest = after.replace(quoted ? /^[^"\n]*"?/ : /^[^\s"]*/, '');
  // In a quoted folder the caret stays before the closing quote, where its file is typed.
  return { text: text.slice(0, start) + value + space + rest, caret: start + value.length - (dir && quote ? 1 : 0) + space.length };
}
