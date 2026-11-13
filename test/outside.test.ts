import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import type { Push, WindowState } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();

const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };

test('a profile a Pi outside the app holds is never joined unasked, and is the app\'s again when that Pi is gone and the page looks', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'work');
  const server = await startServer({ home, cwd: home, pi });
  const windows = new Map<string, WindowState>();
  const client = await connect(server.url, (push: Push) => { if (push.push === 'window') windows.set(push.window.id, push.window); });
  t.after(async () => { client.close(); await server.close(); });
  const unlock = await lockProfile(directory, describeOwner({ profile: 'work', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));

  // The main window says who holds the profile, and starts no Pi: its prompt is refused.
  const { window: main } = await client.request('open', { profile: 'work' });
  assert.deepEqual(main.outside, { pid: 4242, host: 'a-terminal', cwd: '/somewhere' });
  await assert.rejects(client.request('prompt', { window: main.id, text: 'hello' }), /This chat is running outside the app\./);
  assert.equal(windows.get(main.id)?.status, 'stopped');

  // A connected window is the explicit way in: it joins the Pi outside, and the main window still starts none.
  const { window } = await client.request('open', { profile: 'work', role: 'connected' });
  assert.deepEqual(await client.request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
  assert.match(JSON.stringify((await client.request('command', { window: window.id, command: { type: 'get_state' } })).data), /"--optchat-connect","join"/);
  assert.equal(windows.get(main.id)?.status, 'stopped');

  // The terminal closes. Nothing watches for that: the page looks again by opening the profile, and then the chat is the app's.
  await unlock();
  assert.deepEqual(windows.get(main.id)?.outside, main.outside);
  assert.equal((await client.request('open', { profile: 'work' })).window.outside, undefined);
  assert.equal(windows.get(main.id)?.outside, undefined);
  assert.deepEqual(await client.request('prompt', { window: main.id, text: 'hello' }), { disposition: 'started' });
});

test('a holder that does not say who it is still holds the profile, and a prompt looks again by itself', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'other');
  const server = await startServer({ home, cwd: home, pi });
  const client = await connect(server.url, () => {});
  t.after(async () => { client.close(); await server.close(); });
  const unlock = await lockProfile(directory, 'a program with words of its own');
  t.after(() => unlock().catch(() => {}));

  const { window: main } = await client.request('open', { profile: 'other' });
  assert.equal(main.outside, 'unknown');
  await assert.rejects(client.request('prompt', { window: main.id, text: 'hello' }), /This chat is running outside the app\./);
  await unlock();
  assert.deepEqual(await client.request('prompt', { window: main.id, text: 'hello' }), { disposition: 'started' });
  assert.equal((await client.request('windows', {})).windows.find(window => window.id === main.id)?.outside, undefined);
});
