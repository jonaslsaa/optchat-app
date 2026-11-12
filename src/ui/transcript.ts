import type { Message, PiRecord } from '../protocol.ts';

/** What the chat shows, and how it gets there. The chat is the profile's log: every item is a log entry, or what a message Pi
 * has not logged yet will be logged as, so a reply looks the same while it streams, after it is logged, and a year later.
 * Nothing here touches the DOM. */

/** A message as Pi writes it in its records (its docs: message-types.md), read only as far as the chat needs. */
export interface PiMessage { role: string; timestamp: number; content?: unknown; stopReason?: string; errorMessage?: string; toolName?: string; display?: boolean }

/** A block of the reply being written. A tool call's arguments arrive as JSON text (`json`) until its end has them whole. */
type Block = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments?: unknown; json: string };

/** One thing that was said, as pi-optchat logs it: your words, a piece of the reply, a tool call or its result, a report. */
export interface Line extends Pick<Message, 'kind' | 'text' | 'date'> {
  /** Still being written. */
  streaming?: boolean;
  /** The tool call's id, while Pi may still be running it. */
  call?: string;
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
  /** What Pi is doing besides answering: retrying, compacting. */
  activity?: string;
}
export const idle = (): Live => ({ seq: 0, running: false, messages: [], tools: {}, queued: { steering: [], followUp: [] }, status: {}, dialogs: [] });

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
    case 'message_end': return isMessage(record.message) ? { ...next, messages: [...live.messages, record.message], streaming: record.message.role === 'assistant' ? undefined : live.streaming } : next;
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
  const { method, statusKey, statusText } = record;
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
export const stopped = (live: Live): Live => ({ ...live, running: false, streaming: undefined, tools: {}, dialogs: [], activity: undefined });
/** Without the dialog `id`: it was answered, or its time ran out. */
export const without = (live: Live, id: unknown): Live => ({ ...live, dialogs: live.dialogs.filter(dialog => dialog.id !== id) });

const date = (message: PiMessage) => new Date(message.timestamp).toISOString();
/** What pi-optchat logs a message as (its `said`): your words as `user`, a reply's text as `talk` and its tool calls as `tool`,
 * a tool's result and a failed reply as `echo`, and what OptChat itself puts in the chat (a subagent's report) as `work`. */
export function said(message: PiMessage, streaming = false): Line[] {
  const at = date(message), lines: Line[] = [];
  const add = (kind: Line['kind'], text: string, call?: string) => lines.push({ kind, text, date: at, ...streaming && { streaming }, ...call && { call } });
  if (message.role === 'user') add('user', words(message.content));
  else if (message.role === 'custom' && message.display !== false && words(message.content)) add('work', words(message.content));
  else if (message.role === 'toolResult') add('echo', `${message.toolName}: ${words(message.content)}`);
  else if (message.role === 'assistant' && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isObject(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) add('talk', block.text);
      if (block.type === 'toolCall') add('tool', `${block.name} ${JSON.stringify(block.arguments ?? {})}`, String(block.id));
    }
    if (message.stopReason === 'error' || message.stopReason === 'aborted') add('echo', `Agent ${message.stopReason}: ${message.errorMessage ?? 'No further details'}`);
  }
  return lines;
}
/** The reply being written, as the lines it will become. A tool call is shown with its arguments as far as they parse. */
function writing({ timestamp, blocks }: NonNullable<Live['streaming']>): Line[] {
  // A block can be missing: the array has a hole where a later block started first.
  const content = Array.from(blocks, block => block?.type === 'toolCall' && block.arguments === undefined ? { ...block, arguments: partial(block.json) } : block);
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

/** The loaded part of a profile's log, as the chat's items. */
export const logged = (entries: readonly Message[]): Item[] => entries.map(({ i, kind, text, date }) => ({ key: i, kind, text, date }));
/** A connected window's conversation, which only its Pi has, as the chat's items. */
export const spoken = (messages: readonly PiMessage[]): Item[] => messages.flatMap(message => said(message)).map((line, key) => ({ ...line, key }));
/** The chat: `before` (what is logged, or a connected window's conversation), then what the latest run said that is not among it
 * yet. pi-optchat dates an entry with its message's time and logs a run in order, so a message is logged once the log has an
 * entry of its time, and so is everything before it. The new items are numbered on from the last of `before`, which is the
 * number the log will give them. */
export function chat(before: readonly Item[], live: Live): Item[] {
  const dates = new Set(before.map(item => item.date)), next = (before.at(-1)?.key ?? -1) + 1;
  const fresh = live.messages.slice(live.messages.findLastIndex(message => dates.has(date(message))) + 1).flatMap(message => said(message));
  return [...before, ...[...fresh, ...live.streaming ? writing(live.streaming) : []].map((line, n) => ({ ...line, key: next + n }))];
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
/** The chat in the blocks it is drawn as: your message with its images, a note, a report from an agent, or the agent's reply,
 * which is its work and then its answer. `items` is what the part was made from. */
export type Part = { key: number; items: readonly Item[] } & (
  | { type: 'user'; date: string; text: string; images: string[] }
  | { type: 'note'; text: string }
  | { type: 'work'; date: string; agent?: string; body: string }
  | { type: 'reply'; steps: Step[]; answer?: { text: string; streaming?: boolean }; from: string; to: string; stopped: boolean });

const inReply = ({ kind }: Item) => kind === 'talk' || kind === 'tool' || kind === 'echo';
const same = (a: Item, b: Item) => a === b || a.key === b.key && a.kind === b.kind && a.date === b.date && a.text === b.text && a.streaming === b.streaming && a.call === b.call;
/** Groups the chat into its parts. A part of `previous` whose items all still say the same is returned as it was, so that only
 * what changed is drawn again: while a reply streams that is the reply, not the whole chat. */
export function parts(items: readonly Item[], previous: readonly Part[] = []): Part[] {
  const groups: Item[][] = [], before = new Map(previous.map(part => [part.key, part]));
  for (const item of items) {
    const last = groups.at(-1);
    if (last && inReply(item) && inReply(last[0])) last.push(item); else groups.push([item]);
  }
  return groups.map(group => {
    const old = before.get(group[0].key);
    return old && old.items.length === group.length && old.items.every((item, at) => same(item, group[at])) ? old : part(group);
  });
}
const IMAGE = /\[image ([0-9a-f]{16})\]/g;
function part(items: readonly Item[]): Part {
  const [first] = items, last = items.at(-1)!, common = { key: first.key, items };
  if (first.kind === 'user') return { ...common, type: 'user', date: first.date, text: first.text.replace(IMAGE, '').trim(), images: [...first.text.matchAll(IMAGE)].map(match => match[1]) };
  if (first.kind === 'note') return { ...common, type: 'note', text: first.text };
  if (first.kind === 'work') {
    // pi-optchat names the agent in front of its report: `[1a2b3c4d] …`.
    const [, agent, body = first.text] = /^\[([\w-]+)\] ([\s\S]*)$/.exec(first.text) ?? [];
    return { ...common, type: 'work', date: first.date, ...agent && { agent }, body };
  }
  const answer = last.kind === 'talk' ? last : undefined, work = steps(answer ? items.slice(0, -1) : items);
  return {
    ...common, type: 'reply', steps: work, from: first.date, to: last.date, stopped: work.some(step => step.type === 'fault' && step.text.startsWith('Agent aborted')),
    ...answer && { answer: { text: answer.text, ...answer.streaming && { streaming: true } } },
  };
}
/** A reply's tool calls come first and their results after, in the same order: each result goes to the oldest call still without
 * one. A tool call's entry is the tool's name, then its arguments as JSON; a result's is the tool's name, a colon, and what it
 * printed. */
function steps(items: readonly Item[]): Step[] {
  const result: Step[] = [], waiting: Extract<Step, { type: 'tool' }>[] = [];
  for (const { key, kind, text, streaming, call } of items) {
    if (kind === 'talk') result.push({ key, type: 'talk', text, ...streaming && { streaming } });
    else if (kind === 'tool') {
      const space = text.indexOf(' '), step: Extract<Step, { type: 'tool' }> = { key, type: 'tool', name: space < 0 ? text : text.slice(0, space), args: {}, failed: false, ...call && { call } };
      try { const args: unknown = JSON.parse(text.slice(space + 1)); if (isObject(args)) step.args = args; } catch {}
      result.push(step); waiting.push(step);
    } else if (/^Agent (error|aborted): /.test(text) || !waiting.length) result.push({ key, type: 'fault', text });
    else {
      const output = text.slice(text.indexOf(': ') + 2);
      Object.assign(waiting.shift()!, { output, failed: /^error\b/i.test(output) });
    }
  }
  return result;
}
/** How long a reply took, as 42s or 3m 05s. */
export function took(from: string, to: string) {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
