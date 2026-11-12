import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { WebSocket } from 'ws';
import { connect } from '../src/client.ts';
import type { Push, WindowState } from '../src/protocol.ts';
import { startServer, type ServerOptions } from '../src/server/server.ts';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();
for (const name of ['work', 'busy', 'stuck', 'mute', 'bare', 'noisy']) createProfile(home, name);
const fake = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };

/** A server over the fake Pi, and a client that remembers what it was pushed. */
async function setup(t: TestContext, options: ServerOptions = {}) {
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
  return { request: connection.request, pushes, types, statuses, record, status };
}

test('a window starts its Pi on the first prompt, and what Pi writes reaches the client in order', async t => {
  const { request, cwd, pushes, types, statuses, record } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  assert.deepEqual(window, { id: 'work/main', profile: 'work', role: 'main', cwd, status: 'stopped', seq: 0 });
  await assert.rejects(request('command', { window: window.id, command: { type: 'get_state' } }), /no Pi running/);

  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
  await record('agent_settled');
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
  assert.equal(stopped.owner, undefined);
  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
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

  // A Pi without pi-optchat opens no profile either. Another extension's failure is not pi-optchat's.
  await assert.rejects(request('prompt', { window: (await request('open', { profile: 'bare' })).window.id, text: 'hello' }), /pi-optchat did not open the profile/);
  assert.deepEqual(await request('prompt', { window: (await request('open', { profile: 'noisy' })).window.id, text: 'hello' }), { disposition: 'started' });
});

test('a message sent during a run is queued, and abort hands back what was still queued', async t => {
  const { request, record } = await setup(t);
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'wait for me' });
  assert.deepEqual(await request('prompt', { window: window.id, text: 'and then this' }), { disposition: 'queued' });
  assert.deepEqual(await request('abort', { window: window.id }), { steering: ['and then this'], followUp: [] });
  assert.equal((await record('agent_settled')).record.aborted, true);
  assert.equal((await request('windows', {})).windows[0].status, 'idle');
});

test('a connected window starts the profile\'s owner first, joins it, and Complete hands it off', async t => {
  const { request, status } = await setup(t);
  const { window } = await request('open', { profile: 'work', role: 'connected' });
  const windows = async () => (await request('windows', {})).windows.map(({ id, role, status, owner, completed }) => ({ id, role, status, owner, completed }));
  assert.deepEqual(await windows(), [{ id: 'work/1', role: 'connected', status: 'stopped', owner: undefined, completed: undefined }]);
  await request('prompt', { window: window.id, text: 'hello' });
  const state = async (id: string) => (await request('command', { window: id, command: { type: 'get_state' } })).data;
  assert.partialDeepStrictEqual(await state('work/main'), { args: ['--optchat-profile', 'work', '--optchat-connect', 'off', '--mode', 'rpc'] });
  assert.partialDeepStrictEqual(await state(window.id), { args: ['--optchat-profile', 'work', '--optchat-connect', 'join', '--mode', 'rpc'] });
  assert.partialDeepStrictEqual(await windows(), [{ id: 'work/1', role: 'connected', status: 'idle', owner: false }, { id: 'work/main', role: 'main', status: 'idle', owner: true }]);

  await assert.rejects(request('complete', { window: 'work/main' }), /none to hand off/);
  await request('complete', { window: window.id });
  assert.partialDeepStrictEqual((await windows())[0], { id: window.id, owner: false, completed: true });
  await request('close', { window: window.id });
  assert.equal((await status('closed')).window.id, window.id);
  assert.deepEqual((await windows()).map(w => w.id), ['work/main']);
});

test('closing the server takes no more requests, stops connected windows before their owner, and kills a Pi that will not stop', async t => {
  const { server, cwd, request } = await setup(t, { grace: 300 });
  const pids: number[] = [];
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
  assert.equal(readFileSync(join(cwd, 'stopped-in-order'), 'utf8'), 'work window\nwork owner\n');
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(request('windows', {}), /connection to the server closed/);
});

test('only this machine\'s pages connect, and a request the server cannot serve is answered with why', async t => {
  const { server, request } = await setup(t, { origins: ['optchat://app'] });
  const opened = (origin: string, host?: string) => new Promise<boolean>(resolve => {
    const socket = new WebSocket(server.url, { origin, headers: host ? { host } : {} });
    socket.on('open', () => { socket.close(); resolve(true); }).on('error', () => resolve(false));
  });
  assert.deepEqual(await Promise.all([opened('https://example.com'), opened('http://localhost:5173'), opened('optchat://app'), opened('http://localhost:5173', 'rebound.example')]), [false, true, true, false]);

  // @ts-expect-error: the compiler refuses it too.
  await assert.rejects(request('history', { profile: 'work', limit: 'all' }), /Invalid history request/);
  await assert.rejects(request('open', { profile: '../etc' }), /No profile named/);
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
  assert.deepEqual(await get('/assets/app-1a2b.js'), [200, 'text/javascript', 'app()']);
  assert.deepEqual((await get('/../secret.txt'))[0], 404);
  assert.deepEqual((await get('/%2e%2e/secret.txt'))[0], 404);
  assert.deepEqual((await get('/', 'rebound.example'))[0], 404);

  const unbuilt = await setup(t, { ui: join(ui, 'missing') });
  const response = await fetch(unbuilt.server.page);
  assert.deepEqual([response.status, await response.text()], [503, 'The UI is not built yet. Run: npm run build\n']);
});
