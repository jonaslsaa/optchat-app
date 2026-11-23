import type { Hit, Line, Message, Result, WindowState } from '../protocol.ts';
import { act, reported } from './transcript.ts';

/** A search of the memory: the `text` in its box, and the last answer: the text it was asked for (`of`), the messages found
 * so far, newest first, and how many older ones there are to ask for (`more`). While the answer for what was just typed is
 * on its way, the one before it stands. */
export interface Search { text: string; answer?: { of: string; hits: Hit[]; more: number } }
/** A profile's memory view as the page has it: the view as the server last read it, the two lines under each line that was
 * opened and the message under a line of one, and which lines are open. A line is the same line for as long as the memory is
 * the same one, so what was read under one stays right, and a line stays open while the view is read again. With a `search`
 * the messages it found stand in the tree's place, until one of them is opened: `found` is the line that is pointed out in
 * the tree, which is that message, or what a message cites. Nothing here touches the DOM. */
export interface Tree {
  view?: Result<'view'>;
  under: Record<string, Line[]>;
  originals: Record<number, Message[]>;
  open: readonly string[];
  search?: Search;
  found?: string;
}
export const NO_TREE: Tree = { under: {}, originals: {}, open: [] };
/** A line's name, in pi-optchat's own notation: the `n` messages from `id` on. */
export const key = ({ id, n }: Pick<Line, 'id' | 'n'>) => `${id}+${n}`;
export const isOpen = (tree: Tree, line: Line) => tree.open.includes(key(line));
/** With `line` open, or closed if it was open. */
export function toggled(tree: Tree, line: Line): Tree {
  const name = key(line);
  return { ...tree, open: tree.open.includes(name) ? tree.open.filter(open => open !== name) : [...tree.open, name] };
}
/** Whether what is under `line` has been read: its two halves, or the message itself. */
export const read = (tree: Tree, line: Pick<Line, 'id' | 'n'>) => line.n === 1 ? line.id in tree.originals : key(line) in tree.under;
/** Who said a message, by its kind. */
export const WHO: Record<Hit['kind'], string> = { user: 'You', talk: 'Agent', tool: 'Tool call', echo: 'Tool result', note: 'Note', work: 'Report' };
/** Whether the messages a search found stand in the tree's place: until one of them is opened. */
export const listed = (tree: Tree) => tree.search !== undefined && tree.found === undefined;
/** The lines to open to get to message `id`, outermost first: the line of the view that holds it, then of each line the half
 * that does, down to the line of the message alone, or to its line of `to` messages (the view's own line, where that is
 * shorter). A line begins at a multiple of its length, so they are known without being read. None when the view does not
 * reach the message. */
export function path(lines: readonly Line[], id: number, to = 1) {
  const top = lines.find(line => line.id <= id && id < line.id + line.n), down: Pick<Line, 'id' | 'n'>[] = [];
  for (let n = top?.n ?? 0; n >= 1 && n >= Math.min(to, top?.n ?? 0); n /= 2) down.push({ id: id - id % n, n });
  return down;
}
/** Whether a line in sight waits for its summary, which only a line of one message can: a summary of more is written
 * before the view takes it. */
export const building = (tree: Tree) => tree.view?.lines.some(line => line.text === undefined) ?? false;
/** Whether the view is read again every few seconds while it is shown: while a line waits for its summary, while the chat's
 * Pi runs (it logs as it goes, and the page reads the log when the run ends), and while a Pi outside the app has the chat,
 * which tells the app nothing of what it writes. Otherwise the chat's changes say when. */
export const polled = (tree: Tree, window: Pick<WindowState, 'status' | 'outside'>) => building(tree) || window.status === 'running' || window.outside !== undefined;
/** The messages read as a tool call that had not printed yet: they are asked for again when the log has grown. */
export const calling = (tree: Tree) => Object.values(tree.originals).flatMap(messages => messages.length === 1 && messages[0].kind === 'tool' ? [messages[0].i] : []);
/** When the profile's first message was said: the earliest date of any line. */
export const since = (lines: readonly Line[]) => lines.reduce<string | undefined>((first, { from }) => first === undefined || Date.parse(from) < Date.parse(first) ? from : first, undefined);

/** Who said a message, as pi-optchat keeps it. */
export type Kind = Message['kind'];
/** How pi-optchat begins the line of one message (its `head`): its kind, after the day it was written when it is imported. */
const HEAD = /^(?:\[IMP ([^\]\n]+)\] )?(user|talk|tool|echo|work|note): /;
/** A line of one message as its row shows it: who said it, and what it says without the head that says so. The kind is the
 * line's own (the server reads it from the log); a line that has none, from a server before it, goes by how its summary
 * begins. A summary the compactor wrote may begin otherwise, and then it is all text. `imported`: the day it was written. */
export function leaf({ kind, text = '' }: Pick<Line, 'kind' | 'text'>): { kind?: Kind; imported?: string; text: string } {
  const [head = '', imported, said] = HEAD.exec(text) ?? [];
  return { kind: kind ?? (said as Kind | undefined), ...imported !== undefined && { imported }, text: text.slice(head.length) };
}
/** A tool call as its row says it: the call itself (`name {json}`, as a short one is kept) in the chat's words, with the folder
 * a command first goes to (`cd <folder> && …`) set apart; a summary the compactor wrote, as its words, named by the first. */
export function called(text: string): { name: string; verb?: string; folder?: string; subject: string } {
  const space = text.indexOf(' '), name = space < 0 ? text : text.slice(0, space);
  let args: unknown;
  try { args = JSON.parse(text.slice(space + 1)); } catch {}
  if (!/^[\w-]+$/.test(name) || typeof args !== 'object' || args === null || Array.isArray(args)) return { name: name.toLowerCase().replace(/\W+$/, ''), subject: text };
  const { verb, subject } = act({ key: 0, type: 'tool', name, args: args as Record<string, unknown>, output: '', failed: false }, false);
  const [, path, rest] = (name === 'bash' && /^cd (\S+) && ([\s\S]+)$/.exec(subject)) || [];
  return path === undefined ? { name, verb, subject } : { name, verb, folder: path.split('/').filter(Boolean).at(-1) ?? path, subject: rest };
}
/** A tool's result without the tool's name in front, which the call above it says. */
export function printed(text: string): { name?: string; text: string } {
  const [head = '', name] = /^([\w-]+): /.exec(text) ?? [];
  return { ...name !== undefined && { name }, text: text.slice(head.length) };
}
/** What pi-optchat puts in front of what an agent said while it still works. */
const RUNNING = 'Message from subagent (still running): ';
/** A report as its row says it: the first one's agent and title, if it is kept as pi-optchat writes it, and what it says. */
export function report(text: string): { agent?: string; title?: string; running: boolean; text: string } {
  const [{ agent, title, body } = { body: text }] = reported(text), running = body.startsWith(RUNNING);
  return { ...agent !== undefined && { agent }, ...title !== undefined && { title }, running, text: running ? body.slice(RUNNING.length) : body };
}
/** A summary in pieces: its words, and the kinds it tags them with (`user:`), where a tag begins it, a line or a sentence. */
export function tagged(text: string): ({ text: string } | { kind: Kind })[] {
  const pieces: ({ text: string } | { kind: Kind })[] = [], tag = /(^|\n|[.;!?)\]"”]\s+|→\s*)(user|talk|tool|echo|work|note): /g;
  let from = 0;
  for (const match of text.matchAll(tag)) {
    const at = match.index + match[1].length;
    if (at > from) pieces.push({ text: text.slice(from, at) });
    pieces.push({ kind: match[2] as Kind });
    from = match.index + match[0].length;
  }
  if (from < text.length) pieces.push({ text: text.slice(from) });
  return pieces;
}
/** How many messages a line holds, as its badge says it: 256, or 16k. */
export const size = (n: number) => n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
