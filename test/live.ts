import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import type { PiRecord, Push, Result, Setup } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { PROMPT } from '../src/server/windows.ts';
import { transcript } from '../src/ui/agents.ts';
import { apply, chat, idle, isMessage, isObject, logged, parts, words, type Part } from '../src/ui/transcript.ts';
import { current } from '../src/window.ts';
import { createProfile, temporaryHome } from './support.ts';

/** `npm run test:live`: real turns through the installed Pi with pi-optchat, on throwaway profiles. It needs Pi logged in to
 * Anthropic and costs about a cent. Pi keeps no session file, and the real ~/.optchat is never opened.
 * `PI_OPTCHAT=<a pi-optchat checkout>` runs that pi-optchat in place of the one installed in Pi. */
const checkout = process.env.PI_OPTCHAT;
const flags = [...checkout ? ['--no-extensions', '-e', join(checkout, 'src/index.ts')] : [], '--no-session', '--model', 'anthropic/claude-haiku-5-5', '--thinking', 'off'];
/** Pi's records as they are pushed, and a wait for one. */
function watch() {
  const pushes: Push[] = [], waiting = new Set<() => void>();
  const record = (window: string, match: (record: PiRecord) => boolean, after = 0) => new Promise<Extract<Push, { push: 'record' }>>(resolve => {
    const check = () => {
      const found = pushes.find(push => push.push === 'record' && push.window === window && push.seq > after && match(push.record));
      if (found?.push === 'record') { waiting.delete(check); resolve(found); }
    };
    waiting.add(check); check();
  });
  return { pushes, record, onPush: (push: Push) => { pushes.push(push); for (const check of waiting) check(); } };
}
const said = (record: PiRecord, role: string) => record.type === 'message_end' && JSON.stringify(record.message).startsWith(`{"role":"${role}"`);

test('a real Pi turn on a throwaway profile, end to end through the WebSocket', { timeout: 120_000 }, async t => {
  const home = temporaryHome(), profile = createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags });
  t.after(() => server.close());
  assert.deepEqual(await (await connect(server.url)).request('history', { profile: 'live' }), { total: 0, messages: [] });

  const pushes: Push[] = [];
  let settled = () => {};
  const done = new Promise<void>(resolve => { settled = resolve; });
  const client = await connect(server.url, push => { pushes.push(push); if (push.push === 'record' && push.record.type === 'agent_settled') settled(); });
  const { window } = await client.request('open', { profile: 'live' });
  assert.equal(existsSync(join(profile, 'lock.sock')), false, 'no Pi holds the profile before the first prompt');
  assert.deepEqual(await client.request('prompt', { window: window.id, text: 'Reply with exactly this word and nothing else: pong' }), { disposition: 'started' });
  await done;

  // Pi's own records came through: pi-optchat opened the profile, and the reply streamed and ended.
  const records = pushes.flatMap(push => push.push === 'record' ? [push.record] : []);
  assert.ok(records.some(r => r.type === 'extension_ui_request' && r.method === 'setStatus' && String(r.statusText).startsWith('OptChat: live')));
  assert.ok(records.some(r => r.type === 'message_update'));
  assert.ok(records.some(r => r.type === 'message_end' && /"role":"assistant".*pong/.test(JSON.stringify(r))));
  assert.deepEqual(pushes.flatMap(push => push.push === 'window' ? [push.window.status] : []).filter((status, k, all) => status !== all[k - 1]), ['stopped', 'starting', 'idle', 'running', 'idle']);

  // The turn is in the profile's memory, written by Pi and read by the app from disk.
  const { messages } = await client.request('history', { profile: 'live' });
  assert.deepEqual(messages.map(m => [m.kind, m.text]), [['user', 'Reply with exactly this word and nothing else: pong'], ['talk', 'pong']]);
  // The UI shows a run from Pi's records until it is logged: both must read the same, down to the dates the two are joined by.
  // And the reply is there while Pi still writes it: its text shows before the message has ended.
  const pushed = pushes.flatMap(push => push.push === 'record' ? [push] : []);
  const ending = pushed.findIndex(push => said(push.record, 'assistant'));
  const writing = pushed.slice(0, ending).reduce((live, push) => apply(live, push.record, push.seq), idle());
  assert.partialDeepStrictEqual(chat([], writing).at(-1), { kind: 'talk', text: 'pong', streaming: true });
  const run = pushed.reduce((live, push) => apply(live, push.record, push.seq), idle());
  assert.deepEqual(chat([], run).map(({ kind, text, date }) => ({ kind, text, date })), messages.map(({ kind, text, date }) => ({ kind, text, date })));
  assert.equal(chat(logged(messages), run).length, messages.length);
  // The memory view of that turn, as Pi's files have it: a line for each message, and under a line the message as it was said.
  const view = await client.request('view', { profile: 'live' });
  assert.deepEqual(view.lines, messages.map(({ i, kind, text, date }) => ({ id: i, n: 1, text: `${kind}: ${text}`, from: date, to: date })));
  assert.ok(view.total === 2 && view.size > 0 && view.size < view.budget);
  assert.deepEqual((await client.request('original', { profile: 'live', id: 1 })).messages, [messages[1]]);

  // A second client finds the window and its run; closing the server lets Pi release the profile.
  const second = await connect(server.url);
  assert.partialDeepStrictEqual((await second.request('windows', {})).windows, [{ id: 'live/main', status: 'idle' }]);
  assert.equal((await second.request('records', { window: window.id })).records[0].record.type, 'agent_start');
  assert.equal(existsSync(join(profile, 'lock.sock')), true);
  await server.close();
  assert.equal(existsSync(join(profile, 'lock.sock')), false);
});

test('a connected window reads the profile\'s memory, and Complete hands its conversation to the main chat', { timeout: 180_000 }, async t => {
  const home = temporaryHome(), sent = process.env.OPTCHAT_APP_SENT = join(home, 'sent.jsonl');
  createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), flags: [...flags, '-e', join(import.meta.dirname, 'sent.ts')] });
  t.after(() => server.close());
  const { pushes, record, onPush } = watch(), client = await connect(server.url, onPush);
  const main = (await client.request('open', { profile: 'live' })).window.id;
  await client.request('prompt', { window: main, text: 'Remember: the secret word is "marzipan". Reply with exactly: noted' });
  await record(main, r => r.type === 'agent_settled');

  // A second Pi on the profile: it joins the first, and answers from the memory the main chat just wrote.
  const { window } = await client.request('open', { profile: 'live', role: 'connected' });
  await client.request('prompt', { window: window.id, text: 'What is the secret word from the main chat? Reply with just the word.' });
  assert.match(JSON.stringify((await record(window.id, r => said(r, 'assistant'))).record), /marzipan/);
  await record(window.id, r => r.type === 'agent_settled');
  const [connected] = (await client.request('windows', {})).windows.filter(w => w.id === window.id);
  assert.partialDeepStrictEqual(connected, { role: 'connected', status: 'idle' });
  // What the app asks of its agents is in the prompt the model was sent, beside pi-optchat's own: in both windows, every time.
  const requests = readFileSync(sent, 'utf8').trim().split('\n').map((line): { window: boolean; payload: { system?: unknown } } => JSON.parse(line));
  for (const [inWindow, optchat] of [[false, 'You are OptChat'], [true, 'You are a connected window of OptChat']] as const) {
    const prompts = requests.filter(request => request.window === inWindow).map(request => JSON.stringify(request.payload.system));
    assert.ok(prompts.length > 0 && prompts.every(prompt => prompt.includes(optchat) && prompt.includes(`<addendum>\\n${PROMPT}\\n</addendum>`)), `${optchat}: ${prompts[0]?.slice(0, 200)}`);
  }

  // Complete: the window writes its handoff, and the main chat gets it as that agent's report, in its memory.
  await client.request('complete', { window: window.id });
  assert.ok(pushes.some(push => push.push === 'window' && push.window.id === window.id && push.window.completed));
  const handoff = /\[[0-9a-f]{8}\] Connected conversation completed by user\./;
  const report = await record(main, r => said(r, 'custom') && handoff.test(JSON.stringify(r.message)));
  await record(main, r => r.type === 'agent_settled', report.seq);
  const { messages } = await client.request('history', { profile: 'live' });
  assert.ok(messages.some(m => m.kind === 'work' && handoff.test(m.text)), 'the handoff is in the profile\'s log');

  // The window is not spent: its next prompt begins a new conversation in the same Pi, which says so in its role.
  const again = (await client.request('windows', {})).windows.find(w => w.id === window.id)!.seq;
  await client.request('prompt', { window: window.id, text: 'Reply with exactly: here' });
  await record(window.id, r => r.type === 'agent_settled', again);
  const after = (await client.request('windows', {})).windows.find(w => w.id === window.id)!;
  assert.deepEqual([after.completed, after.status], [undefined, 'idle']);
  // Its Pi still has the conversation that was handed off; the window's is what came since.
  const kept = (await client.request('command', { window: window.id, command: { type: 'get_messages' } })).data;
  assert.ok(isObject(kept) && Array.isArray(kept.messages) && kept.messages.every(isMessage));
  assert.ok(kept.messages.some(message => /marzipan/.test(JSON.stringify(message))));
  assert.deepEqual(current(after, kept.messages).map(message => [message.role, words(message.content)]), [['user', 'Reply with exactly: here'], ['assistant', 'here']]);
});

test('an agent the main chat starts is listed while it works and once it has reported, with its chat', { timeout: 180_000 }, async t => {
  const home = temporaryHome(), cwd = mkdtempSync(join(home, 'cwd-'));
  createProfile(home, 'live');
  writeFileSync(join(cwd, 'notes.txt'), 'the answer is 42\n');
  const server = await startServer({ home, cwd, flags });
  t.after(() => server.close());
  const client = await connect(server.url);
  const { window } = await client.request('open', { profile: 'live' });
  const task = 'Run `sleep 4` with bash, then read notes.txt, and report the answer in it.';
  await client.request('prompt', { window: window.id, text: `Use spawn to start ONE subagent titled "Read the notes" with exactly this task: "${task}" Then say only: started.` });

  // The list is read from the profile's files, again and again, as the page does: the agent is there at work, then done.
  const seen: Result<'agents'>['agents'] = [];
  while (seen.at(-1)?.state !== 'completed') {
    await new Promise(resolve => setTimeout(resolve, 250));
    const { agents } = await client.request('agents', { profile: 'live' });
    assert.ok(agents.length <= 1);
    if (agents[0] && JSON.stringify(agents[0]) !== JSON.stringify(seen.at(-1))) seen.push(agents[0]);
  }
  const { id } = seen[0], last = seen.at(-1)!;
  assert.deepEqual(seen.map(agent => agent.state).filter((state, k, all) => state !== all[k - 1]), ['running', 'completed']);
  assert.partialDeepStrictEqual(last, { id, title: 'Read the notes', task, doing: [] });
  assert.match(last.headline ?? '', /42/);
  // While it worked, the list said on what: the tool calls it was waiting on.
  assert.ok(seen.some(agent => agent.doing.some(call => call.name === 'bash' && call.args.command === 'sleep 4')), JSON.stringify(seen.map(agent => agent.doing)));

  // Its chat is its Pi session: the task alone first, its tool calls, and its last answer, which is what it reported.
  const { messages, report } = await client.request('agent', { profile: 'live', id });
  const own = messages.filter(isMessage);
  assert.partialDeepStrictEqual(own[0], { role: 'user', content: task });
  assert.ok(own.some(message => message.role === 'toolResult' && message.toolName === 'read' && words(message.content).includes('the answer is 42')));
  assert.equal(words(own.at(-1)?.content), report);
  assert.deepEqual(transcript({ messages: own, report }, true).at(-1)?.kind, 'talk');

  // And the main chat got the report, named by the agent and its title: the card that opens this chat.
  let reports: Part[] = [];
  while (!reports.length) {
    await new Promise(resolve => setTimeout(resolve, 250));
    reports = parts(logged((await client.request('history', { profile: 'live' })).messages)).filter(part => part.type === 'work');
  }
  assert.partialDeepStrictEqual(reports, [{ agent: id, title: 'Read the notes', body: report }]);
});

test('the app installs Pi into its own folder, that Pi runs a chat, and it installs pi-optchat with Pi\'s own installer', { timeout: 240_000 }, async t => {
  const home = temporaryHome(), app = mkdtempSync(join(home, 'app-')), nowhere = { command: join(home, 'no-such-pi'), args: [] };
  createProfile(home, 'live');
  /** A server on a machine without Pi, and a wait for the install it runs to end. */
  async function machine() {
    const { pushes, record, onPush } = watch(), waiting = new Set<() => void>();
    const server = await startServer({ home, app, cwd: mkdtempSync(join(home, 'cwd-')), pi: nowhere, flags });
    const client = await connect(server.url, push => { onPush(push); for (const check of waiting) check(); });
    const installed = () => new Promise<Setup>(resolve => {
      const check = () => { const last = pushes.findLast(push => push.push === 'setup'); if (last?.push === 'setup' && last.setup.job && last.setup.job.state !== 'running') { waiting.delete(check); resolve(last.setup); } };
      waiting.add(check); check();
    });
    return { server, client, record, installed };
  }

  // No Pi: the app installs one with npm, into its own folder and nowhere else.
  const first = await machine();
  t.after(() => first.server.close());
  assert.equal((await first.client.request('setup', {})).pi.state, 'missing');
  await first.client.request('install', { what: 'pi' });
  const { pi, job } = await first.installed();
  assert.deepEqual([job?.state, job?.output], ['done', undefined]);
  assert.partialDeepStrictEqual(pi, { state: 'ok', path: join(app, 'pi', 'node_modules', '.bin', 'pi'), shell: `export PATH=${join(app, 'pi', 'node_modules', '.bin')}:"$PATH"` });
  // It was installed without running its packages' install scripts. It still runs a turn, with a tool, through pi-optchat
  // (the one in your Pi's settings, which this Pi reads too).
  const { window } = await first.client.request('open', { profile: 'live' });
  await first.client.request('prompt', { window: window.id, text: 'Use the bash tool to run: echo hello-from-the-app. Then reply with exactly what it printed.' });
  await first.record(window.id, r => r.type === 'agent_settled');
  const { messages } = await first.client.request('history', { profile: 'live' });
  assert.match(messages.find(m => m.kind === 'echo')?.text ?? '', /^bash: hello-from-the-app/);
  assert.partialDeepStrictEqual(messages.at(-1), { kind: 'talk' });
  await first.server.close();

  // A Pi with nothing in it (its own folder is a throwaway one): no pi-optchat, no login. The app installs pi-optchat.
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(home, 'agent-'));
  t.after(() => { delete process.env.PI_CODING_AGENT_DIR; });
  const second = await machine();
  t.after(() => second.server.close());
  assert.partialDeepStrictEqual(await second.client.request('setup', {}), { pi: { state: 'ok' }, optchat: { state: 'missing', installable: true }, login: { state: 'missing', providers: [] } });
  await second.client.request('install', { what: 'optchat' });
  const done = await second.installed();
  assert.partialDeepStrictEqual(done, { optchat: { state: 'ok' }, job: { what: 'optchat', state: 'done' } });
  assert.ok(done.optchat.path?.startsWith(process.env.PI_CODING_AGENT_DIR));
});
