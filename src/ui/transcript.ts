import type { Message, PiRecord } from '../protocol.ts';

/** What the chat shows, and how it gets there. The chat is the profile's log: every item is a log entry, or what a message Pi
 * has not logged yet will be logged as, so a reply looks the same while it streams, after it is logged, and a year later.
 * Nothing here touches the DOM. */

/** A message as Pi writes it in its records (its docs: message-types.md), read only as far as the chat needs. */
export interface PiMessage { role: string; timestamp: number; content?: unknown; stopReason?: string; errorMessage?: string; toolName?: string; display?: boolean }

/** A block of the reply being written. A tool call's arguments arrive as JSON text (`json`) until its end has them whole. */
type Block = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments?: unknown; json: string };

export interface Item extends Pick<Message, 'kind' | 'text' | 'date' | 'origin'> {
  /** The same for an item while it streams and once it is logged, so the chat keeps what you opened. */
  key: string;
  /** Still being written. */
  streaming?: boolean;
  /** The tool call's id, while Pi still runs it. */
  call?: string;
}
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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isMessage = (value: unknown): value is PiMessage => isObject(value) && typeof value.role === 'string' && typeof value.timestamp === 'number';
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

/** A long tool result as pi-optchat logs it (its `cap`): the head and the tail, and how much is left out between them. */
function cap(text: string, limit = 30_000) {
  if (text.length <= limit) return text;
  const notice = (omitted: number) => `\n[${omitted} characters omitted; head and tail retained]\n`;
  const half = Math.floor((limit - notice(text.length).length) / 2);
  const head = text.slice(0, /[\ud800-\udbff]/.test(text[half - 1]) ? half - 1 : half);
  const tail = text.slice(/[\udc00-\udfff]/.test(text[text.length - half]) ? text.length - half + 1 : text.length - half);
  return head + notice(text.length - head.length - tail.length) + tail;
}
const date = (message: PiMessage) => new Date(message.timestamp).toISOString();
/** What pi-optchat logs a message as (its `said`): your words as `user`, a reply's text as `talk` and its tool calls as `tool`,
 * a tool's result and a failed reply as `echo`, and what OptChat itself puts in the chat (a subagent's report) as `work`. */
export function said(message: PiMessage, streaming = false): Item[] {
  const at = date(message), items: Item[] = [];
  const add = (kind: Item['kind'], text: string, call?: string) => items.push({ key: '', kind, text, date: at, ...streaming && { streaming }, ...call && { call } });
  if (message.role === 'user') add('user', words(message.content));
  else if (message.role === 'custom' && message.display !== false && words(message.content)) add('work', words(message.content));
  else if (message.role === 'toolResult') add('echo', cap(`${message.toolName}: ${words(message.content)}`));
  else if (message.role === 'assistant' && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isObject(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) add('talk', block.text);
      if (block.type === 'toolCall') add('tool', `${block.name} ${JSON.stringify(block.arguments ?? {})}`, String(block.id));
    }
    if (message.stopReason === 'error' || message.stopReason === 'aborted') add('echo', `Agent ${message.stopReason}: ${message.errorMessage ?? 'No further details'}`);
  }
  return items;
}
/** What the reply being written is thinking now: its last block, if that is thought. */
/** The reply being written, as the items it will become. A tool call is shown with its arguments as far as they parse. */
function writing({ timestamp, blocks }: NonNullable<Live['streaming']>): Item[] {
  // A block can be missing: the array has a hole where a later block started first.
  const content = Array.from(blocks, block => block?.type === 'toolCall' && block.arguments === undefined ? { ...block, arguments: partial(block.json) } : block);
  return said({ role: 'assistant', timestamp, content }, true);
}
function partial(json: string): unknown {
  try { return JSON.parse(json); } catch { return json ? { '…': json } : {}; }
}
export function thinking({ streaming }: Live) {
  const last = streaming?.blocks.at(-1);
  return last?.type === 'thinking' ? last.thinking : undefined;
}

/** The chat: what is logged, then what the latest run said that is not logged yet. pi-optchat dates an entry with its message's
 * time and logs a run in order, so a message is logged once the log has an entry of its time, and so is everything before it. */
export function chat(logged: readonly Item[], live: Live): Item[] {
  const dates = new Set(logged.map(item => item.date));
  const fresh = live.messages.slice(live.messages.findLastIndex(message => dates.has(date(message))) + 1);
  const seen = new Map<string, number>();
  return [...logged, ...fresh.flatMap(message => said(message)), ...live.streaming ? writing(live.streaming) : []].map(item => {
    const n = seen.get(item.date) ?? 0;
    seen.set(item.date, n + 1);
    return { ...item, key: `${item.date} ${n}` };
  });
}
export const logged = (entries: readonly Message[]): Item[] => entries.map(({ kind, text, date, origin }) => ({ key: '', kind, text, date, ...origin && { origin } }));

/** One step of the agent's work: something it said on the way, or a tool call with its result. */
export type Step = { type: 'talk'; item: Item } | { type: 'tool'; call: Item; result?: Item } | { type: 'fault'; item: Item };
/** The chat in the blocks it is drawn as: your message, a report, or the agent's reply, which is its work and then its answer. */
export type Part = { type: 'user' | 'work' | 'note'; item: Item } | { type: 'reply'; key: string; steps: Step[]; answer?: Item; from: string; to: string };

export function parts(items: readonly Item[]): Part[] {
  const result: Part[] = [];
  let reply: Item[] = [];
  const close = () => {
    if (!reply.length) return;
    const answer = reply.at(-1)?.kind === 'talk' ? reply.at(-1) : undefined, work = answer ? reply.slice(0, -1) : reply;
    result.push({ type: 'reply', key: reply[0].key, steps: steps(work), ...answer && { answer }, from: reply[0].date, to: reply.at(-1)!.date });
    reply = [];
  };
  for (const item of items) {
    if (item.kind === 'talk' || item.kind === 'tool' || item.kind === 'echo') { reply.push(item); continue; }
    close();
    result.push({ type: item.kind, item });
  }
  close();
  return result;
}
/** A reply's tool calls come first and their results after, in the same order: each result goes to the oldest call still without one. */
function steps(items: Item[]): Step[] {
  const result: Step[] = [], waiting: Extract<Step, { type: 'tool' }>[] = [];
  for (const item of items) {
    if (item.kind === 'talk') result.push({ type: 'talk', item });
    else if (item.kind === 'tool') { const step = { type: 'tool' as const, call: item }; result.push(step); waiting.push(step); }
    else if (/^Agent (error|aborted): /.test(item.text) || !waiting.length) result.push({ type: 'fault', item });
    else Object.assign(waiting.shift()!, { result: item });
  }
  return result;
}
/** A tool call as its log entry has it: the tool's name, then its arguments as JSON. */
export function call(text: string): { name: string; args: Record<string, unknown> } {
  const space = text.indexOf(' '), name = space < 0 ? text : text.slice(0, space);
  try { const args: unknown = JSON.parse(text.slice(space + 1)); return { name, args: isObject(args) ? args : {} }; } catch { return { name, args: {} }; }
}
/** A tool's result without the tool's name in front. */
export const output = (text: string) => text.slice(text.indexOf(': ') + 2);
/** How long a reply took, as 42s or 3m 05s. */
export function took(from: string, to: string) {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
