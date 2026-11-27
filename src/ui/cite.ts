import type { Line } from '../protocol.ts';
import { key } from './memory.ts';

/** Where something is in a profile's memory, as pi-optchat names it: the `n` messages from `id` on, so a message is `n` 1. */
export type Place = Pick<Line, 'id' | 'n'>;
/** Something a message cites: the words, where in the memory they are (so that the agent can read what is around them), and
 * an optional comment you attached to that citation. A line cited whole has no words but its first ones, and what is not in
 * the log yet (a reply in a run, a connected window's conversation) no place. */
export interface Cite { text: string; at?: Place; comment?: string }

/** How much of what is cited goes with the message: the agent can zoom to the rest. A comment on one is yours, and goes whole. */
const CAP = 8000, LINE = 200;
const cut = (text: string, cap: number) => text.length > cap ? `${text.slice(0, cap).trimEnd()}…` : text;
/** What was selected, or a message of the chat cited whole, as a citation; and a line of the memory cited whole, by how it begins. */
export const cite = (text: string, at?: Place, comment?: string): Cite => {
  const note = comment?.trim();
  return { text: cut(text.trim(), CAP), ...at && { at }, ...note && { comment: note } };
};
export const whole = (at: Place, text = '', comment?: string): Cite => {
  const note = comment?.trim();
  return { text: cut(text.trim(), LINE), at, ...note && { comment: note } };
};
/** A citation with a new comment, or without one when blank. */
export const commented = (item: Cite, comment: string): Cite => {
  const note = comment.trim(), { comment: _, ...rest } = item;
  return note ? { ...rest, comment: note } : rest;
};

const same = (one: Cite, other: Cite) => one.text === other.text && one.at?.id === other.at?.id && one.at?.n === other.at?.n;
/** Each citation of a message paired with the first of `marks` made for the same words at the same place that no citation
 * before it took (its comment may have changed since): so a mark follows its citation wherever the message moves it, and is
 * left over once that is gone. */
export function paired<Mark extends { cite: Cite }>(cites: readonly Cite[], marks: readonly Mark[]): (Mark | undefined)[] {
  const left = [...marks];
  return cites.map(cite => {
    const at = left.findIndex(mark => same(mark.cite, cite));
    return at < 0 ? undefined : left.splice(at, 1)[0];
  });
}

/** A place as it is written: a message by its number, a line as pi-optchat's view heads it (`id+n`). */
export const named = (at: Place) => at.n === 1 ? String(at.id) : key(at);
/** What a citation is called on its chip in the composer: your comment when it has one, else its words, and one with no words
 * (a line cited whole that has none) by its place. */
export const called = ({ text, at, comment }: Cite) => comment?.trim() || text || (at ? `Memory ${named(at)}` : '');
/** Whether a citation's place is worth showing in the chat: a number tells you something only for a line of several messages,
 * or for a citation with no words of its own, where it stands in for them. A quote from the chat is its words. */
export const placed = ({ text, at }: Cite) => at && (at.n > 1 || !text) ? at : undefined;
export function place(name = ''): Place | undefined {
  const [, id, n = '1'] = /^(\d+)(?:\+([1-9]\d*))?$/.exec(name) ?? [];
  return id === undefined ? undefined : { id: Number(id), n: Number(n) };
}

// Only what would end a citation or its comment early is written another way, so that what is cited reads as it was said: code
// keeps its `<`.
const escaped = (text: string, tag: 'cite' | 'comment') =>
  text.replace(tag === 'cite' ? /&(?=(?:amp|lt);)|<(?=\/cite>)/g : /&(?=(?:amp|lt);)|<(?=\/comment>)/g, sign => sign === '&' ? '&amp;' : '&lt;');
const plain = (text: string) => text.replace(/&(amp|lt);/g, (_, name: string) => name === 'amp' ? '&' : '<');
const TAG = /<cite(?: zoom="([\d+]+)")?(?:\/>|>([\s\S]*?)<\/cite>)(?:\r?\n<comment>([\s\S]*?)<\/comment>)?(?:\r?\n)?/g, HEAD = new RegExp(`^(?:${TAG.source})+`);
/** A message with what it cites: the citations first, a line each (each with its `<comment>` on the next line when it has one),
 * then what was typed. The agent reads it as it is written here and the page draws it (`cited`), so this is the one place that
 * says how. The place is named after the agent's `zoom` tool, which opens it: a real model goes and reads it then, and under
 * other names mostly says that it could. */
export function citing(cites: readonly Cite[], typed: string) {
  if (!cites.length) return typed;
  const line = ({ text, at, comment }: Cite) => {
    const note = comment?.trim();
    return `<cite${at ? ` zoom="${named(at)}"` : ''}${text ? `>${escaped(text, 'cite')}</cite>` : '/>'}${note ? `\n<comment>${escaped(note, 'comment')}</comment>` : ''}`;
  };
  return `${cites.map(line).join('\n')}\n\n${typed}`;
}
/** What a message cites, and what was typed under it: `citing`, read back. Only what a message begins with is a citation. */
export function cited(message: string): { cites: Cite[]; text: string } {
  const head = HEAD.exec(message)?.[0];
  if (!head) return { cites: [], text: message };
  const cites = [...head.matchAll(TAG)].map(([, name, text = '', comment]): Cite => {
    const at = place(name), note = comment === undefined ? undefined : plain(comment).trim();
    return { text: plain(text), ...at && { at }, ...note && { comment: note } };
  });
  return { cites, text: message.slice(head.length).replace(/^\r?\n/, '') };
}
/** The skill a message runs: `/skill:name what was typed`, which Pi sends as the skill's file (`body`, from `path`) with what
 * was typed under it. A message as typed has only the name. */
export interface Skill { name: string; path?: string; body?: string }
// Pi's own format (its `parseSkillBlock`), with what was typed under it, or only the images sent with it (one newline, as
// pi-optchat logs them); and Pi's rule for a name as typed: up to the first space.
const SKILL = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n?([\s\S]+))?$/, TYPED = /^\/skill:(\S+)(?: ([\s\S]*))?$/;
// The note Pi adds under your message for each picture it made smaller (its `formatDimensionNote`): for the model, not you.
// Other notes stay: one that a picture could not be sent says it never arrived.
const RESIZED = /\n*^\[Image: original \d+x\d+, displayed at \d+x\d+\. Multiply coordinates by \d+\.\d+ to map to original image\.\]$/gm;
/** Your message as the chat shows it: the skill it runs, what it cites, and what was typed. */
export interface Yours { skill?: Skill; cites: Cite[]; text: string }
/** Your message, read as Pi sent it or as it was typed: a skill and what was typed after its name, or what it cites (`cited`)
 * and what was typed under that. Only a message that begins with a skill runs one, so it cites nothing. */
export function yours(said: string): Yours {
  const message = said.replace(RESIZED, '');
  const [, name, path, body, text = ''] = SKILL.exec(message) ?? [];
  if (name) return { skill: { name, path, body }, cites: [], text: text.trim() };
  const [, given, words = ''] = TYPED.exec(message) ?? [];
  return given ? { skill: { name: given }, cites: [], text: words.trim() } : cited(message);
}
/** Your message as it was typed, which is how it is copied, brought back and sent again: `yours`, written back. */
export const asTyped = ({ skill, cites, text }: Yours) => skill ? `/skill:${skill.name}${text && ` ${text}`}` : citing(cites, text).trimEnd();
/** Messages that go back into the composer as one: what they cite, then what they say. */
export function joined(messages: readonly string[]) {
  const all = messages.map(yours);
  return citing(all.flatMap(({ cites }) => cites), all.flatMap(said => asTyped({ ...said, cites: [] }) || []).join('\n\n'));
}
