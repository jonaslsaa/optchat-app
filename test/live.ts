import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import type { Push } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { createProfile, temporaryHome } from './support.ts';

/** `npm run test:live`: a real turn through the installed Pi with pi-optchat, on a throwaway profile. It needs Pi logged in to
 * Anthropic and costs a fraction of a cent. Pi keeps no session file, and the real ~/.optchat is never opened. */
test('a real Pi turn on a throwaway profile, end to end through the WebSocket', { timeout: 120_000 }, async t => {
  const home = temporaryHome(), profile = createProfile(home, 'live');
  const server = await startServer({ home, cwd: mkdtempSync(join(home, 'cwd-')), pi: { command: 'pi', args: ['--no-session', '--model', 'anthropic/claude-haiku-5-5', '--thinking', 'off'] } });
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
  assert.deepEqual(pushes.flatMap(push => push.push === 'window' ? [push.window.status] : []), ['stopped', 'starting', 'idle', 'running', 'idle']);

  // The turn is in the profile's memory, written by Pi and read by the app from disk.
  const { messages } = await client.request('history', { profile: 'live' });
  assert.deepEqual(messages.map(m => [m.kind, m.text]), [['user', 'Reply with exactly this word and nothing else: pong'], ['talk', 'pong']]);
  assert.deepEqual((await client.request('view', { profile: 'live' })).lines.map(l => [l.id, l.n]), [[0, 1], [1, 1]]);

  // A second client finds the window and its run; closing the server lets Pi release the profile.
  const second = await connect(server.url);
  assert.partialDeepStrictEqual((await second.request('windows', {})).windows, [{ id: 'live/main', status: 'idle' }]);
  assert.equal((await second.request('records', { window: window.id })).records[0].record.type, 'agent_start');
  assert.equal(existsSync(join(profile, 'lock.sock')), true);
  await server.close();
  assert.equal(existsSync(join(profile, 'lock.sock')), false);
});
