import type { Hit, Line, Message, Result, WindowState } from '../protocol.ts';

/** A search of the memory: what is searched for, the messages found so far, newest first (none until the first answer is
 * here), and how many older ones there are to ask for. */
export interface Search { text: string; hits?: Hit[]; more: number }
/** A profile's memory view as the page has it: the view as the server last read it, the two lines under each line that was
 * opened and the message under a line of one, and which lines are open. A line is the same line for as long as the memory is
 * the same one, so what was read under one stays right, and a line stays open while the view is read again. With a `search`
 * the messages it found stand in the tree's place, until one of them is opened: `found` is that message, shown in the tree.
 * Nothing here touches the DOM. */
export interface Tree {
  view?: Result<'view'>;
  under: Record<string, Line[]>;
  originals: Record<number, Message[]>;
  open: readonly string[];
  search?: Search;
  found?: number;
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
 * that does, down to the line of the message alone. A line begins at a multiple of its length, so they are known without
 * being read. None when the view does not reach the message. */
export function path(lines: readonly Line[], id: number) {
  const top = lines.find(line => line.id <= id && id < line.id + line.n), down: Pick<Line, 'id' | 'n'>[] = [];
  for (let n = top?.n ?? 0; n >= 1; n /= 2) down.push({ id: id - id % n, n });
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
