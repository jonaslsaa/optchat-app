import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { WebSocket } from 'ws';
import { connect } from '../src/client.ts';
import type { Push, Window } from '../src/protocol.ts';
import { startServer, type ServerOptions } from '../src/server/server.ts';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();
for (const name of ['work', 'busy', 'stuck']) createProfile(home, name);
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
  const statuses = (id: string) => pushes.flatMap(push => push.push === 'window' && push.window.id === id ? [push.window.status] : []);
  const record = (type: string, from = 0) => pushed((push): push is Extract<Push, { push: 'record' }> => push.push === 'record' && push.record.type === type && push.seq > from);
  const status = (status: Window['status']) => pushed((push): push is Extract<Push, { push: 'window' }> => push.push === 'window' && push.window.status === status);
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
  assert.deepEqual(types(), ['extension_ui_request', 'agent_start', 'message_start', 'message_end', 'message_start', 'message_update', 'message_update', 'message_end', 'agent_end', 'agent_settled']);
  const numbers = pushes.flatMap(push => push.push === 'record' ? [push.seq] : []);
  assert.deepEqual(numbers, numbers.map((_, k) => k + 1));

  // Pi got the profile, the app's OPTCHAT_HOME and the window's directory. A second open is the same window, and the same Pi.
  const { data } = await request('command', { window: window.id, command: { type: 'get_state' } });
  assert.partialDeepStrictEqual(data, { args: ['--optchat-profile', 'work', '--mode', 'rpc'], home, cwd });
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

test('records over the limit are dropped oldest first, and the client is told', async t => {
  const { request, record } = await setup(t, { keep: 200 });
  const { window } = await request('open', { profile: 'work' });
  await request('prompt', { window: window.id, text: 'hello' });
  await record('agent_settled');
  const kept = await request('records', { window: window.id });
  assert.equal(kept.complete, false);
  assert.deepEqual(kept.records.map(r => r.record.type).slice(-2), ['agent_end', 'agent_settled']);
});

test('a Pi that could not open the profile is stopped, and the prompt fails with its reason', async t => {
  const { request, status } = await setup(t);
  const { window } = await request('open', { profile: 'busy' });
  await assert.rejects(request('prompt', { window: window.id, text: 'hello' }), /Profile already running: busy/);
  assert.partialDeepStrictEqual((await status('stopped')).window, { id: 'busy/main' });
  assert.partialDeepStrictEqual((await request('windows', {})).windows[0], { status: 'stopped', error: 'Profile already running: busy · PID 1' });
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

test('Complete hands off a connected window only, and closing one removes it', async t => {
  const { request, record, status } = await setup(t);
  const main = (await request('open', { profile: 'work' })).window, connected = (await request('open', { profile: 'work', role: 'connected' })).window;
  assert.notEqual(connected.id, main.id);
  await request('prompt', { window: main.id, text: 'hello' });
  await assert.rejects(request('complete', { window: main.id }), /connected window/);

  await request('prompt', { window: connected.id, text: 'hello' });
  await request('complete', { window: connected.id });
  assert.partialDeepStrictEqual((await record('extension_ui_request', (await request('windows', {})).windows[1].seq - 1)).record, { message: 'Handed off.' });
  await request('close', { window: connected.id });
  assert.equal((await status('closed')).window.id, connected.id);
  assert.deepEqual((await request('windows', {})).windows.map(w => w.id), [main.id]);
});

test('closing the server lets each Pi shut down in order, and kills one that does not', async t => {
  const { server, cwd, request } = await setup(t, { grace: 300 });
  const pids: number[] = [];
  for (const profile of ['work', 'stuck']) {
    const { window } = await request('open', { profile });
    await request('prompt', { window: window.id, text: 'wait for me' });
    const { data } = await request('command', { window: window.id, command: { type: 'get_state' } });
    assert(typeof data === 'object' && data !== null && 'pid' in data && typeof data.pid === 'number');
    pids.push(data.pid);
  }
  await server.close();
  assert.equal(readFileSync(join(cwd, 'stopped-in-order'), 'utf8'), 'work');
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(request('windows', {}), /connection to the server closed/);
});

test('a page from another site cannot connect, and a malformed request is refused', async t => {
  const { server, request } = await setup(t);
  const opened = (origin: string) => new Promise<boolean>(resolve => {
    const socket = new WebSocket(server.url, { origin });
    socket.on('open', () => { socket.close(); resolve(true); }).on('error', () => resolve(false));
  });
  assert.equal(await opened('https://example.com'), false);
  assert.equal(await opened('http://localhost:5173'), true);
  // @ts-expect-error: the compiler refuses it too.
  await assert.rejects(request('history', { profile: 'work', limit: 'all' }), /Invalid history request/);
  await assert.rejects(request('open', { profile: '../etc' }), /No profile named/);
});
