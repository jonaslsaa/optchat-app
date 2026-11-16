import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { WebSocket } from 'ws';
import { connect } from '../src/client.ts';
import type { Push, WindowState } from '../src/protocol.ts';
import { startServer, type ServerOptions } from '../src/server/server.ts';
import { isMessage, isObject } from '../src/ui/transcript.ts';
import { canComplete, current } from '../src/window.ts';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();
for (const name of ['work', 'busy', 'stuck', 'mute', 'bare', 'old', 'noisy']) createProfile(home, name);
const fake = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };

/** A server over the fake Pi, and a client that remembers what it was pushed. */
async function setup(t: TestContext, options: Partial<ServerOptions> = {}) {
  const cwd = mkdtempSync(join(home, 'cwd-'));
  const server = await startServer({ home, cwd, pi: fake, ...options });
  t.after(() => server.close());
  return { server, cwd, ...await client(t, server.url) };
}
async function client(t: TestContext, url: string) {
  const pushes: Push[] = [], waiting = new Set<() => void>();
  const connection = await connect(url, push => { pushes.push(push); for (const check of waiting) check(); });
  t.after(() => connection.close());
  /** Resolves once a push matches. */
  const pushed = <P extends Push>(match: (push: Push) => push is P) => new Promise<P>(resolve => {
    const check = () => { const found = pushes.find(match); if (found) { waiting.delete(check); resolve(found); } };
    waiting.add(check); check();
  });
  const types = () => pushes.flatMap(push => push.push === 'record' ? [push.record.type] : []);
  /** The statuses a window went through; a push that changed something else repeats none. */
  const statuses = (id: string) => pushes.flatMap(push => push.push === 'window' && push.window.id === id ? [push.window.status] : []).filter((status, k, all) => status !== all[k - 1]);
  const record = (type: string, from = 0) => pushed((push): push is Extract<Push, { push: 'record' }> => push.push === 'record' && push.record.type === type && push.seq > from);
  const status = (status: WindowState['status']) => pushed((push): push is Extract<Push, { push: 'window' }> => push.push === 'window' && push.window.status === status);
  /** The window as it is once it pushed record `seq`. A record that changes the window's status is pushed first and the
   * window after it, in a message of its own, so the record alone does not say the status has come. */
  const since = (seq: number) => pushed((push): push is Extract<Push, { push: 'window' }> => push.push === 'window' && push.window.seq >= seq);
  return { request: connection.request, pushes, types, statuses, record, status, since };
}

test('a window starts its Pi on the first prompt, and what Pi writes reaches the client in order', async t => {
  const { request, cwd, pushes, types, statuses, record, since } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  assert.deepEqual(window, { id: 'work/main', profile: 'work', role: 'main', cwd, status: 'stopped', seq: 0 });
  await assert.rejects(request('command', { window: window.id, command: { type: 'get_state' } }), /no Pi running/);

  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
  await since((await record('agent_settled')).seq);
  assert.deepEqual(statuses(window.id), ['stopped', 'starting', 'idle', 'running', 'idle']);
  assert.deepEqual(types(), ['extension_ui_request', 'extension_ui_request', 'agent_start', 'message_start', 'message_end', 'message_start', 'message_update', 'message_update', 'message_update', 'message_update', 'message_end', 'agent_end', 'agent_settled']);
  const numbers = pushes.flatMap(push => push.push === 'record' ? [push.seq] : []);
  assert.deepEqual(numbers, numbers.map((_, k) => k + 1));

  // Pi got the profile, the app's OPTCHAT_HOME and the window's directory. A second open is the same window, and the same Pi.
  const { data } = await request('command', { window: window.id, command: { type: 'get_state' } });
  assert.partialDeepStrictEqual(data, { args: ['--optchat-profile', 'work', '--optchat-connect', 'off', '--mode', 'rpc'], home, cwd });
  assert.equal((await request('open', { profile: 'work' })).window.id, window.id);
  assert.equal((await request('windows', {})).windows.length, 1);
});

test('a client that connects in the middle of a run catches up from the records the window kept', async t => {
  const { server, request, record } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'wait for me' });
  const streaming = await record('message_update');

  const late = await client(t, server.url);
  assert.partialDeepStrictEqual((await late.request('windows', {})).windows[0], { id: window.id, status: 'running' });
  const kept = await late.request('records', { window: window.id });
  assert.deepEqual(kept.records.map(r => r.record.type), ['agent_start', 'message_start', 'message_end', 'message_start', 'message_update', 'message_update']);
  assert.equal(kept.records.at(-1)?.seq, streaming.seq + 1);

  // The finished message says all its updates did, so they are dropped; a client asks only for what it has not seen.
  await request('command', { window: window.id, command: { type: 'release' } });
  await late.record('agent_settled');
  const after = await late.request('records', { window: window.id, after: streaming.seq + 1 });
  assert.equal(after.complete, true);
  assert.deepEqual(after.records.map(r => r.record.type), ['message_end', 'agent_end', 'agent_settled']);
  assert.equal((await late.request('records', { window: window.id })).records.some(r => r.record.type === 'message_update'), false);

  // The next run starts the kept records over: the settled run is in the profile's history now.
  const settled = (await request('windows', {})).windows[0].seq;
  await request('prompt', { window: window.id, text: 'again' });
  await record('agent_settled', settled);
  const next = await late.request('records', { window: window.id, after: streaming.seq });
  assert.equal(next.complete, false);
  assert.equal(next.records[0].record.type, 'agent_start');
  assert.equal(next.records[0].seq, settled + 1);
});

test('what Pi shows stands for a client that connects late: a status from before the run, and a dialog until it is answered', async t => {
  const { server, request, record } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'ask me' });
  await record('agent_start');

  const late = await client(t, server.url), shown = async () => (await late.request('records', { window: window.id })).ui.map(r => r.method);
  assert.equal((await late.request('records', { window: window.id })).records.some(r => r.record.method === 'setStatus'), false);
  assert.deepEqual(await shown(), ['setStatus', 'setStatus', 'confirm']);
  await late.request('answer', { window: window.id, id: 'dialog-1', confirmed: true });
  assert.match(JSON.stringify((await record('message_end', (await record('agent_start')).seq + 2)).record), /confirmed: true/);
  assert.deepEqual(await shown(), ['setStatus', 'setStatus']);
});

test('two prompts to a stopped window share one start', async t => {
  const { request, types } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  const answers = await Promise.all(['wait for me', 'and then this'].map(text => request('prompt', { window: window.id, text })));
  assert.deepEqual(answers.map(answer => answer.disposition), ['started', 'queued']);
  assert.equal(types().filter(type => type === 'extension_ui_request').length, 2, 'one Pi showed its status and its role');
});

test('a Pi that dies in a run leaves its window stopped with the reason, and the prompt it had not answered fails', async t => {
  const { request } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'wait for me' });
  await assert.rejects(request('prompt', { window: window.id, text: 'crash' }), /Pi exited \(code 3\)/);
  const [stopped] = (await request('windows', {})).windows;
  assert.partialDeepStrictEqual(stopped, { status: 'stopped' });
  assert.match(stopped.error ?? '', /Pi exited \(code 3\)/);
  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
});

test('a main window closed while its start is still finding its Pi starts none, and starts on the next prompt', async t => {
  const { request, statuses } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  // The first prompt on a server looks for Pi, which takes a moment: the close comes in the middle of that.
  const prompt = request('prompt', { window: window.id, text: 'hello' });
  await request('close', { window: window.id });
  await assert.rejects(prompt, /was closed before it started/);
  assert.deepEqual(statuses(window.id), ['stopped']);
  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
});

test('a connected window closed while its start is still finding out who holds the profile starts no Pi, not the main window\'s either', async t => {
  const { request, statuses } = await setup(t);
  const { window } = await request('open', { profile: 'work', role: 'connected' });
  const prompt = request('prompt', { window: window.id, text: 'hello' });
  await request('close', { window: window.id });
  await assert.rejects(prompt, /was closed before it started/);
  assert.deepEqual(statuses('work/main'), ['stopped']);
});

test('a Pi that never answers its start can still be closed', async t => {
  const { request, status } = await setup(t);
  const { window } = await request('open', { profile: 'mute' });
  const prompt = assert.rejects(request('prompt', { window: window.id, text: 'hello' }), /Pi exited/);
  await status('starting');
  await request('close', { window: window.id });
  await prompt;
  assert.equal((await request('windows', {})).windows[0].status, 'stopped');
});

test('a Pi that could not open the profile is stopped, and the prompt fails with its reason', async t => {
  const { request, status } = await setup(t);
  const { window } = await request('open', { profile: 'busy' });
  await assert.rejects(request('prompt', { window: window.id, text: 'hello' }), /Profile already running: busy/);
  assert.partialDeepStrictEqual((await status('stopped')).window, { id: 'busy/main' });
  assert.partialDeepStrictEqual((await request('windows', {})).windows[0], { status: 'stopped', error: 'Profile already running: busy · PID 1 · a-terminal · /somewhere' });

  // A Pi without pi-optchat opens no profile either, and nor does one whose pi-optchat shows its status line but names no role.
  // Another extension's failure is not pi-optchat's.
  for (const profile of ['bare', 'old']) await assert.rejects(request('prompt', { window: (await request('open', { profile })).window.id, text: 'hello' }), /pi-optchat did not open the profile. Is pi-optchat 0.11.13 or newer installed/);
  assert.deepEqual(await request('prompt', { window: (await request('open', { profile: 'noisy' })).window.id, text: 'hello' }), { disposition: 'started' });
});

test('a message sent during a run is queued, and abort hands back what was still queued', async t => {
  const { request, record } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'wait for me' });
  // One for after the run, then one that steers: each waits in the queue it was sent to.
  assert.deepEqual(await request('prompt', { window: window.id, text: 'later', whenBusy: 'followUp' }), { disposition: 'queued' });
  assert.deepEqual(await request('prompt', { window: window.id, text: 'and then this' }), { disposition: 'queued' });
  assert.deepEqual((await record('queue_update', (await record('queue_update')).seq)).record, { type: 'queue_update', steering: ['and then this'], followUp: ['later'] });
  assert.deepEqual(await request('abort', { window: window.id }), { steering: ['and then this'], followUp: ['later'] });
  assert.equal((await record('agent_settled')).record.aborted, true);
  assert.equal((await request('windows', {})).windows[0].status, 'idle');
});

test('a connected window starts the profile\'s owner first, joins it, and Complete hands it off', async t => {
  const { request, status, record } = await setup(t);
  const { window } = await request('open', { profile: 'work', role: 'connected' });
  const windows = async () => (await request('windows', {})).windows.map(({ id, role, status, completed }) => ({ id, role, status, completed }));
  assert.deepEqual(await windows(), [{ id: 'work/1', role: 'connected', status: 'stopped', completed: undefined }]);
  await assert.rejects(request('complete', { window: window.id }), /none to hand off/); // It has said nothing yet.
  await request('prompt', { window: window.id, text: 'hello' });
  const state = async (id: string) => (await request('command', { window: id, command: { type: 'get_state' } })).data;
  assert.partialDeepStrictEqual(await state('work/main'), { args: ['--optchat-profile', 'work', '--optchat-connect', 'off', '--mode', 'rpc'] });
  assert.partialDeepStrictEqual(await state(window.id), { args: ['--optchat-profile', 'work', '--optchat-connect', 'join', '--mode', 'rpc'] });
  assert.partialDeepStrictEqual(await windows(), [{ id: 'work/1', role: 'connected', status: 'idle' }, { id: 'work/main', role: 'main', status: 'idle' }]);

  // Complete is for a connected conversation that is not handed off yet: not the main chat, and not twice.
  await assert.rejects(request('complete', { window: 'work/main' }), /none to hand off/);
  // Nor does a message get in while the conversation is being handed off: it would belong to neither conversation.
  const [done, during] = await Promise.allSettled([request('complete', { window: window.id }), request('prompt', { window: window.id, text: 'one more thing' })]);
  assert.equal(done.status, 'fulfilled');
  assert.match(String(during.status === 'rejected' && during.reason), /being handed to the main chat/);
  await assert.rejects(request('command', { window: window.id, command: { type: 'prompt', message: 'around the back' } }), /Send a message with `prompt`/);
  assert.partialDeepStrictEqual((await windows())[0], { id: window.id, completed: true });
  await assert.rejects(request('complete', { window: window.id }), /none to hand off/);

  // The next message begins a new conversation in the same Pi, which still has the one that was handed off. The window says
  // when the new one began, and that is all of it: your message and the reply.
  const before = (await request('windows', {})).windows[0];
  assert.equal(before.since, undefined);
  await request('prompt', { window: window.id, text: 'hello again' });
  await record('agent_settled', before.seq);
  const [after] = (await request('windows', {})).windows, said = (await request('command', { window: window.id, command: { type: 'get_messages' } })).data;
  assert.deepEqual([after.completed, after.status], [undefined, 'idle']);
  assert.ok(isObject(said) && Array.isArray(said.messages) && said.messages.every(isMessage));
  assert.equal(said.messages.length, 6); // The first conversation, the request for its handoff and the handoff, then this one.
  assert.deepEqual(current(after, said.messages).map(message => message.role), ['user', 'assistant']);
  // The cut is pi-optchat's own, as its Pi said it: after the handoff, and not after what came next.
  assert.ok(after.since !== undefined && said.messages[3].timestamp < after.since && after.since <= said.messages[4].timestamp);
  assert.ok(canComplete(after), 'and it can be completed in its turn');
  // As pi-optchat cuts what its agent reads: a message of that very millisecond is the new conversation's.
  assert.deepEqual(current({ since: 5 }, [{ timestamp: 4 }, { timestamp: 5 }, { timestamp: 6 }]), [{ timestamp: 5 }, { timestamp: 6 }]);
  // Its Pi gone, the page still has what that Pi said: the cut stays with it.
  await assert.rejects(request('prompt', { window: window.id, text: 'crash' }));
  let gone = (await request('windows', {})).windows[0];
  while (gone.status !== 'stopped') { await sleep(10); gone = (await request('windows', {})).windows[0]; }
  assert.equal(gone.since, after.since);
  await request('close', { window: window.id });
  assert.equal((await status('closed')).window.id, window.id);
  assert.deepEqual((await windows()).map(w => w.id), ['work/main']);
});

test('closing the server takes no more requests, stops connected windows before their owner, and kills a Pi that will not stop', async t => {
  const { server, cwd, request } = await setup(t, { grace: 300 });
  const pids: number[] = [], stopped = process.env.FAKE_PI_STOPPED = join(home, 'stopped-in-order');
  t.after(() => { delete process.env.FAKE_PI_STOPPED; });
  for (const params of [{ profile: 'work', role: 'connected' }, { profile: 'stuck' }] as const) {
    const { window } = await request('open', params);
    await request('prompt', { window: window.id, text: 'wait for me' });
    const { data } = await request('command', { window: window.id, command: { type: 'get_state' } });
    assert(typeof data === 'object' && data !== null && 'pid' in data && typeof data.pid === 'number');
    pids.push(data.pid);
  }
  const closed = server.close();
  await assert.rejects(request('open', { profile: 'work' }), /server is closing/);
  await closed;
  assert.equal(readFileSync(stopped, 'utf8'), 'work window\nwork owner\n');
  assert.deepEqual(readdirSync(cwd), [], 'the fake Pi writes nothing where it runs');
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(request('windows', {}), /connection to the server closed/);
});

test('only this machine\'s pages connect, and a request the server cannot serve is answered with why', async t => {
  const { server, request } = await setup(t, { origins: ['optchat://app'] });
  /** Whether a socket at `url` is answered, with what a client may send as it likes: an Origin, a Host. */
  const answered = (origin?: string, host?: string, url = server.url) => new Promise<boolean>(resolve => {
    const socket = new WebSocket(url, { origin, headers: host ? { host } : {} });
    socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'profiles', params: {} })))
      .on('message', () => { socket.close(); resolve(true); }).on('close', () => resolve(false)).on('error', () => resolve(false));
  });
  // Its own page and the shell's may connect. Another program's page on this machine may not, nor a name pointed at 127.0.0.1.
  const own = `http://127.0.0.1:${server.port}`;
  assert.deepEqual(await Promise.all([own, 'optchat://app', `http://localhost:${server.port}`, 'https://example.com', 'http://localhost:9999', 'http://127.0.0.1:9999'].map(origin => answered(origin))), [true, true, false, false, false, false]);
  assert.equal(await answered(own, 'rebound.example'), false);
  // A program that is not a browser sends any Origin, or none: only the token in the address the server gave keeps it out.
  const { origin, pathname } = new URL(server.url);
  for (const url of [`${origin}${pathname}`, `${origin}${pathname}?token=guess`]) assert.deepEqual([await answered(undefined, undefined, url), await answered(own, undefined, url)], [false, false], url);
  // Nor does a request that is not even an address stop the server for everyone.
  await new Promise(resolve => { const raw = createConnection(server.port, '127.0.0.1', () => raw.end('GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n')).on('close', resolve); });
  assert.equal(await answered(), true);

  // @ts-expect-error: the compiler refuses it too.
  await assert.rejects(request('history', { profile: 'work', limit: 'all' }), /Invalid history request/);
  await assert.rejects(request('open', { profile: '../etc' }), /Profile names:/);
  await assert.rejects(request('open', { profile: 'nobody' }), /No profile named nobody/);
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'hello' });
  await assert.rejects(request('command', { window: window.id, command: { type: 'extension_ui_response', id: 'dialog-1' } }), /Send it with `answer`/);
  const socket = new WebSocket(server.url);
  t.after(() => socket.close());
  const answer = new Promise(resolve => socket.on('message', data => resolve(JSON.parse(String(data)))));
  socket.on('open', () => socket.send(JSON.stringify({ id: 7, method: 'teleport', params: {} })));
  assert.deepEqual(await answer, { id: 7, error: 'Unknown method: teleport.' });
});

test('the built UI is the page, served to this machine only and never from outside its directory', async t => {
  const ui = mkdtempSync(join(home, 'ui-'));
  mkdirSync(join(ui, 'assets'));
  writeFileSync(join(ui, 'index.html'), '<title>OptChat</title>');
  writeFileSync(join(ui, 'assets', 'app-1a2b.js'), 'app()');
  writeFileSync(join(home, 'secret.txt'), 'secret');
  const { server } = await setup(t, { ui });
  const get = (path: string, host?: string) => new Promise<[number | undefined, string | undefined, string]>(resolve => request({ port: server.port, path, headers: host ? { host } : {} }, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; }).on('end', () => resolve([response.statusCode, response.headers['content-type'], body]));
  }).end());
  assert.deepEqual(await get('/'), [200, 'text/html; charset=utf-8', '<title>OptChat</title>']);
  // Any program on this machine may ask for the page, so what it is sent never holds the socket's token.
  const token = new URL(server.page).hash.slice(1);
  assert.ok(token.length >= 40 && !(await get('/'))[2].includes(token));
  // No other page may frame it, and it may load nothing from elsewhere.
  const { headers } = await fetch(server.page);
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.deepEqual([headers.get('cross-origin-resource-policy'), headers.get('x-content-type-options')], ['same-origin', 'nosniff']);
  assert.match(headers.get('content-security-policy') ?? '', /default-src 'self'.*img-src 'self' data:.*frame-ancestors 'none'/);
  assert.deepEqual(await get('/assets/app-1a2b.js'), [200, 'text/javascript', 'app()']);
  assert.deepEqual((await get('/../secret.txt'))[0], 404);
  assert.deepEqual((await get('/%2e%2e/secret.txt'))[0], 404);
  assert.deepEqual((await get('/', 'rebound.example'))[0], 404);

  const unbuilt = await setup(t, { ui: join(ui, 'missing') });
  const response = await fetch(unbuilt.server.page);
  assert.deepEqual([response.status, await response.text()], [503, 'The UI is not built yet. Run: npm run build\n']);
});
