import { writeFileSync } from 'node:fs';

/** Stands in for `pi --mode rpc` with pi-optchat: the same records on stdin and stdout, scripted by the profile's name and the
 * prompt's words, so the server's tests need no model. A prompt holding "wait" stays mid-message until a `release` command or an
 * abort. It says it owns its profile, or with `--optchat-connect join` that it is a window on it. Profile `busy` fails as a
 * profile another Pi owns does on pi-optchat 0.11.8, as does joining profile `old`; profile `stuck` ignores the request to shut down. */
const profile = process.argv[process.argv.indexOf('--optchat-profile') + 1], joins = process.argv.includes('--optchat-connect');
const role = (completed = false) => write({ type: 'extension_ui_request', id: 'r', method: 'setStatus', statusKey: 'optchat.role',
  statusText: JSON.stringify(joins ? { role: 'window', profile, id: 'w1', owner: true, completed } : { role: 'owner', profile }) });
const write = (record: object) => process.stdout.write(`${JSON.stringify(record)}\n`);
const user = (text: string) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
let running = false, queued: string[] = [], finish: ((aborted: boolean) => void) | undefined;

function run(text: string) {
  running = true;
  write({ type: 'agent_start' });
  for (const type of ['message_start', 'message_end']) write({ type, message: user(text) });
  write({ type: 'message_start', message: { role: 'assistant', content: [] } });
  for (const delta of ['re', 'ply']) write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta } });
  finish = aborted => {
    finish = undefined;
    write({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }], stopReason: aborted ? 'aborted' : 'stop' } });
    write({ type: 'agent_end', messages: [] });
    const next = aborted ? undefined : queued.shift();
    if (next !== undefined) { run(next); return; }
    running = false;
    write({ type: 'agent_settled', aborted });
  };
  if (!text.includes('wait')) finish(false);
}
const commands: Record<string, (command: Record<string, unknown>) => unknown> = {
  get_state: () => ({ pid: process.pid, args: process.argv.slice(2), home: process.env.OPTCHAT_HOME, cwd: process.cwd() }),
  prompt: ({ message }) => {
    const text = String(message);
    if (text === '/complete') { role(true); return { disposition: 'handled' }; }
    if (running) { queued.push(text); write({ type: 'queue_update', steering: queued, followUp: [] }); return { disposition: 'queued' }; }
    run(text); return { disposition: 'started' };
  },
  release: () => { finish?.(false); },
  clear_queue: () => { const steering = queued; queued = []; return { steering, followUp: [] }; },
  abort: () => { finish?.(true); },
};

if (profile === 'busy' || profile === 'old' && joins) write({ type: 'extension_error', extensionPath: 'pi-optchat', event: 'session_start', error: `Profile already running: ${profile} · PID 1` });
else role();
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += String(chunk);
  for (let end: number; (end = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(end + 1)) {
    const command: Record<string, unknown> = JSON.parse(buffer.slice(0, end)), handler = commands[String(command.type)];
    if (handler) write({ id: command.id, type: 'response', command: command.type, success: true, data: handler(command) });
    else write({ id: command.id, type: 'response', command: command.type, success: false, error: `Unknown command: ${String(command.type)}` });
  }
});
process.stdin.on('end', () => {
  if (profile === 'stuck') { setInterval(() => {}, 1000); return; }
  writeFileSync('stopped-in-order', profile);
  process.exit(0);
});
