import type { Line, Message, Result, WindowState } from '../protocol.ts';

/** A profile's memory view as the page has it: the view as the server last read it, the two lines under each line that was
 * opened and the message under a line of one, and which lines are open. A line is the same line for as long as the memory is
 * the same one, so what was read under one stays right, and a line stays open while the view is read again. Nothing here
 * touches the DOM. */
export interface Tree {
  view?: Result<'view'>;
  under: Record<string, Line[]>;
  originals: Record<number, Message[]>;
  open: readonly string[];
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
export const read = (tree: Tree, line: Line) => line.n === 1 ? line.id in tree.originals : key(line) in tree.under;
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
