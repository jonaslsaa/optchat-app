import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi that has the profile open.
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { createProfile, temporaryHome, writeRun } from './support.ts';

const home = temporaryHome();
const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
const user = (text: string, timestamp: number) => ({ role: 'user', content: [{ type: 'text', text }], timestamp });
const calls = (timestamp: number, ...commands: string[]) => ({ role: 'assistant', timestamp, stopReason: 'toolUse',
  content: [{ type: 'text', text: 'On it.' }, ...commands.map(command => ({ type: 'toolCall', id: command, name: 'bash', arguments: { command } }))] });
const result = (command: string, timestamp: number, content: object[] = [{ type: 'text', text: 'ok' }]) => ({ role: 'toolResult', toolCallId: command, toolName: 'bash', content, timestamp });

test('a profile\'s agents are read from its files: who works on what now, and what the others reported', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'work');
  const server = await startServer({ home, cwd: home, pi }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  assert.deepEqual(await client.request('agents', { profile: 'work' }), { agents: [], more: 0 });

  const view = '<chat>\n0+1|user: a long view of the profile\'s memory\n</chat>\n\nYour task:\nRun the tests.';
  writeRun(directory, { id: 'aaaaaaaa', state: 'running', started: 3000, title: 'Run the tests', task: 'Run the tests.' },
    [{ role: 'system', content: '', timestamp: 3000 }, user(view, 3000), calls(3001, 'npm test', 'npm run check'), result('npm test', 3002)]);
  writeRun(directory, { id: 'bbbbbbbb', state: 'completed', started: 2000, ended: 2500, parentId: 'aaaaaaaa', report: '\nAll green.\n\nNothing else to say.' });
  writeRun(directory, { id: 'cccccccc', state: 'failed', started: 1000, ended: 1500, report: 'Launch failed: no such model' });
  // A connected window is a run to pi-optchat, and a window here.
  writeRun(directory, { id: 'dddddddd', state: 'running', started: 4000, connected: true, window: { pid: process.pid } });

  // No Pi has the profile: an agent saved as working was cut off with its Pi.
  const cut = await client.request('agents', { profile: 'work' });
  assert.deepEqual(cut.agents.map(agent => [agent.id, agent.state, agent.doing]), [['aaaaaaaa', 'interrupted', []], ['bbbbbbbb', 'completed', []], ['cccccccc', 'failed', []]]);

  // With a Pi on the profile, the app's or one in a terminal, it is at work: on the call that has no result yet.
  const unlock = await lockProfile(directory, describeOwner({ profile: 'work', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));
  assert.deepEqual(await client.request('agents', { profile: 'work', limit: 1 }), {
    agents: [
      { id: 'aaaaaaaa', title: 'Run the tests', task: 'Run the tests.', model: 'anthropic/claude-haiku-5-5', state: 'running', started: 3000, doing: [{ name: 'bash', args: { command: 'npm run check' } }] },
      { id: 'bbbbbbbb', task: 'Look into it.', model: 'anthropic/claude-haiku-5-5', state: 'completed', started: 2000, ended: 2500, parent: 'aaaaaaaa', doing: [], headline: 'All green.' },
    ],
    more: 1,
  });

  // Its chat: the task without the view it was sent under, no system prompt, and an image named but not carried.
  const chat = await client.request('agent', { profile: 'work', id: 'aaaaaaaa' });
  assert.deepEqual(chat, { total: 3, messages: [{ role: 'user', content: 'Run the tests.', timestamp: 3000 }, calls(3001, 'npm test', 'npm run check'), result('npm test', 3002)] });
  // Pi appends as each message ends, a line that is still being written among them: what is whole is read, from where the page is.
  const file = join(directory, 'runs', 'aaaaaaaa.jsonl'), picture = [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }];
  appendFileSync(file, `${JSON.stringify({ type: 'message', message: result('npm run check', 3003, picture) })}\n{"type":"message","message":{"role":"assis`);
  assert.deepEqual(await client.request('agent', { profile: 'work', id: 'aaaaaaaa', after: chat.total }), { total: 4, messages: [result('npm run check', 3003, [{ type: 'image' }])] });
  assert.deepEqual((await client.request('agents', { profile: 'work' })).agents[0].doing, []);

  assert.deepEqual(await client.request('agent', { profile: 'work', id: 'cccccccc' }), { total: 0, messages: [], report: 'Launch failed: no such model', ended: 1500 });
  // A connected window is no agent, and one whose record is gone has no chat: a report in the chat can still name it.
  for (const id of ['dddddddd', 'eeeeeeee']) assert.deepEqual(await client.request('agent', { profile: 'work', id }), { total: 0, messages: [] });
  await assert.rejects(client.request('agents', { profile: 'nobody' }), /No profile named nobody\./);
});

test('a connected window whose handoff the main chat\'s Pi is writing is said to be handing off, while a Pi has the profile', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'handing');
  const server = await startServer({ home, cwd: home, pi }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  // Its conversation ended and the handoff is not in the main chat yet; another's is, and one window is still open.
  writeRun(directory, { id: 'aaaaaaaa', state: 'interrupted', started: 1000, ended: 2000, task: 'Fix the badge', connected: true, handoff: { reason: 'owner-stopped' } });
  writeRun(directory, { id: 'bbbbbbbb', state: 'completed', started: 1000, ended: 1500, connected: true, handoff: { reason: 'complete', delivered: true } });
  writeRun(directory, { id: 'cccccccc', state: 'running', started: 3000, connected: true, window: { pid: process.pid } });
  // No Pi has the profile: none is writing it, and a spinner would never end.
  assert.deepEqual(await client.request('agents', { profile: 'handing' }), { agents: [], more: 0 });
  const unlock = await lockProfile(directory, describeOwner({ profile: 'handing', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));
  assert.deepEqual(await client.request('agents', { profile: 'handing' }), { agents: [], more: 0, handing: [{ id: 'aaaaaaaa', task: 'Fix the badge' }] });
});

test('an agent is told, interrupted, stopped and resumed through the Pi that has its profile open', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'crew');
  const server = await startServer({ home, cwd: home, pi }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  writeRun(directory, { id: 'aaaaaaaa', state: 'running', started: 3000 });
  writeRun(directory, { id: 'bbbbbbbb', state: 'completed', started: 2000, ended: 2500, report: 'Done.' });
  writeRun(directory, { id: 'cccccccc', state: 'completed', started: 2100, ended: 2400, parentId: 'bbbbbbbb' });
  const agent = (id: string) => ({ profile: 'crew', id });
  const states = async () => Object.fromEntries((await client.request('agents', { profile: 'crew' })).agents.map(({ id, state }) => [id, state]));

  // No Pi has the profile, so there is no agent to reach: pi-optchat says so, and nothing is started to interrupt or stop one.
  await assert.rejects(client.request('stopAgent', agent('aaaaaaaa')), /No running OptChat session on this profile accepts connections/);
  assert.deepEqual((await client.request('windows', {})).windows, []);
  assert.equal(await server.working(), 0, 'a run saved as working, in a profile no Pi has open: stopping the server stops nothing');
  // A message is worth a Pi: the main window's is started. An agent that has ended is resumed with it, and one at work is
  // told, which it keeps until it reads it: you do not choose between the two.
  assert.deepEqual(await client.request('tellAgent', { ...agent('bbbbbbbb'), text: 'And the Windows run?' }), { resumed: true });
  assert.partialDeepStrictEqual((await client.request('windows', {})).windows, [{ id: 'crew/main', status: 'idle' }]);
  assert.deepEqual(await client.request('tellAgent', { ...agent('aaaaaaaa'), text: 'Skip the slow test.' }), { resumed: false });
  assert.deepEqual(await states(), { aaaaaaaa: 'running', bbbbbbbb: 'running', cccccccc: 'completed' });
  // The main chat is not in a run, but its two agents are: that is what a quit would cut short.
  assert.equal(await server.working(), 2);
  assert.deepEqual((await client.request('agent', agent('aaaaaaaa'))).queued, ['Skip the slow test.']);

  // pi-optchat refuses in its own words, which are the answer: an agent's own agent is resumed by that agent alone.
  await assert.rejects(client.request('tellAgent', { ...agent('cccccccc'), text: 'Go on.' }), /^Error: Only cccccccc's parent bbbbbbbb can resume it, and that parent is no longer running\./);
  await assert.rejects(client.request('stopAgent', agent('eeeeeeee')), /^Error: No subagent eeeeeeee in this profile$/);

  // Interrupted, it goes on with what it was told, which it has read by then; with nothing to go on with, it waits.
  assert.deepEqual(await client.request('interruptAgent', agent('aaaaaaaa')), {});
  assert.deepEqual([(await states()).aaaaaaaa, (await client.request('agent', agent('aaaaaaaa'))).queued], ['running', undefined]);
  assert.deepEqual(await client.request('interruptAgent', agent('aaaaaaaa')), {});
  assert.deepEqual(await client.request('stopAgent', agent('bbbbbbbb')), {});
  assert.deepEqual(await states(), { aaaaaaaa: 'paused', bbbbbbbb: 'stopped', cccccccc: 'completed' });
  assert.equal(await server.working(), 0, 'an agent that is paused is not at work');
  assert.equal((await client.request('agent', agent('bbbbbbbb'))).report, 'Stopped by the user.');
});

test('the agents a close or crash of their Pi cut off are found in every profile, and resumed in one through its Pi when asked', { timeout: 30_000 }, async t => {
  const home = temporaryHome();
  // Pi crashed: its records still say working, and no Pi has the profile. Its paused agent and an agent's own agent are not counted.
  const crashed = createProfile(home, 'crashed');
  writeRun(crashed, { id: 'aaaaaaaa', state: 'running', started: 3000 });
  writeRun(crashed, { id: 'aaaaaaab', state: 'waiting', started: 3100 });
  writeRun(crashed, { id: 'aaaaaaac', state: 'running', started: 3200, parentId: 'aaaaaaaa', depth: 2 });
  writeRun(crashed, { id: 'aaaaaaad', state: 'paused', started: 3300 });
  // Pi closed, or opened the profile again since: pi-optchat marked them.
  const quit = createProfile(home, 'quit');
  writeRun(quit, { id: 'bbbbbbbb', state: 'interrupted', started: 2000, ended: 2500, cutOff: true });
  writeRun(quit, { id: 'bbbbbbbc', state: 'interrupted', started: 1000, ended: 1500 });
  writeRun(createProfile(home, 'calm'), { id: 'cccccccc', state: 'completed', started: 1000, ended: 1500 });
  const server = await startServer({ home, cwd: home, pi }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });

  assert.deepEqual(await client.request('cutOff', {}), { profiles: [
    { profile: 'crashed', agents: [{ id: 'aaaaaaaa', started: 3000 }, { id: 'aaaaaaab', started: 3100 }] },
    { profile: 'quit', agents: [{ id: 'bbbbbbbb', started: 2000 }] },
  ] });
  assert.deepEqual((await client.request('windows', {})).windows, [], 'finding them starts no Pi');

  // Resuming them is worth a Pi: the profile's is started, and the agent goes on. The other profile is left as it was.
  assert.deepEqual(await client.request('resumeAgents', { profile: 'quit' }), {});
  assert.partialDeepStrictEqual((await client.request('windows', {})).windows, [{ id: 'quit/main', status: 'idle' }]);
  assert.deepEqual((await client.request('agents', { profile: 'quit' })).agents.map(({ id, state }) => [id, state]), [['bbbbbbbb', 'running'], ['bbbbbbbc', 'interrupted']]);
  assert.deepEqual((await client.request('cutOff', {})).profiles.map(cut => cut.profile), ['crashed']);

  // With a Pi on the profile, one saved as working is at work: nothing was cut off.
  const unlock = await lockProfile(crashed, describeOwner({ profile: 'crashed', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));
  assert.deepEqual(await client.request('cutOff', {}), { profiles: [] });
});
