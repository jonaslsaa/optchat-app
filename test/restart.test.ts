import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { profileOwner } from 'pi-optchat/files';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
import { createProfile, temporaryHome, writeRun } from './support.ts';

const home = temporaryHome();
const fake = [join(import.meta.dirname, 'fake-pi.ts')], pi = { command: process.execPath, args: fake };

/** A server whose Pi loads pi-optchat from a checkout of yours, as `version` until `pull` changes it, and a profile with an
 * agent a restart cut off. A Pi of the app's keeps the pi-optchat it started on: the fake one's owner (`fake-owner.ts`) does. */
async function setup(t: TestContext, profile: string, version: string) {
  const folder = process.env.FAKE_PI_HOME = mkdtempSync(join(home, 'pi-')), checkout = join(folder, 'pi-optchat');
  const pull = (version: string) => writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'pi-optchat', version }));
  mkdirSync(checkout);
  pull(version);
  writeFileSync(join(folder, 'state.json'), JSON.stringify({ version: '1.5.2', providers: [], packages: { [checkout]: checkout } }));
  const directory = createProfile(home, profile);
  writeRun(directory, { id: 'aaaaaaaa', state: 'interrupted', started: 2000, ended: 2500, cutOff: true });
  const server = await startServer({ home, cwd: folder, pi }), { request, close } = await connect(server.url);
  t.after(async () => { close(); await server.close(); });
  const main = `${profile}/main`;
  /** The process of the profile's Pi, which a restart changes. */
  const pid = async () => {
    const { data } = await request('command', { window: main, command: { type: 'get_state' } });
    assert(typeof data === 'object' && data !== null && 'pid' in data);
    return data.pid;
  };
  const window = async () => (await request('windows', {})).windows.find(window => window.id === main);
  const agent = async () => (await request('agents', { profile })).agents.find(agent => agent.id === 'aaaaaaaa')?.state;
  await request('open', { profile });
  return { directory, folder, pull, request, main, pid, window, agent };
}

test('an idle Pi of the app\'s on an older pi-optchat is started again on the new one, and Resume then works', async t => {
  const { pull, request, pid, agent } = await setup(t, 'pulled', '0.12.1');
  // Its pi-optchat is older than resuming needs, and the Pi hangs up on it: what to do is said.
  await assert.rejects(request('resumeAgents', { profile: 'pulled' }), /older than 0\.12\.2, update it .* and start that Pi again/);
  const before = await pid();
  pull('0.12.2');
  assert.deepEqual(await request('resumeAgents', { profile: 'pulled' }), {});
  assert.notEqual(await pid(), before);
  assert.equal(await agent(), 'running');
});

test('a Pi at work on an older pi-optchat is not stopped: it is marked, and started again when asked', async t => {
  const { pull, request, main, pid, window } = await setup(t, 'working', '0.12.1');
  await request('prompt', { window: main, text: 'wait for me' });
  const before = await pid();
  pull('0.12.2');
  await request('setup', { fresh: true }); // The setup's "Check again".
  assert.partialDeepStrictEqual(await window(), { status: 'running', stale: '0.12.2' });
  assert.equal(await pid(), before);

  // A message sent while it starts again reaches the new Pi.
  assert.deepEqual(await Promise.all([request('restart', { profile: 'working' }), request('prompt', { window: main, text: 'hello' })]), [{}, { disposition: 'started' }]);
  assert.equal((await window())?.stale, undefined);
  assert.notEqual(await pid(), before);
});

test('an agent at work keeps its Pi from being started again too, while one on the pi-optchat installed is left alone', async t => {
  const { directory, pull, request, main, pid, window, agent } = await setup(t, 'agents', '0.12.2');
  await request('prompt', { window: main, text: 'hello' });
  const before = await pid();
  assert.deepEqual(await request('resumeAgents', { profile: 'agents' }), {});
  assert.equal(await pid(), before, 'nothing newer is installed');
  assert.equal(await agent(), 'running');
  pull('0.12.1'); // A checkout moved back is no reason either.
  await request('setup', { fresh: true });
  assert.equal(await pid(), before);
  assert.equal((await window())?.stale, undefined);

  writeRun(directory, { id: 'bbbbbbbb', state: 'paused', started: 3000 });
  pull('0.12.3');
  await request('setup', { fresh: true });
  assert.partialDeepStrictEqual(await window(), { status: 'idle', stale: '0.12.3' });
  assert.equal(await pid(), before);
});

test('a Pi outside the app on an older pi-optchat is left to you, and Resume says what to do', async t => {
  const { folder, directory, pull, request } = await setup(t, 'terminal', '0.12.1');
  // A Pi in a terminal: started here, not by the server.
  const terminal = spawn(process.execPath, [...fake, '--optchat-profile', 'terminal', '--optchat-connect', 'off', '--mode', 'rpc'], { cwd: folder, env: { ...process.env, OPTCHAT_HOME: home }, stdio: ['pipe', 'ignore', 'inherit'] });
  t.after(() => { terminal.stdin.end(); });
  while (!await profileOwner(directory)) await sleep(20);
  pull('0.12.2');
  await assert.rejects(request('resumeAgents', { profile: 'terminal' }), /older than 0\.12\.2, update it .* and start that Pi again/);
  await assert.rejects(request('restart', { profile: 'terminal' }), /running outside the app/);
});
