import type { Line } from '../protocol.ts';
import { key } from './memory.ts';

/** Where something is in a profile's memory, as pi-optchat names it: the `n` messages from `id` on, so a message is `n` 1. */
export type Place = Pick<Line, 'id' | 'n'>;
/** Something a message cites: the words, and where in the memory they are, so that the agent can read what is around them.
 * A line cited whole has no words but its first ones, and what is not in the log yet (a reply in a run, a connected window's
 * conversation) no place. */
export interface Cite { text: string; at?: Place }

/** How much of what is cited goes with the message: the agent can zoom to the rest. */
const CAP = 2000, LINE = 200;
const cut = (text: string, cap: number) => text.length > cap ? `${text.slice(0, cap).trimEnd()}…` : text;
/** What was selected, as a citation; and a line or a message cited whole, by how it begins. */
export const cite = (text: string, at?: Place): Cite => ({ text: cut(text.trim(), CAP), ...at && { at } });
export const whole = (at: Place, text = ''): Cite => ({ text: cut(text.trim(), LINE), at });

/** A place as it is written: a message by its number, a line as pi-optchat's view heads it (`id+n`). */
export const named = (at: Place) => at.n === 1 ? String(at.id) : key(at);
/** What a citation is called on its chip in the composer: by its words, and a line of several messages, or one with no words, by its place. */
export const called = ({ text, at }: Cite) => at && (at.n > 1 || !text) ? `Memory ${named(at)}` : text;
export function place(name = ''): Place | undefined {
  const [, id, n = '1'] = /^(\d+)(?:\+([1-9]\d*))?$/.exec(name) ?? [];
  return id === undefined ? undefined : { id: Number(id), n: Number(n) };
}

// Only what would end a citation early is written another way, so that what is cited reads as it was said: code keeps its `<`.
const escaped = (text: string) => text.replace(/&(?=(?:amp|lt);)|<(?=\/cite>)/g, sign => sign === '&' ? '&amp;' : '&lt;');
const plain = (text: string) => text.replace(/&(amp|lt);/g, (_, name: string) => name === 'amp' ? '&' : '<');
const TAG = /<cite(?: zoom="([\d+]+)")?(?:\/>|>([\s\S]*?)<\/cite>)\n?/g, HEAD = new RegExp(`^(?:${TAG.source})+`);
/** A message with what it cites: the citations first, a line each, then what was typed. The agent reads it as it is written
 * here and the page draws it (`cited`), so this is the one place that says how. The place is named after the agent's `zoom`
 * tool, which opens it: a real model goes and reads it then, and under other names mostly says that it could. */
export function citing(cites: readonly Cite[], typed: string) {
  if (!cites.length) return typed;
  return `${cites.map(({ text, at }) => `<cite${at ? ` zoom="${named(at)}"` : ''}${text ? `>${escaped(text)}</cite>` : '/>'}`).join('\n')}\n\n${typed}`;
}
/** What a message cites, and what was typed under it: `citing`, read back. Only what a message begins with is a citation. */
export function cited(message: string): { cites: Cite[]; text: string } {
  const head = HEAD.exec(message)?.[0];
  if (!head) return { cites: [], text: message };
  const cites = [...head.matchAll(TAG)].map(([, name, text = '']): Cite => { const at = place(name); return { text: plain(text), ...at && { at } }; });
  return { cites, text: message.slice(head.length).replace(/^\n/, '') };
}
/** The skill a message runs: `/skill:name what was typed`, which Pi sends as the skill's file (`body`, from `path`) with what
 * was typed under it. A message as typed has only the name. */
export interface Skill { name: string; path?: string; body?: string }
// Pi's own format (its `parseSkillBlock`), and its rule for a name: up to the first space.
const SKILL = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/, TYPED = /^\/skill:(\S+)(?: ([\s\S]*))?$/;
/** The skill a message runs and what was typed after its name, as Pi sent it or as it was typed; and the message as it was
 * typed. Only a message that begins with a skill runs one. */
export function skilled(message: string): { skill?: Skill; text: string } {
  const [, name, path, body, text = ''] = SKILL.exec(message) ?? [];
  if (name) return { skill: { name, path, body }, text: text.trim() };
  const [, given, words = ''] = TYPED.exec(message) ?? [];
  return given ? { skill: { name: given }, text: words.trim() } : { text: message };
}
export const typed = (skill: Skill | undefined, text: string) => skill ? `/skill:${skill.name}${text && ` ${text}`}` : text;
/** Messages that go back into the composer as one: what they cite, then what they say. */
export function joined(messages: readonly string[]) {
  const all = messages.map(cited);
  return citing(all.flatMap(({ cites }) => cites), all.flatMap(({ text }) => text || []).join('\n\n'));
}
