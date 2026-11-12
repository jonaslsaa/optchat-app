import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Stands in for `pi --mode rpc` with pi-optchat: the same records on stdin and stdout, scripted by the profile's name and the
 * prompt's words, so the server's tests and the UI's screenshots need no model.
 * - It says it owns its profile, or with `--optchat-connect join` that it is a window on it. An owner logs what is said to the
 *   profile's `main/`, as pi-optchat does; a window keeps its conversation to itself (`get_messages`), and writes a handoff
 *   when it is completed with `/complete`.
 * - A prompt holding "wait" stays mid-reply until a `release` command or an abort; "ask" asks a dialog first and replies with its
 *   answer; "crash" kills it without an answer. A message sent during a run waits in the queue it was sent to: one that steers
 *   is answered next, one for later after those.
 * - FAKE_PI_SCRIPT names a JSON file of longer replies (`Script`), for the screenshots: a prompt holding one of its words gets
 *   that word's turns and answer.
 * - Profile `busy` fails as a profile another Pi owns, `stuck` ignores the request to shut down, `mute` never answers a command,
 *   `bare` is a Pi without pi-optchat, `old` one whose pi-optchat is from before 0.11.9 and names no role, and in `noisy`
 *   another extension fails. */
const profile = process.argv[process.argv.indexOf('--optchat-profile') + 1], joins = process.argv[process.argv.indexOf('--optchat-connect') + 1] === 'join';
const write = (record: object) => process.stdout.write(`${JSON.stringify(record)}\n`);
const status = (statusKey: string, statusText: string) => write({ type: 'extension_ui_request', id: statusKey, method: 'setStatus', statusKey, statusText });
const role = (completed = false) => status('optchat.role', JSON.stringify(joins ? { role: 'window', profile, id: 'w1', connected: true, completed } : { role: 'owner', profile }));

export type Content = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };
interface Said { role: string; content: Content[]; timestamp: number; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string; customType?: string; display?: boolean }
const messages: Said[] = [];
let completed = false;
/** Replies by a word of the prompt: turns of the agent's work, each a reply with tool calls and what those print, and then its
 * answer. With `clock` the messages' times start there and go up a second a message, where they are otherwise the time it is.
 * `handoff` is what a window writes for the main chat when it is completed. */
export interface Script { clock?: number; handoff?: string; replies: Record<string, { turns: { content: Content[]; results: string[] }[]; answer: string }> }
const script: Script = process.env.FAKE_PI_SCRIPT ? JSON.parse(readFileSync(process.env.FAKE_PI_SCRIPT, 'utf8')) : { replies: {} };
/** Each message gets a later time than the one before, and by the real clock none that has not come yet: the server tells a
 * window's conversations apart by when they were said. */
let clock = script.clock ?? 0;
function now() {
  if (script.clock !== undefined) return clock += 1000;
  while (Date.now() <= clock); // Under a millisecond.
  return clock = Date.now();
}

/** The profile's log, as pi-optchat writes it: one entry for each thing a message said. */
const main = join(process.env.OPTCHAT_HOME ?? '.', 'profiles', profile, 'main');
let logged = existsSync(main) ? readdirSync(main).reduce((count, name) => count + readFileSync(join(main, name), 'utf8').split('\n').filter(Boolean).length, 0) : 0;
function log(message: Said) {
  const entries: [string, string][] = [];
  if (message.role === 'user') entries.push(['user', message.content.map(c => c.type === 'text' ? c.text : '').join('\n')]);
  if (message.role === 'toolResult') entries.push(['echo', `${message.toolName}: ${message.content.map(c => c.type === 'text' ? c.text : '').join('\n')}`]);
  if (message.role === 'assistant') {
    for (const c of message.content) if (c.type === 'text') entries.push(['talk', c.text]); else if (c.type === 'toolCall') entries.push(['tool', `${c.name} ${JSON.stringify(c.arguments)}`]);
    if (message.stopReason === 'aborted') entries.push(['echo', 'Agent aborted: No further details']);
  }
  mkdirSync(main, { recursive: true });
  for (const [kind, text] of entries) appendFileSync(join(main, 'fake.jsonl'), `${JSON.stringify({ i: logged++, kind, date: new Date(message.timestamp).toISOString(), text })}\n`);
}
function ended(message: Said) {
  write({ type: 'message_end', message });
  messages.push(message);
  if (!joins) log(message);
}
const user = (text: string) => { const message: Said = { role: 'user', content: [{ type: 'text', text }], timestamp: now() }; write({ type: 'message_start', message }); ended(message); };

let running = false, settled = Promise.resolve(), steering: string[] = [], followUp: string[] = [], release: ((held: { aborted: boolean; answer?: string }) => void) | undefined;
const held = () => new Promise<{ aborted: boolean; answer?: string }>(resolve => { release = held => { release = undefined; resolve(held); }; });

/** Streams a reply block by block, in the records real Pi writes in RPC mode (test/pi-turn.jsonl is a capture): a start, deltas
 * and the whole block at its end, each naming the block by `contentIndex` and none carrying the reply so far. `pause` holds it
 * before block `at` is finished. */
async function reply(content: Content[], stopReason: string, pause?: { at: number }) {
  const message: Said = { role: 'assistant', content: [], timestamp: now(), stopReason: 'pending' };
  write({ type: 'message_start', message });
  const update = (assistantMessageEvent: object) => write({ type: 'message_update', assistantMessageEvent });
  for (const [contentIndex, block] of content.entries()) {
    const text = block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : JSON.stringify(block.arguments);
    const kind = block.type === 'toolCall' ? 'toolcall' : block.type, half = Math.ceil(text.length / 2);
    update({ type: `${kind}_start`, contentIndex, ...block.type === 'toolCall' && { id: block.id, toolName: block.name } });
    update({ type: `${kind}_delta`, contentIndex, delta: text.slice(0, half) });
    if (pause?.at === contentIndex && (await held()).aborted) {
      ended({ ...message, content: content.slice(0, contentIndex), stopReason: 'aborted' });
      return true;
    }
    update({ type: `${kind}_delta`, contentIndex, delta: text.slice(half) });
    update(block.type === 'toolCall' ? { type: 'toolcall_end', contentIndex, toolCall: block } : { type: `${kind}_end`, contentIndex, content: text });
  }
  ended({ ...message, content, stopReason });
  return false;
}
function tool(call: Extract<Content, { type: 'toolCall' }>, output: string) {
  write({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.arguments });
  write({ type: 'tool_execution_update', toolCallId: call.id, toolName: call.name, args: call.arguments, partialResult: { content: [{ type: 'text', text: output.slice(0, 20) }] } });
  write({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result: { content: [{ type: 'text', text: output }] }, isError: false });
  const message: Said = { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: output }], timestamp: now() };
  write({ type: 'message_start', message }); ended(message);
}
async function run(text: string) {
  running = true;
  write({ type: 'agent_start' });
  user(text);
  let aborted = false, answer = 'reply';
  if (text.includes('ask')) {
    write({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Go on?', message: 'The agent wants to continue.' });
    const answered = await held();
    aborted = answered.aborted;
    answer = answered.answer ?? answer;
  }
  const scripted = Object.entries(script.replies).find(([word]) => text.includes(word))?.[1];
  // A run stopped at its dialog says nothing more.
  for (const { content, results } of aborted ? [] : scripted?.turns ?? []) {
    await reply(content, 'toolUse');
    content.filter(block => block.type === 'toolCall').forEach((call, at) => tool(call, results[at]));
  }
  if (!aborted) aborted = await reply([{ type: 'text', text: scripted?.answer ?? answer }], 'stop', text.includes('wait') ? { at: 0 } : undefined);
  write({ type: 'agent_end', messages: [] });
  const next = aborted ? undefined : steering.shift() ?? followUp.shift();
  if (next !== undefined) { write({ type: 'queue_update', steering, followUp }); return run(next); }
  running = false;
  write({ type: 'agent_settled', aborted });
}
/** /complete in a window, as pi-optchat does it: a request the chat does not show, which the agent answers with its handoff in
 * a run of its own. */
function handoff() {
  write({ type: 'agent_start' });
  const request: Said = { role: 'custom', customType: 'optchat-handoff-request', display: false, content: [{ type: 'text', text: '[OptChat] This connected conversation has ended.' }], timestamp: now() };
  write({ type: 'message_start', message: request }); ended(request);
  void reply([{ type: 'text', text: script.handoff ?? 'Goal: what was asked.\n\nDone: it was answered.\n\nOpen: nothing.' }], 'stop'); // It does not pause, so it is written by now.
  write({ type: 'agent_end', messages: [] });
  write({ type: 'agent_settled', aborted: false });
}
const commands: Record<string, (command: Record<string, unknown>) => unknown> = {
  get_state: () => ({ pid: process.pid, args: process.argv.slice(2), home: process.env.OPTCHAT_HOME, cwd: process.cwd() }),
  get_messages: () => ({ messages }),
  prompt: ({ message, streamingBehavior }) => {
    const text = String(message);
    if (text === '/complete') {
      // A reply being written is stopped first, and the handoff follows once that run has ended.
      const hand = () => { handoff(); role(completed = true); };
      if (running) { release?.({ aborted: true }); void settled.then(hand); } else hand();
      return { disposition: 'handled' };
    }
    if (completed) role(completed = false); // The next message begins a new conversation, and pi-optchat says so before the run.
    if (text.includes('crash')) { process.stderr.write('out of memory\n'); process.exit(3); }
    if (running) { (streamingBehavior === 'followUp' ? followUp : steering).push(text); write({ type: 'queue_update', steering, followUp }); return { disposition: 'queued' }; }
    settled = run(text); return { disposition: 'started' };
  },
  release: () => { release?.({ aborted: false }); },
  clear_queue: () => {
    const cleared = { steering, followUp };
    steering = []; followUp = [];
    write({ type: 'queue_update', steering, followUp });
    return cleared;
  },
  abort: () => { release?.({ aborted: true }); },
  extension_ui_response: ({ confirmed }) => { release?.({ aborted: false, answer: `confirmed: ${confirmed}` }); },
};

if (profile === 'busy') {
  status('optchat', 'OptChat: choose profile');
  write({ type: 'extension_error', extensionPath: 'pi-optchat', event: 'session_start', error: `Profile already running: ${profile} · PID 1 · a-terminal · /somewhere` });
} else if (profile !== 'bare') {
  if (profile === 'noisy') write({ type: 'extension_error', extensionPath: 'something-else', event: 'session_start', error: 'No API key' });
  status('optchat', joins ? `OptChat: ${profile} · connected window` : `OptChat: ${profile} · ${logged} messages · 0 pending · 0 agents`);
  if (profile !== 'old') role();
}
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += String(chunk);
  for (let end: number; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
    const command: Record<string, unknown> = JSON.parse(buffer.slice(0, end)), handler = commands[String(command.type)];
    if (profile === 'mute') continue;
    if (command.type === 'extension_ui_response') handler(command);
    else if (handler) write({ id: command.id, type: 'response', command: command.type, success: true, data: handler(command) });
    else write({ id: command.id, type: 'response', command: command.type, success: false, error: `Unknown command: ${String(command.type)}` });
  }
});
process.stdin.on('end', () => {
  if (profile === 'stuck') { setInterval(() => {}, 1000); return; }
  appendFileSync('stopped-in-order', `${profile} ${joins ? 'window' : 'owner'}\n`);
  process.exit(0);
});
