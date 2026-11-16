import { said as recorded } from 'pi-optchat/core';
import type { Message, PiRecord } from '../protocol.ts';

/** What the chat shows, and how it gets there. The chat is the profile's log: every item is a log entry, or what a message Pi
 * has not logged yet will be logged as, so a reply looks the same while it streams, after it is logged, and a year later.
 * Nothing here touches the DOM. */

/** A message as Pi writes it in its records (its docs: message-types.md), read only as far as the chat needs. */
export interface PiMessage { role: string; timestamp: number; content?: unknown; stopReason?: string; errorMessage?: string; toolName?: string; display?: boolean; customType?: string }

/** A block of the reply being written. A tool call's arguments arrive as JSON text (`json`) until its end has them whole. */
type Block = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments?: unknown; json: string };

/** One thing that was said, as pi-optchat logs it: your words, a piece of the reply, a tool call or its result, a report. */
export interface Line extends Pick<Message, 'kind' | 'text' | 'date'> {
  /** Still being written. */
  streaming?: boolean;
  /** The tool call's id, while Pi may still be running it. */
  call?: string;
  /** Part of a connected window's handoff: what its agent wrote for the main chat when the conversation was completed. */
  handoff?: boolean;
  /** The images of your message, as addresses the page can draw, while it is not in the log, which names them by their files. */
  images?: string[];
}
/** A line in its place in the chat. `key` is its number in the profile's log (in a connected window, in its conversation), so it
 * is the same while the line streams, once it is logged, and whichever pages of the log are loaded. */
export interface Item extends Line { key: number }
export interface Live {
  /** The last record applied. */
  seq: number;
  running: boolean;
  /** The latest run's finished messages. */
  messages: PiMessage[];
  /** The reply being written: when it began, and its blocks as far as they have got. */
  streaming?: { timestamp: number; blocks: Block[] };
  /** Tools Pi is running, by call id, with what they have printed so far. */
  tools: Record<string, string>;
  queued: { steering: string[]; followUp: string[] };
  /** What Pi's extensions show: statuses by key, and the dialogs waiting for an answer. */
  status: Record<string, string>;
  dialogs: PiRecord[];
  /** What Pi or an extension said in passing (`notify`): why a message was refused, a warning, a thing it did. Each is said
   * once, and none is part of the chat or of memory. */
  notices: Notice[];
  /** What Pi is doing besides answering: retrying, compacting. */
  activity?: string;
  /** Your message, from when you send it until Pi has it: it is in the chat at once, Pi's own copy takes its place, and it is
   * taken back if it was not sent. It is only here: nothing keeps it. */
  sent?: PiMessage;
}
export interface Notice { text: string; kind: 'info' | 'warning' | 'error' }
export const idle = (): Live => ({ seq: 0, running: false, messages: [], tools: {}, queued: { steering: [], followUp: [] }, status: {}, dialogs: [], notices: [] });

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export const isMessage = (value: unknown): value is PiMessage => isObject(value) && typeof value.role === 'string' && typeof value.timestamp === 'number';
const strings = (value: unknown) => Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
/** A message's or a tool result's words; an image is named as pi-optchat's log would, without its name. */
export function words(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => !isObject(part) ? '' : part.type === 'text' && typeof part.text === 'string' ? part.text : part.type === 'image' ? '[image]' : '').filter(Boolean).join('\n');
}

/** The next state after one of Pi's records (its docs: json.md, rpc-extension-ui.md). `seq` 0 is for records that stand outside the
 * run: what `records` returns as `ui`. */
export function apply(live: Live, record: PiRecord, seq = 0): Live {
  const next = { ...live, seq: seq || live.seq };
  switch (record.type) {
    case 'agent_start': return live.running ? next : { ...next, running: true, messages: [], streaming: undefined, tools: {}, activity: undefined };
    case 'agent_settled': return { ...next, running: false, streaming: undefined, tools: {}, activity: undefined };
    case 'message_start': return isMessage(record.message) && record.message.role === 'assistant' ? { ...next, streaming: { timestamp: record.message.timestamp, blocks: [] } } : next;
    case 'message_update': return live.streaming && isObject(record.assistantMessageEvent) ? { ...next, streaming: { ...live.streaming, blocks: written(live.streaming.blocks, record.assistantMessageEvent) } } : next;
    case 'message_end': return isMessage(record.message) ? { ...next, messages: [...live.messages, record.message], streaming: record.message.role === 'assistant' ? undefined : live.streaming, sent: record.message.role === 'user' ? undefined : live.sent } : next;
    case 'tool_execution_start': return typeof record.toolCallId === 'string' ? { ...next, tools: { ...live.tools, [record.toolCallId]: '' } } : next;
    case 'tool_execution_update': return typeof record.toolCallId === 'string' && isObject(record.partialResult) ? { ...next, tools: { ...live.tools, [record.toolCallId]: words(record.partialResult.content) } } : next;
    case 'tool_execution_end': { const { [String(record.toolCallId)]: _, ...tools } = live.tools; return { ...next, tools }; }
    case 'queue_update': return { ...next, queued: { steering: strings(record.steering), followUp: strings(record.followUp) } };
    case 'auto_retry_start': return { ...next, activity: `Retrying (${record.attempt} of ${record.maxAttempts}): ${record.errorMessage}` };
    case 'compaction_start': return { ...next, activity: 'Compacting' };
    case 'auto_retry_end': case 'compaction_end': return { ...next, activity: undefined };
    case 'extension_ui_request': return shown(next, record);
    default: return next;
  }
}
/** One streaming event of a reply, as RPC mode writes it: a block starts, grows by deltas and ends with its whole content, each
 * named by its place in the reply (`contentIndex`). The events carry no copy of the reply so far, so the deltas are added up here. */
function written(blocks: Block[], event: Record<string, unknown>): Block[] {
  const at = typeof event.contentIndex === 'number' ? event.contentIndex : -1, block = blocks[at], delta = typeof event.delta === 'string' ? event.delta : '';
  const put = (block: Block) => { const next = [...blocks]; next[at] = block; return next; };
  switch (event.type) {
    case 'text_start': return put({ type: 'text', text: '' });
    case 'thinking_start': return put({ type: 'thinking', thinking: '' });
    case 'toolcall_start': return put({ type: 'toolCall', id: String(event.id), name: String(event.toolName), json: '' });
    case 'text_delta': return block?.type === 'text' ? put({ ...block, text: block.text + delta }) : blocks;
    case 'thinking_delta': return block?.type === 'thinking' ? put({ ...block, thinking: block.thinking + delta }) : blocks;
    case 'toolcall_delta': return block?.type === 'toolCall' ? put({ ...block, json: block.json + delta }) : blocks;
    case 'text_end': return typeof event.content === 'string' ? put({ type: 'text', text: event.content }) : blocks;
    case 'thinking_end': return typeof event.content === 'string' ? put({ type: 'thinking', thinking: event.content }) : blocks;
    case 'toolcall_end': return isObject(event.toolCall) ? put({ type: 'toolCall', id: String(event.toolCall.id), name: String(event.toolCall.name), arguments: event.toolCall.arguments, json: '' }) : blocks;
    default: return blocks;
  }
}
function shown(live: Live, record: PiRecord): Live {
  const { method, statusKey, statusText, message: text, notifyType: kind } = record;
  if (method === 'notify') return typeof text === 'string' && text ? { ...live, notices: [...quiet(live, text).notices, { text, kind: kind === 'warning' || kind === 'error' ? kind : 'info' }] } : live;
  if (method === 'setStatus' && typeof statusKey === 'string') {
    const { [statusKey]: _, ...status } = live.status;
    return { ...live, status: typeof statusText === 'string' ? { ...status, [statusKey]: statusText } : status };
  }
  return method === 'select' || method === 'confirm' || method === 'input' || method === 'editor' ? { ...live, dialogs: [...live.dialogs.filter(d => d.id !== record.id), record] } : live;
}
/** A window's state from what `records` answered: the latest run, then what stands now (`ui`). The run's own records say what
 * was shown at the time, a dialog answered since among it, so only `ui` counts for that. */
export function replay({ ui, records }: { ui: PiRecord[]; records: { seq: number; record: PiRecord }[] }, seq: number): Live {
  const run = records.reduce((live, { seq, record }) => apply(live, record, seq), idle());
  return ui.reduce<Live>((live, record) => apply(live, record), { ...run, seq: Math.max(seq, run.seq), status: {}, dialogs: [] });
}
/** A window whose Pi has stopped: what its run said stays, and nothing is running, being written or asked any more. Pi can die
 * in a run, and then no `agent_settled` says so. */
export const stopped = (live: Live): Live => ({ ...live, running: false, streaming: undefined, tools: {}, dialogs: [], activity: undefined, sent: undefined });
/** Without a notice that was dismissed, or without any: they were read, or the next message is on its way. */
export function quiet(live: Live, text?: string): Live { return { ...live, notices: text === undefined ? [] : live.notices.filter(notice => notice.text !== text) }; }
/** Without the dialog `id`: it was answered, or its time ran out. */
export const without = (live: Live, id: unknown): Live => ({ ...live, dialogs: live.dialogs.filter(dialog => dialog.id !== id) });

const date = (message: PiMessage) => new Date(message.timestamp).toISOString();
/** What pi-optchat logs a message as, by its own `said`: your words as `user`, a reply's text as `talk` and its tool calls as
 * `tool`, a tool's result and a failed reply as `echo`. What OptChat itself puts in the chat (a subagent's report) is Pi's
 * custom message, which pi-optchat logs as `work` where it sends it. A tool call keeps its id, which the log does not have.
 * The log names an image by its file, which is not written yet: your message keeps its images, and a tool's is named as one. */
export function said(message: PiMessage, streaming = false): Line[] {
  const report = message.role === 'custom' && message.display !== false && words(message.content);
  const calls = Array.isArray(message.content) ? message.content.flatMap(block => isObject(block) && block.type === 'toolCall' ? String(block.id) : []) : [];
  const images = message.role === 'user' && Array.isArray(message.content) ? message.content.flatMap(block => isObject(block) && block.type === 'image' ? `data:${String(block.mimeType)};base64,${String(block.data)}` : []) : [];
  return (report ? [['work', report] as const] : recorded(message, { imageRef: () => images.length ? '' : '[image]' })).map(([kind, text]) => {
    const call = kind === 'tool' ? calls.shift() : undefined;
    return { kind, text, date: date(message), ...streaming && { streaming }, ...call && { call }, ...images.length && { images } };
  });
}
/** The reply being written, as the lines it will become. A tool call is shown with its arguments as far as they parse. */
function writing({ timestamp, blocks }: NonNullable<Live['streaming']>): Line[] {
  // A block can be missing: the array has a hole where a later block started first.
  const content = Array.from(blocks, block => block?.type === 'toolCall' && block.arguments === undefined ? { ...block, arguments: partial(block.json) } : block).filter(block => block !== undefined);
  return said({ role: 'assistant', timestamp, content }, true);
}
function partial(json: string): unknown {
  try { return JSON.parse(json); } catch { return json ? { '…': json } : {}; }
}
/** What the reply being written is thinking now: its last block, if that is thought. */
export function thinking({ streaming }: Live) {
  const last = streaming?.blocks.at(-1);
  return last?.type === 'thinking' ? last.thinking : undefined;
}

/** How long a reply that streams is let take to show what has come, in ms. */
export const LAG = 200;
/** How many letters of a reply that streams are shown `ms` after `shown` were. The network brings a reply in bursts (a real
 * one: some 10 letters every 33 ms, then nothing for a quarter of a second, then 120 at once); the page lets them out at a
 * steady pace instead, faster the further it is behind, so all that has come is out within about `LAG`, up to a word's end. */
export function paced(text: string, shown: number, ms: number): number {
  if (shown >= text.length) return text.length;
  const to = shown + Math.ceil((text.length - shown) * Math.min(1, ms / LAG)), end = text.slice(to).search(/\s/);
  return end < 0 ? to : to + end;
}
/** A reply that streams, without the Markdown its end has opened and not closed yet, so it never shows as it was written: a
 * `**`, `` ` `` or a formula's `$` on its last line, a `$$` formula, or a table's rows before the line under its head. What is
 * held back is at most `HOLD` letters: a longer one is more likely a lone `$` than a formula, and shows as it is. Nothing is
 * held in a code block, where all of it is code. */
const HOLD = 80;
export function closed(text: string): string {
  const lines = text.split('\n'), last = lines.at(-1) ?? '', start = text.length - last.length;
  if (lines.filter(line => /^ {0,3}(`{3,}|~{3,})/.test(line)).length % 2) return text;
  const cuts = ['**', '`', '$'].flatMap(mark => {
    const at = last.lastIndexOf(mark);
    return last.split(mark).length % 2 === 0 && !(mark === '$' && /[\s\d]/.test(last.charAt(at + 1))) ? [start + at] : [];
  });
  const display = lines.flatMap((line, at) => line.trim() === '$$' ? [at] : []);
  if (display.length % 2) cuts.push(lines.slice(0, display.at(-1)).join('\n').length);
  const rows = /(?:^|\n)((?:[ \t]*\|.*(?:\n|$))+)$/.exec(text.slice(text.lastIndexOf('\n\n') + 1));
  if (rows && !/^[ \t|:-]*-[ \t|:-]*\n/m.test(rows[1])) cuts.push(text.length - rows[1].length);
  const cut = Math.min(...cuts.filter(cut => text.length - cut <= HOLD));
  return cut < text.length ? text.slice(0, cut) : text;
}

/** pi-optchat's request for a handoff (its `rpc-window.ts`): Complete has a connected window's agent say one thing more, which is
 * for the main chat and no answer to you. */
const asksHandoff = (message: PiMessage) => message.role === 'custom' && message.customType === 'optchat-handoff-request';
/** Each message's lines, and those of the reply being written. From a request for a handoff up to your next message they are
 * the handoff; the request, which says nothing itself, is its first line, so the handoff is there before a word of it is. */
function told(messages: readonly PiMessage[], streaming?: Live['streaming']): Line[][] {
  let handoff = false;
  const lines = (message: PiMessage): Line[] => {
    if (asksHandoff(message)) { handoff = true; return [{ kind: 'work', text: '', date: date(message), handoff }]; }
    if (message.role === 'user') handoff = false;
    return said(message);
  };
  const marked = (lines: Line[]) => handoff ? lines.map(line => ({ ...line, handoff })) : lines;
  return [...messages.map(message => marked(lines(message))), ...streaming ? [marked(writing(streaming))] : []];
}

/** The loaded part of a profile's log, as the chat's items. */
export const logged = (entries: readonly Message[]): Item[] => entries.map(({ i, kind, text, date }) => ({ key: i, kind, text, date }));
/** A connected window's conversation, which only its Pi has, as the chat's items. */
export const spoken = (messages: readonly PiMessage[]): Item[] => told(messages).flat().map((line, key) => ({ ...line, key }));
/** The chat: `before` (what is logged, or a connected window's conversation), then what the latest run said that is not among it
 * yet. pi-optchat dates an entry with its message's time and logs a run in order, so a message is logged once the log has an
 * entry of its time, and so is everything before it. The new items are numbered on from the last of `before`, which is the
 * number the log will give them. */
export function chat(before: readonly Item[], live: Live): Item[] {
  const dates = new Set(before.map(item => item.date)), next = (before.at(-1)?.key ?? -1) + 1;
  const last = live.messages.findLastIndex(message => dates.has(date(message))), lines = told(live.sent ? [...live.messages, live.sent] : live.messages, live.streaming);
  // The log does not name a tool call; the run does, and what a call that is still running has printed goes by that name.
  const calls = new Map(live.messages.slice(0, last + 1).map((message, at) => [date(message), lines[at].flatMap(line => line.call ?? [])]));
  const named = before.map(item => { const call = item.kind === 'tool' ? calls.get(item.date)?.shift() : undefined; return call ? { ...item, call } : item; });
  return [...named, ...lines.slice(last + 1).flat().map((line, n) => ({ ...line, key: next + n }))];
}
/** A profile's log with one more page read: the entries of both by their number, and of those the unbroken run up to the
 * newest, since a page that does not reach what was loaded leaves a gap nobody has read. */
export function merged(entries: readonly Message[], page: readonly Message[]): Message[] {
  const all = [...new Map([...entries, ...page].map(entry => [entry.i, entry])).values()].sort((a, b) => a.i - b.i);
  return all.slice(Math.max(0, all.findLastIndex((entry, at) => at > 0 && all[at - 1].i !== entry.i - 1)));
}

/** One step of the agent's work: something it said on the way, a tool call with what it printed, or what stopped it. `failed` is
 * read off the output, since the log does not say. */
export type Step = { key: number } & (
  | { type: 'talk'; text: string; streaming?: boolean }
  | { type: 'tool'; name: string; args: Record<string, unknown>; output?: string; failed: boolean; call?: string }
  | { type: 'fault'; text: string });
export type Tool = Extract<Step, { type: 'tool' }>;
/** The chat in the blocks it is drawn as: your message with its images, a note, a report from an agent (with the `title` it was
 * started under, where the chat has its start), the agent's reply, which is its work and then its answer, or the handoff a
 * connected window's agent wrote for the main chat (`body`, empty until it is written). `items` is what the part was made from. */
export type Part = { key: number; items: readonly Item[] } & (
  | { type: 'user'; date: string; text: string; /** Each by its name in the profile, or as an address where it is not kept there. */ images: string[] }
  | { type: 'note'; text: string }
  | { type: 'work'; date: string; agent?: string; title?: string; body: string }
  | { type: 'handoff'; date: string; body: string }
  | { type: 'reply'; steps: Step[]; answer?: { text: string; streaming?: boolean }; from: string; to: string; stopped: boolean });

const inReply = ({ kind }: Item) => kind === 'talk' || kind === 'tool' || kind === 'echo';
const same = (a: Item, b: Item) => a === b || a.key === b.key && a.kind === b.kind && a.date === b.date && a.text === b.text && a.streaming === b.streaming && a.call === b.call && a.handoff === b.handoff;
/** Groups the chat into its parts. A part of `previous` whose items all still say the same is returned as it was, so that only
 * what changed is drawn again: while a reply streams that is the reply, not the whole chat. */
export function parts(items: readonly Item[], previous: readonly Part[] = []): Part[] {
  const groups: Item[][] = [], before = new Map(previous.map(part => [part.key, part]));
  for (const item of items) {
    const last = groups.at(-1);
    // A handoff is one part, from the request for it on, and no part of the reply before it.
    if (last && (item.handoff ? last[0].handoff && item.kind !== 'work' : inReply(item) && inReply(last[0]) && !last[0].handoff)) last.push(item); else groups.push([item]);
  }
  const made = groups.map(group => {
    const old = before.get(group[0].key);
    return old && old.items.length === group.length && old.items.every((item, at) => same(item, group[at])) ? old : part(group);
  });
  // A report that does not say its agent's title is named by its number; the call that started the agent, where the chat
  // reaches back to it, has the title.
  const titles = new Map(made.flatMap(part => part.type === 'reply' ? part.steps.flatMap(spawned) : []));
  return made.map(part => {
    const title = part.type === 'work' && part.agent && part.title === undefined ? titles.get(part.agent) : undefined;
    return part.type === 'work' && title !== undefined ? { ...part, title } : part;
  });
}
/** The agents a `spawn` call started, each with the title it was given: pi-optchat answers `Started: <id>, <id>.`, in the order
 * of the call's tasks. */
function spawned(step: Step): [id: string, title: string][] {
  const tasks = step.type === 'tool' && step.name === 'spawn' && Array.isArray(step.args.tasks) ? step.args.tasks : [];
  const ids = step.type === 'tool' ? /^Started: ([^.]+)\./.exec(step.output ?? '')?.[1].split(', ') ?? [] : [];
  return ids.flatMap((id, at): [string, string][] => { const task: unknown = tasks[at]; return isObject(task) && typeof task.title === 'string' ? [[id, task.title]] : []; });
}
/** The text a message ended on: pi-optchat logs each block of it as an entry of its own, under the message's date. */
function closing(items: readonly Item[]): Item[] {
  const last = items.at(-1);
  return items.slice(items.findLastIndex(item => item.kind !== 'talk' || item.date !== last?.date) + 1);
}
const text = (items: Item[]) => items.map(item => item.text).join('\n\n');
const IMAGE = /\[image ([0-9a-f]{16})\]/g;
function part(items: readonly Item[]): Part {
  const [first] = items, last = items.at(-1)!, common = { key: first.key, items };
  if (first.handoff) {
    // The handoff is the text of the agent's last message, if that was text and no tool call, as pi-optchat reads it (its `handoffText`).
    const written = !last.streaming && !items.some(item => item.kind === 'tool' && item.date === last.date);
    return { ...common, type: 'handoff', date: last.date, body: written ? text(closing(items)) : '' };
  }
  if (first.kind === 'user') return { ...common, type: 'user', date: first.date, text: first.text.replace(IMAGE, '').trim(), images: first.images ?? [...first.text.matchAll(IMAGE)].map(match => match[1]) };
  if (first.kind === 'note') return { ...common, type: 'note', text: first.text };
  if (first.kind === 'work') {
    // pi-optchat names the agent in front of its report, with its title if it has one (`[1a2b3c4d · Why it flakes] …`), and
    // under it tells the main agent how to read the agent's chat, which here is a click on the report.
    const [, agent, title, body = first.text] = /^\[([\w-]+)(?: · ([^\]\n]*))?\] ([\s\S]*)$/.exec(first.text) ?? [];
    return { ...common, type: 'work', date: first.date, ...agent && { agent }, ...title && { title }, body: body.replace(/\n\nFull chat: zoom\("[\w-]+"\)$/, '') };
  }
  // What the agent was saying when it was stopped stays in view, as its answer does.
  const cut = last.kind === 'echo' && last.text.startsWith('Agent aborted'), answer = closing(cut ? items.slice(0, -1) : items);
  const work = steps(items.filter(item => !answer.includes(item)));
  return {
    ...common, type: 'reply', steps: work, from: first.date, to: last.date, stopped: cut || work.some(step => step.type === 'fault' && step.text.startsWith('Agent aborted')),
    ...answer.length > 0 && { answer: { text: text(answer), ...answer.at(-1)?.streaming && { streaming: true } } },
  };
}
/** What Pi's bash adds under a command's output when it failed. */
const COMMAND_FAILED = /(^|\n)Command (exited with code [1-9]\d*|aborted|timed out after \d+ seconds)[^\n]*$/;
/** A reply's tool calls come first and their results after, in the same order: each result goes to the oldest call still without
 * one. A tool call's entry is the tool's name, then its arguments as JSON; a result's is the tool's name, a colon, and what it
 * printed. */
function steps(items: readonly Item[]): Step[] {
  const result: Step[] = [], waiting: Tool[] = [];
  for (const { key, kind, text, streaming, call } of items) {
    if (kind === 'talk') result.push({ key, type: 'talk', text, ...streaming && { streaming } });
    else if (kind === 'tool') {
      const space = text.indexOf(' '), step: Tool = { key, type: 'tool', name: space < 0 ? text : text.slice(0, space), args: {}, failed: false, ...call && { call } };
      try { const args: unknown = JSON.parse(text.slice(space + 1)); if (isObject(args)) step.args = args; } catch {}
      result.push(step); waiting.push(step);
    } else if (/^Agent (error|aborted): /.test(text) || !waiting.length) result.push({ key, type: 'fault', text });
    else {
      const output = text.slice(text.indexOf(': ') + 2);
      const step = waiting.shift()!;
      // Pi's edit and write say nothing else when they did their work, and the log does not keep that a call failed.
      const changes = step.name === 'edit' || step.name === 'write';
      Object.assign(step, { output, failed: /^error\b/i.test(output) || step.name === 'bash' && COMMAND_FAILED.test(output) || changes && !output.startsWith('Successfully') });
    }
  }
  return result;
}
/** A finished reply's work in a few words: "Worked for 42s", "Stopped after 3m 05s", "Failed after 2s". The time is from
 * the reply's first message to its last, and the log dates a message when it began, not when it ended: how long the last one
 * was written is not in it. So a reply of one message, such as one stopped while it was being written, has no time to say,
 * and says none rather than 0s. */
export function worked({ from, to, stopped, steps }: Extract<Part, { type: 'reply' }>) {
  const [verb, word] = stopped ? ['Stopped', 'after'] : steps.some(step => step.type === 'fault') ? ['Failed', 'after'] : ['Worked', 'for'], time = took(from, to);
  return time === '0s' ? verb : `${verb} ${word} ${time}`;
}
/** What ↑ (`back`) or ↓ in the composer brings back of what you said in the chat: the message before the one in the box or the
 * one after it, and an empty box after the newest. Only while the box is empty or holds one of them as it was sent, so the
 * key never takes what you are typing. A message sent twice is there once, where it was sent last. */
export function recalled(chat: readonly Item[], text: string, back: boolean) {
  // A picture you sent is not text to send again: the log names it, and a message as Pi has it says only that there was one.
  const said = chat.flatMap(item => item.kind === 'user' ? item.text.replace(/\[image(?: [0-9a-f]{16})?\]/g, '').trim() || [] : []);
  const past = [...new Set(said.reverse())], at = past.indexOf(text);
  if (text ? at < 0 : !back) return;
  return past[at + (back ? 1 : -1)] ?? (back ? undefined : '');
}
/** What is `typed` in the composer with something `said` in the chat under it as a quote, a `>` before each line of it, and
 * an empty line after it to answer on. */
export function quoted(typed: string, said: string) {
  const quote = said.trim().split('\n').map(line => `> ${line}`.trimEnd()).join('\n');
  return `${typed.trim() ? `${typed.trimEnd()}\n\n` : ''}${quote}\n\n`;
}
/** How long something took, as 42s, 3m 05s or 1h 15m. */
export function took(from: string, to: string) {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)), minutes = Math.floor(seconds / 60), two = (count: number) => String(count).padStart(2, '0');
  return seconds < 60 ? `${seconds}s` : minutes < 60 ? `${minutes}m ${two(seconds % 60)}s` : `${Math.floor(minutes / 60)}h ${two(minutes % 60)}m`;
}

const VERBS: Record<string, [doing: string, done: string]> = {
  bash: ['Running', 'Ran'], read: ['Reading', 'Read'], edit: ['Editing', 'Edited'], write: ['Writing', 'Wrote'],
  grep: ['Searching for', 'Searched for'], find: ['Finding', 'Found'], ls: ['Listing', 'Listed'],
  zoom: ['Looking back at', 'Looked back at'], search: ['Searching memory for', 'Searched memory for'], date: ['Checking the date of', 'Checked the date of'], tell: ['Telling', 'Told'],
};
/** The argument a call is named by, the first of these it has, or else its first. */
const NAMED = ['command', 'pattern', 'query', 'path', 'file_path', 'url', 'title', 'id'];
/** A piece of what an opened call shows of itself. `change`: text an edit took out of the file, or put in. */
export type Shown = { text: string; change?: 'removed' | 'added' };
const MARKS = { removed: '−', added: '+' };
/** How many lines a change put in and took out. */
interface Stat { added: number; removed: number }
const counted = (lines: Shown[]): Stat => ({ added: lines.filter(line => line.change === 'added').length, removed: lines.filter(line => line.change === 'removed').length });
/** A line of a diff: one a change kept, or took out or put in. */
const marked = (line: string, change?: Shown['change']): Shown => ({ text: `${change ? MARKS[change] : ' '} ${line}`, ...change && { change } });
/** What an edit that is on its way or failed was given: each line of `text`, as taken out or put in. */
const changed = (change: 'removed' | 'added', text: unknown): Shown[] => typeof text === 'string' && text ? text.split('\n').map(line => marked(line, change)) : [];
/** The lines `before` and `after` have in common, and those taken out and put in: around the longest run of lines both have, as the
 * `diff` command finds it. Pi's edits are a few lines each; past a million pairs to compare, all go out and come in. An edit's
 * text ends in the middle of a line of the file, at the line break the text has last or none, so that last piece is a line too:
 * a line break put in or taken out there is a line put in or taken out. When both end on one, the empty pieces after it are no news. */
export function diff(before: string, after: string): Shown[] {
  const a = before.split('\n'), b = after.split('\n');
  if (a.at(-1) === '' && b.at(-1) === '') { a.pop(); b.pop(); }
  if (a.length * b.length > 1e6) return [{ text: 'Too long to compare line by line: all of it was taken out, and this put in.' }, ...a.map(text => marked(text, 'removed')), ...b.map(text => marked(text, 'added'))];
  // common[i][j]: how many lines a[i…] and b[j…] have in common.
  const common = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1)), lines: Shown[] = [];
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(marked(a[i])); i++; j++; }
    else if (i < a.length && (j === b.length || common[i + 1][j] >= common[i][j + 1])) lines.push(marked(a[i++], 'removed'));
    else lines.push(marked(b[j++], 'added'));
  }
  return lines;
}
/** A tool call in words: what it does (`Ran`, or `Running` while it does; a tool the app does not know goes by its name) and
 * to what, which is its command, pattern or path, the agents it starts, or else its first argument. `detail` is what the call
 * shows of itself when it is opened, which is only what the line (whole, once opened) does not say: an edit as the diff it
 * made, a file written as the lines it put in (`stat` counts them, once the call is done), the text told to an agent, a command
 * of several lines (the line has its first), and for anything else the arguments as given. */
export function act({ name, args, output, failed }: Tool, live: boolean): { verb: string; subject: string; detail: Shown[]; stat?: Stat } {
  const pending = live && output === undefined, done = output !== undefined && !failed;
  if (name === 'spawn' && Array.isArray(args.tasks)) {
    const tasks = args.tasks.filter(isObject), titles = tasks.flatMap(task => typeof task.title === 'string' ? [task.title] : []), many = args.tasks.length !== 1;
    return {
      verb: `${pending ? 'Starting' : 'Started'} ${many ? `${args.tasks.length} agents` : 'an agent'}${titles.length ? ':' : ''}`, subject: titles.join(', '),
      detail: tasks.map(task => ({ text: [task.title, task.task].filter(part => typeof part === 'string').join('\n') })),
    };
  }
  // Pi gives null for an argument the agent left out.
  const given = Object.fromEntries(Object.entries(args).filter(([, value]) => value != null));
  const key = NAMED.find(key => key in given) ?? Object.keys(given)[0] ?? '', first = given[key], { path, offset, limit, n, edits, content, message } = given;
  let subject = typeof first === 'string' ? first : first === undefined ? '' : JSON.stringify(first), detail: Shown[] | undefined, stat: Stat | false = false;
  // How long a command may take is nobody's news.
  const said = [key, ...name === 'bash' ? ['timeout'] : []];
  if (name === 'read' && (typeof offset === 'number' || typeof limit === 'number')) {
    const from = typeof offset === 'number' ? offset : 1;
    subject += typeof limit === 'number' ? `, lines ${from}–${from + limit - 1}` : `, from line ${from}`;
    said.push('offset', 'limit');
  } else if ((name === 'grep' || name === 'find') && typeof path === 'string') { subject += ` in ${path}`; said.push('path'); }
  else if (name === 'zoom' && typeof n === 'number') { subject += `+${n}`; said.push('n'); }
  // An edit or a write that was done is the diff it made, with how many lines it put in and took out; one that is still on its
  // way or failed, the text it was given.
  else if (name === 'edit' && Array.isArray(edits)) {
    const pairs = edits.flatMap(edit => isObject(edit) && typeof edit.oldText === 'string' && typeof edit.newText === 'string' ? [[edit.oldText, edit.newText] as const] : []);
    if (done && pairs.length === edits.length) stat = counted(detail = pairs.flatMap(([before, after], index) => [...index ? [{ text: '…' }] : [], ...diff(before, after)]));
    else detail = edits.filter(isObject).flatMap((edit, index) => [...index ? [{ text: '…' }] : [], ...changed('removed', edit.oldText), ...changed('added', edit.newText)]);
  } else if (name === 'write' && typeof content === 'string') {
    // The line break that ends a file begins no line.
    detail = done ? (content ? content.replace(/\n$/, '').split('\n') : []).map(line => marked(line, 'added')) : [{ text: content }];
    if (done) stat = counted(detail);
  }
  else if (name === 'tell' && typeof message === 'string') detail = [{ text: message }];
  const [line, ...more] = subject.split('\n');
  detail ??= Object.keys(given).some(key => !said.includes(key)) ? [{ text: JSON.stringify(given, null, 2) }] : more.length ? [{ text: subject }] : [];
  return { verb: VERBS[name]?.[pending ? 0 : 1] ?? name, subject: more.length ? `${line} …` : subject, detail, ...stat && { stat } };
}
/** What pi-optchat's status line says that is news. It is written for a terminal (`OptChat: work · 350 messages · 2 pending ·
 * 1 agents`, a window's `OptChat: work · connected window · main window not reachable`): the profile, the size of the log and
 * what the window is are on the page already, a count of nothing says nothing, and the rest is said in words. */
export function news(status = ''): string[] {
  return status.split(' · ').slice(1).flatMap(part => {
    const [, count, what] = /^(\d+) (messages|pending|agents)$/.exec(part) ?? [];
    if (what === 'agents') return count === '0' ? [] : [`${count} ${count === '1' ? 'agent' : 'agents'} working`];
    if (what === 'pending') return count === '0' ? [] : [`${count} ${count === '1' ? 'summary' : 'summaries'} to write`];
    return what || part === 'connected window' || part === 'completed' ? [] : [part];
  });
}
/** Why a window's Pi is not running: a headline, the detail, and what to do next. The server says `Pi exited (code 3).` and what
 * Pi wrote last; pi-optchat says `Profile already running: <profile> · PID <pid> · <host> · <directory>` when a Pi outside
 * the app has the profile. */
export function failure(error: string): { title: string; detail: string; next: string } {
  const [, profile, pid, host, cwd] = /^Profile already running: (.+?) · PID (\d+) · (.+?) · (.+)$/.exec(error) ?? [];
  if (profile) return { title: `${profile} is running outside the app`, detail: `A Pi in a terminal has it open: PID ${pid} on ${host}, in ${cwd}.`, next: 'Close it there, then send your message again.' };
  const [, how, why] = /^Pi exited \((.+?)\)\.\s*([\s\S]*)$/.exec(error) ?? [];
  return { title: how ? 'Pi stopped' : 'Pi is not running', detail: how ? `Pi exited with ${how}${why && `: ${why}`}` : error, next: 'Your next message starts it again.' };
}
