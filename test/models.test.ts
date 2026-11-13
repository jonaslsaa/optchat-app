import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import { clamp, levels } from '../src/models.ts';
import type { ModelChoice, Offered, Push, WindowState } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { arranged, picked, search } from '../src/ui/models.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();
// A Pi logged in to two providers. The fake keeps a main chat's pick in its profile, as pi-optchat does.
process.env.FAKE_PI_HOME = home;
writeFileSync(join(home, 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic', 'openai'], packages: {} }));
const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
const kept = (directory: string): ModelChoice | undefined => JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).main;
async function setup(t: { after(run: () => unknown): void }) {
  const server = await startServer({ home, cwd: home, pi });
  const windows = new Map<string, WindowState>();
  const client = await connect(server.url, (push: Push) => { if (push.push === 'window') windows.set(push.window.id, push.window); });
  t.after(async () => { client.close(); await server.close(); });
  const running = async (window: string) => { const { model, thinkingLevel } = (await client.request('command', { window, command: { type: 'get_state' } })).data as { model: { id: string }; thinkingLevel: string }; return `${model.id} ${thinkingLevel}`; };
  return { client, windows, running };
}

test('the levels a model thinks at, and the one it takes for another, are Pi\'s own', () => {
  // The maps are ones Pi 1.5.2 lists: Claude Opus 5.5, Claude Fable 5, Claude Haiku 4.5 (none), GPT-5 Pro, and a model that does not reason.
  assert.deepEqual(levels({ reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levels({ reasoning: true, thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' } }), ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(levels({ reasoning: true }), ['off', 'minimal', 'low', 'medium', 'high']);
  assert.deepEqual(levels({ reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: null } }), ['high']);
  assert.deepEqual(levels({ reasoning: false, thinkingLevelMap: { off: null } }), ['off']);
  // The level itself, else the next above, else the next below.
  assert.equal(clamp(['low', 'medium', 'high'], 'medium'), 'medium');
  assert.equal(clamp(['low', 'medium', 'high'], 'off'), 'low');
  assert.equal(clamp(['low', 'medium', 'high'], 'max'), 'high');
  assert.equal(clamp(['off'], 'high'), 'off');
});

test('the list has each provider\'s models together, and typing finds a model by its name, its id or its provider', () => {
  const model = (provider: string, id: string, name: string, levels: Offered['levels'] = ['low', 'medium', 'high']): Offered => ({ provider, id, name, levels });
  // As Pi lists them: a provider's last model can come after another provider's.
  const all = [model('anthropic', 'claude-opus-5-5', 'Claude Opus 5.5'), model('github-copilot', 'claude-opus-5.5', 'Claude Opus 5.5'), model('openai', 'gpt-6-sol', 'GPT-6 Sol'), model('openai', 'o3', 'o3'), model('openai', 'gpt-4.1', 'GPT-4.1', ['off']), model('github-copilot', 'gemini-4-carbon', 'Gemini 4 Carbon')];
  const ids = (models: Offered[]) => models.map(model => `${model.provider}/${model.id}`);
  assert.deepEqual(ids(arranged(all)), ['anthropic/claude-opus-5-5', 'github-copilot/claude-opus-5.5', 'github-copilot/gemini-4-carbon', 'openai/gpt-6-sol', 'openai/o3', 'openai/gpt-4.1']);
  // Every word has to be found, in any order and any case.
  assert.deepEqual(ids(search(all, 'OPUS claude')), ['anthropic/claude-opus-5-5', 'github-copilot/claude-opus-5.5']);
  // A word of the name before the provider's name, and the beginning of that before its inside.
  assert.deepEqual(ids(search(all, 'op')), ['anthropic/claude-opus-5-5', 'github-copilot/claude-opus-5.5', 'openai/gpt-6-sol', 'openai/o3', 'openai/gpt-4.1', 'github-copilot/gemini-4-carbon']);
  // By the provider's name as the page says it, and by the id where the name has other words.
  assert.deepEqual(ids(search(all, 'copilot')), ['github-copilot/claude-opus-5.5', 'github-copilot/gemini-4-carbon']);
  assert.deepEqual(ids(search(all, 'opus-5-5')), ['anthropic/claude-opus-5-5']);
  assert.deepEqual(search(all, 'llama'), []);
  // A picked model thinks as hard as the one before it where it can.
  assert.deepEqual(picked(all[2], { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'high' }), { provider: 'openai', model: 'gpt-6-sol', thinking: 'high' });
  assert.deepEqual(picked(all[4], { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'high' }), { provider: 'openai', model: 'gpt-4.1', thinking: 'off' });
  assert.deepEqual(picked(all[2]), { provider: 'openai', model: 'gpt-6-sol', thinking: 'medium' });
});

test('a model picked before the main chat\'s Pi runs is what it starts on, and a pick is the profile\'s from then on', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'work'), { client, windows, running } = await setup(t);
  const { window } = await client.request('open', { profile: 'work' });
  assert.equal(window.model, undefined, 'a new profile keeps no model: its chat starts on Pi\'s default');

  // With no Pi to ask, one that only answers this is, and says what a Pi starts on by itself.
  const { models, preset } = await client.request('models', { window: window.id });
  assert.deepEqual(preset, { provider: 'anthropic', model: 'claude-fable-5', thinking: 'medium' });
  assert.deepEqual([...new Set(models.map(model => model.provider))], ['anthropic', 'openai']);
  assert.deepEqual(models.find(model => model.id === 'gpt-4.1'), { provider: 'openai', id: 'gpt-4.1', name: 'GPT-4.1', levels: ['off'] });
  assert.deepEqual(models.find(model => model.id === 'claude-opus-5-5')?.levels, ['low', 'medium', 'high', 'xhigh', 'max']);

  // The pick is the window's at once, and no Pi is started for it.
  const pick: ModelChoice = { provider: 'openai', model: 'gpt-6-sol', thinking: 'high' };
  assert.deepEqual(await client.request('setModel', { window: window.id, model: pick }), {});
  assert.deepEqual(windows.get(window.id)?.model, pick);
  assert.equal(windows.get(window.id)?.status, 'stopped');
  assert.equal(kept(directory), undefined);
  await client.request('prompt', { window: window.id, text: 'hello' });
  assert.equal(await running(window.id), 'gpt-6-sol high');
  assert.deepEqual(kept(directory), pick);

  // With its Pi running the pick goes to it, and the window says what Pi says: a level the model has not got is the next it has.
  await client.request('setModel', { window: window.id, model: { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'off' } });
  assert.deepEqual(windows.get(window.id)?.model, { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' });
  assert.deepEqual(kept(directory), { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' });
  assert.equal((await client.request('models', { window: window.id })).preset, undefined, 'the window\'s own Pi lists its models');
  await assert.rejects(client.request('setModel', { window: window.id, model: { provider: 'anthropic', model: 'gone', thinking: 'low' } }), /Model not found: anthropic\/gone/);
  assert.deepEqual(windows.get(window.id)?.model, { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' });
  // Two picks at once are made one after the other. Pi takes its time over the first model and would take the second
  // meanwhile, which would leave it on the first with a level of the second's.
  await Promise.all([{ provider: 'openai', model: 'gpt-6.1-terra', thinking: 'high' } as const, { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' } as const].map(model => client.request('setModel', { window: window.id, model })));
  assert.equal(await running(window.id), 'claude-opus-5-5 low');
  assert.deepEqual(windows.get(window.id)?.model, { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' });

  // A connected window starts on Pi's default, and its pick is its own: not the profile's, and not the main chat's.
  const { window: beside } = await client.request('open', { profile: 'work', role: 'connected' });
  assert.equal(beside.model, undefined);
  await client.request('prompt', { window: beside.id, text: 'hello' });
  assert.deepEqual(windows.get(beside.id)?.model, { provider: 'anthropic', model: 'claude-fable-5', thinking: 'medium' });
  await client.request('setModel', { window: beside.id, model: { provider: 'openai', model: 'o3', thinking: 'max' } });
  assert.deepEqual(windows.get(beside.id)?.model, { provider: 'openai', model: 'o3', thinking: 'high' });
  assert.equal(await running(window.id), 'claude-opus-5-5 low');
  assert.deepEqual(kept(directory), { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' });

  // The profile's next Pi starts on what it keeps.
  await client.request('close', { window: beside.id });
  await client.request('close', { window: window.id });
  assert.equal((await client.request('open', { profile: 'work' })).window.model?.model, 'claude-opus-5-5');
  await client.request('prompt', { window: window.id, text: 'hello' });
  assert.equal(await running(window.id), 'claude-opus-5-5 low');

  // A pick Pi does not take stops the start, each time, and the chat never runs on another model unasked. Another pick mends it.
  await client.request('close', { window: window.id });
  await client.request('setModel', { window: window.id, model: { provider: 'anthropic', model: 'gone', thinking: 'low' } });
  for (const _ of [1, 2]) await assert.rejects(client.request('prompt', { window: window.id, text: 'hello' }), /Model not found: anthropic\/gone/);
  assert.equal(windows.get(window.id)?.status, 'stopped');
  assert.deepEqual(kept(directory), { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' });
  await client.request('setModel', { window: window.id, model: pick });
  await client.request('prompt', { window: window.id, text: 'hello' });
  assert.equal(await running(window.id), 'gpt-6-sol high');

  // A pick made while the Pi starts waits for the one it starts with, which Pi takes its time over: the later pick is the one it runs on.
  await client.request('close', { window: window.id });
  await client.request('setModel', { window: window.id, model: { provider: 'openai', model: 'gpt-6.1-terra', thinking: 'high' } });
  const started = client.request('prompt', { window: window.id, text: 'hello' });
  while (windows.get(window.id)?.status !== 'starting') await new Promise(resolve => setTimeout(resolve, 5));
  await client.request('setModel', { window: window.id, model: { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'low' } });
  await started;
  assert.equal(await running(window.id), 'claude-opus-5-5 low');
});

test('a main chat that runs in a terminal shows the model the profile keeps, and takes no pick from the app', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'terminal'), config = join(directory, 'config.json'), { client } = await setup(t);
  const keep = (main: ModelChoice) => writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, 'utf8')), main }));
  keep({ provider: 'anthropic', model: 'claude-fable-5', thinking: 'xhigh' });
  // A model picked in the app before the terminal took the profile is not what the chat there runs on.
  const waiting: ModelChoice = { provider: 'openai', model: 'gpt-6-sol', thinking: 'high' };
  await client.request('setModel', { window: (await client.request('open', { profile: 'terminal' })).window.id, model: waiting });
  let unlock = await lockProfile(directory, describeOwner({ profile: 'terminal', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));
  const { window } = await client.request('open', { profile: 'terminal' });
  assert.deepEqual(window.model, { provider: 'anthropic', model: 'claude-fable-5', thinking: 'xhigh' });
  await assert.rejects(client.request('setModel', { window: window.id, model: { provider: 'openai', model: 'o3', thinking: 'low' } }), /running outside the app\. Its model is picked there\./);
  // The Pi there picks another: the page sees it when it looks again.
  keep({ provider: 'openai', model: 'o3', thinking: 'low' });
  assert.deepEqual((await client.request('open', { profile: 'terminal' })).window.model, { provider: 'openai', model: 'o3', thinking: 'low' });
  // Once the terminal lets go, the pick is what the app's Pi will start on.
  await unlock();
  unlock = async () => {};
  assert.deepEqual((await client.request('open', { profile: 'terminal' })).window.model, waiting);
});
