import type { Message, PiRecord } from '../protocol.ts';

/** What the chat shows, and how it gets there. The chat is the profile's log: every item is a log entry, or what a message Pi
 * has not logged yet will be logged as, so a reply looks the same while it streams, after it is logged, and a year later.
 * Nothing here touches the DOM. */

/** A message as Pi writes it in its records (its docs: message-types.md), read only as far as the chat needs. */
export interface PiMessage { role: string; timestamp: number; content?: unknown; stopReason?: string; errorMessage?: string; toolName?: string; display?: boolean }

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
  /** The reply being written, as far as it has got. */
  streaming?: PiMessage;
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
    case 'message_start': return isMessage(record.message) && record.message.role === 'assistant' ? { ...next, streaming: record.message } : next;
    // Each streaming event carries the whole reply so far (`partial`), so there are no deltas to add up.
    case 'message_update': return isObject(record.assistantMessageEvent) && isMessage(record.assistantMessageEvent.partial) ? { ...next, streaming: record.assistantMessageEvent.partial } : next;
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
function shown(live: Live, record: PiRecord): Live {
  const { method, statusKey, statusText } = record;
  if (method === 'setStatus' && typeof statusKey === 'string') {
    const { [statusKey]: _, ...status } = live.status;
    return { ...live, status: typeof statusText === 'string' ? { ...status, [statusKey]: statusText } : status };
  }
  return method === 'select' || method === 'confirm' || method === 'input' || method === 'editor' ? { ...live, dialogs: [...live.dialogs.filter(d => d.id !== record.id), record] } : live;
}
/** A window's state from what `records` answered: what stands, then the latest run. */
export function replay({ ui, records }: { ui: PiRecord[]; records: { seq: number; record: PiRecord }[] }, seq: number): Live {
  const live = records.reduce((live, { seq, record }) => apply(live, record, seq), ui.reduce((live, record) => apply(live, record), idle()));
  return { ...live, seq: Math.max(seq, live.seq) };
}

const date = (message: PiMessage) => new Date(message.timestamp).toISOString();
/** What pi-optchat logs a message as (its `said`): your words as `user`, a reply's text as `talk` and its tool calls as `tool`,
 * a tool's result and a failed reply as `echo`, and what OptChat itself puts in the chat (a subagent's report) as `work`. */
export function said(message: PiMessage, streaming = false): Item[] {
  const at = date(message), items: Item[] = [];
  const add = (kind: Item['kind'], text: string, call?: string) => items.push({ key: '', kind, text, date: at, ...streaming && { streaming }, ...call && { call } });
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
  return items;
}
/** What the reply being written is thinking now: its last block, if that is thought. */
export function thinking({ streaming }: Live) {
  const last: unknown = Array.isArray(streaming?.content) ? streaming.content.at(-1) : undefined;
  return isObject(last) && last.type === 'thinking' && typeof last.thinking === 'string' ? last.thinking : undefined;
}

/** The chat: what is logged, then what the latest run said that is not logged yet. pi-optchat dates an entry with its message's
 * time and logs a run in order, so a message is logged once the log has an entry of its time, and so is everything before it. */
export function chat(logged: readonly Item[], live: Live): Item[] {
  const dates = new Set(logged.map(item => item.date));
  const fresh = live.messages.slice(live.messages.findLastIndex(message => dates.has(date(message))) + 1);
  const seen = new Map<string, number>();
  return [...logged, ...fresh.flatMap(message => said(message)), ...live.streaming ? said(live.streaming, true) : []].map(item => {
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
