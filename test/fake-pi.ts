import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Stands in for `pi --mode rpc` with pi-optchat: the same records on stdin and stdout, scripted by the profile's name and the
 * prompt's words, so the server's tests and the UI's screenshots need no model.
 * - It says it owns its profile, or with `--optchat-connect join` that it is a window on it. An owner logs what is said to the
 *   profile's `main/`, as pi-optchat does; a window keeps its conversation to itself (`get_messages`).
 * - A prompt holding "wait" stays mid-reply until a `release` command or an abort; "ask" asks a dialog first and replies with its
 *   answer; "demo" thinks, runs two tools and answers in Markdown; "crash" kills it without an answer.
 * - Profile `busy` fails as a profile another Pi owns, `stuck` ignores the request to shut down, `mute` never answers a command,
 *   `bare` is a Pi without pi-optchat, and in `noisy` another extension fails. */
const profile = process.argv[process.argv.indexOf('--optchat-profile') + 1], joins = process.argv[process.argv.indexOf('--optchat-connect') + 1] === 'join';
const write = (record: object) => process.stdout.write(`${JSON.stringify(record)}\n`);
const status = (statusKey: string, statusText: string) => write({ type: 'extension_ui_request', id: statusKey, method: 'setStatus', statusKey, statusText });
const role = (completed = false) => status('optchat.role', JSON.stringify(joins ? { role: 'window', profile, id: 'w1', connected: true, completed } : { role: 'owner', profile }));

type Content = { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };
interface Said { role: string; content: Content[]; timestamp: number; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string }
const messages: Said[] = [];
/** Each message gets a later time than the one before. With FAKE_PI_CLOCK the times start there and go up a second a message,
 * so that screenshots come out the same every time. */
const fixed = process.env.FAKE_PI_CLOCK !== undefined;
let clock = Number(process.env.FAKE_PI_CLOCK ?? 0);
const now = () => clock = fixed ? clock + 1000 : Math.max(Date.now(), clock + 1);

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

let running = false, queued: string[] = [], release: ((held: { aborted: boolean; answer?: string }) => void) | undefined;
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
const ANSWER = `## What I found

The working tree is clean apart from **two files**, and the README describes the layout the UI follows:

- \`src/server\` runs each window as one \`pi --mode rpc\` process
- \`src/ui\` is the page you are looking at
- the profile's memory is read from disk, so history shows without Pi running

\`\`\`ts
const { window } = await client.request('open', { profile: 'work' });
await client.request('prompt', { window: window.id, text: 'hello' });
\`\`\`

| Piece | State |
| --- | --- |
| Server | merged |
| UI | this slice |

Next I would wire the agents panel.`;

async function run(text: string) {
  running = true;
  write({ type: 'agent_start' });
  user(text);
  let aborted = false, answer = 'reply';
  if (text.includes('ask')) {
    write({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Go on?', message: 'The agent wants to continue.' });
    answer = (await held()).answer ?? answer;
  }
  if (text.includes('demo')) {
    const calls: Extract<Content, { type: 'toolCall' }>[] = [
      { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'git status --short' } },
      { type: 'toolCall', id: 'call-2', name: 'read', arguments: { path: 'README.md' } },
    ];
    await reply([{ type: 'thinking', thinking: 'The user wants an overview. I should look at the repository before answering.' }, { type: 'text', text: 'I\'ll look at the repository first.' }, ...calls], 'toolUse');
    tool(calls[0], ' M src/server/windows.ts\n?? src/ui/\n');
    tool(calls[1], '# OptChat app\n\nA desktop app for pi-optchat: one chat per profile that never ends.\n');
    answer = ANSWER;
  }
  aborted = await reply([{ type: 'text', text: answer }], 'stop', text.includes('wait') ? { at: 0 } : undefined);
  write({ type: 'agent_end', messages: [] });
  const next = aborted ? undefined : queued.shift();
  if (next !== undefined) { write({ type: 'queue_update', steering: queued, followUp: [] }); return run(next); }
  running = false;
  write({ type: 'agent_settled', aborted });
}
const commands: Record<string, (command: Record<string, unknown>) => unknown> = {
  get_state: () => ({ pid: process.pid, args: process.argv.slice(2), home: process.env.OPTCHAT_HOME, cwd: process.cwd() }),
  get_messages: () => ({ messages }),
  prompt: ({ message }) => {
    const text = String(message);
    if (text === '/complete') { role(true); return { disposition: 'handled' }; }
    if (text.includes('crash')) { process.stderr.write('out of memory\n'); process.exit(3); }
    if (running) { queued.push(text); write({ type: 'queue_update', steering: queued, followUp: [] }); return { disposition: 'queued' }; }
    void run(text); return { disposition: 'started' };
  },
  release: () => { release?.({ aborted: false }); },
  clear_queue: () => { const steering = queued; queued = []; write({ type: 'queue_update', steering: [], followUp: [] }); return { steering, followUp: [] }; },
  abort: () => { release?.({ aborted: true }); },
  extension_ui_response: ({ confirmed }) => { release?.({ aborted: false, answer: `confirmed: ${confirmed}` }); },
};

if (profile === 'busy') {
  status('optchat', 'OptChat: choose profile');
  write({ type: 'extension_error', extensionPath: 'pi-optchat', event: 'session_start', error: `Profile already running: ${profile} · PID 1 · a-terminal · /somewhere` });
} else if (profile !== 'bare') {
  if (profile === 'noisy') write({ type: 'extension_error', extensionPath: 'something-else', event: 'session_start', error: 'No API key' });
  status('optchat', joins ? `OptChat: ${profile} · connected window` : `OptChat: ${profile} · ${logged} messages · 0 pending · 0 agents`);
  role();
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
