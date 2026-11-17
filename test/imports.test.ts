import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
import { chatgptExport, writeHistories } from './histories.ts';
import { createProfile, temporaryHome, writeMemory } from './support.ts';

const home = temporaryHome(), histories = join(home, 'mac'), now = Date.UTC(2026, 10, 17, 12);
const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
const written = writeHistories(histories, now);
const settled = async <T>(ask: () => Promise<T>, done: (value: T) => boolean) => {
  for (let tries = 0; tries < 100; tries++) { const value = await ask(); if (done(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('It never came.');
};

test('the scan reads only the home folder it was given, and names conversations by source and id, never by file', { timeout: 30_000 }, async t => {
  const server = await startServer({ home, cwd: home, pi, histories }), client = await connect(server.url);
  const blind = await startServer({ home, cwd: home, pi }), other = await connect(blind.url);
  t.after(async () => { client.close(); other.close(); await server.close(); await blind.close(); });
  for (const source of ['claude', 'codex', 'pi', 'claude-memory'] as const) {
    const { found } = await client.request('importScan', { source });
    assert.equal(found.length, written[source], source);
    assert.ok(found.every(f => !('file' in f) && f.project.startsWith('~/')), source);
    // A server not given a home folder reads no history at all: no test reads yours.
    assert.deepEqual((await other.request('importScan', { source })).found, []);
  }
  // A ChatGPT export is given to the server in pieces, and read once it is all there.
  const data = Buffer.from(chatgptExport(5, now)).toString('base64');
  await client.request('importUpload', { name: 'export.json', offset: 0, data: data.slice(0, 400) });
  await assert.rejects(client.request('importUpload', { name: 'export.json', offset: 1, data: '' }), /out of order/);
  const half = Buffer.from(data.slice(0, 400), 'base64').length, rest = Buffer.from(Buffer.from(data, 'base64').subarray(half)).toString('base64');
  await client.request('importUpload', { name: 'export.json', offset: half, data: rest });
  assert.equal((await client.request('importScan', { source: 'chatgpt', fresh: true })).found.length, 5);
  await assert.rejects(client.request('importUpload', { name: 'export.exe', offset: 0, data: '' }), /Invalid importUpload/);
});

test('an import runs in the profile\'s own Pi: previewed, started, paused and resumed, and its chat takes no message meanwhile', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'work');
  writeMemory(directory, 4);
  const server = await startServer({ home, cwd: home, pi, histories }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  const { found } = await client.request('importScan', { source: 'codex' });
  const picked = found.slice(0, 3).map(({ id }) => ({ source: 'codex' as const, id }));
  const preview = await client.request('importPreview', { profile: 'work', picked });
  assert.equal(preview.conversations, 3);
  assert.ok(preview.added > 0);
  assert.deepEqual(preview.memory, { messages: 4, summaries: 7 });
  // What pi-optchat cannot read of one is said of the conversation, by its title, and not of its file.
  const claude = (await client.request('importScan', { source: 'claude' })).found.filter(f => f.project === '~/tmp/scratch');
  const { warnings } = await client.request('importPreview', { profile: 'work', picked: claude.map(({ id }) => ({ source: 'claude' as const, id })) });
  assert.ok(warnings.length > 0 && warnings.every(w => !w.includes(histories) && claude.some(c => w.startsWith(`“${c.title}”`))), warnings.join('\n'));
  // A conversation the scan does not have is refused, whatever its name: the page never names a file.
  await assert.rejects(client.request('importPreview', { profile: 'work', picked: [{ source: 'codex', id: '../../etc/passwd' }] }), /no longer where it was found/);

  assert.deepEqual(await client.request('importStatus', { profile: 'work' }), { state: 'idle' });
  // No Pi has the profile: the main chat's is started for the import.
  const running = await client.request('importStart', { profile: 'work', picked, mode: 'append' });
  assert.equal(running.state, 'running');
  assert.equal(running.state === 'running' && running.added, preview.added);
  const { window } = await client.request('open', { profile: 'work' });
  assert.equal((await client.request('prompt', { window: window.id, text: 'hello' })).disposition, 'handled');

  assert.equal((await client.request('importControl', { profile: 'work', action: 'pause' })).state, 'paused');
  assert.equal((await client.request('importControl', { profile: 'work', action: 'resume' })).state, 'running');
  writeFileSync(join(directory, 'import-done'), '');
  const done = await settled(() => client.request('importStatus', { profile: 'work' }), status => status.state === 'idle');
  assert.equal(done.state === 'idle' && done.last?.added, preview.added);
});

test('a paused import is discarded with no Pi, and leaves the memory as it was', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'notes');
  const server = await startServer({ home, cwd: home, pi, histories }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  const { found } = await client.request('importScan', { source: 'pi' });
  await client.request('importStart', { profile: 'notes', picked: [{ source: 'pi', id: found[0].id }], mode: 'append' });
  const { window } = await client.request('open', { profile: 'notes' });
  await client.request('close', { window: window.id });
  // Its Pi is gone: what was running reads as paused, as after the app was quit.
  assert.equal((await client.request('importStatus', { profile: 'notes' })).state, 'paused');
  assert.deepEqual(await client.request('importControl', { profile: 'notes', action: 'discard' }), { state: 'idle' });
  assert.equal(existsSync(join(directory, 'imports', 'pending.json')), false);
});
