import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
import { App } from '../src/ui/store.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi that has the profile open and takes no changes.
import { describeOwner, lockProfile, SETTING_KEYS, SETTINGS } from 'pi-optchat/files';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();
const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };

test('a profile\'s settings are pi-optchat\'s to list, to judge and to write', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'work'), file = join(directory, 'config.json'), kept = () => JSON.parse(readFileSync(file, 'utf8'));
  const haiku = { provider: 'anthropic', model: 'claude-haiku-5-5', thinking: 'off' };
  // A key from a pi-optchat that is newer than the app's: whatever is changed, it stays.
  writeFileSync(file, JSON.stringify({ ...kept(), later: 'kept' }));
  const server = await startServer({ home, cwd: home, pi }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });

  // Every setting pi-optchat has, as it describes it, with what the profile has: here its defaults, since the file names none.
  const config = await client.request('config', { profile: 'work' });
  assert.deepEqual(config.settings.map(setting => setting.key), SETTING_KEYS);
  assert.deepEqual(config.settings.find(setting => setting.key === 'jobs'), { key: 'jobs', ...SETTINGS.jobs, value: 8 });
  assert.partialDeepStrictEqual(config.settings.find(setting => setting.key === 'refreshAt'), { kind: 'percent', value: 0.3 });
  assert.partialDeepStrictEqual(config, { compactor: haiku, subagent: haiku, standard: { provider: 'anthropic', thinking: 'medium' }, instructions: '# work\n\nA test profile. Answer in one short sentence.\n' });

  // No Pi has the profile: a change is written to its file, which keeps the rest of it.
  const changed = await client.request('configure', { profile: 'work', key: 'maxAgents', value: 3 });
  assert.equal(changed.settings.find(setting => setting.key === 'maxAgents')?.value, 3);
  const sonnet = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5-5', thinking: 'low' } as const;
  assert.deepEqual((await client.request('configure', { profile: 'work', key: 'compactor', value: sonnet })).compactor, sonnet);
  assert.deepEqual(kept(), { compactor: sonnet, subagent: haiku, later: 'kept', maxAgents: 3 });

  // What pi-optchat will not have, it says in its own words, and nothing is written.
  await assert.rejects(client.request('configure', { profile: 'work', key: 'jobs', value: 100 }), /^Error: Summaries at once must be a whole number from 1 to 64\.$/);
  await assert.rejects(client.request('configure', { profile: 'work', key: 'groupReports', value: 1 }), /^Error: Group subagent reports must be true or false\.$/);
  await assert.rejects(client.request('configure', { profile: 'work', key: 'main', value: sonnet }), /^Error: The main model follows Pi: pick it there/);
  await assert.rejects(client.request('configure', { profile: 'work', key: 'later', value: 1 }), /^Error: Unknown setting: later\.$/);
  await assert.rejects(client.request('config', { profile: 'nobody' }), /No profile named nobody\./);
  assert.deepEqual(kept(), { compactor: sonnet, subagent: haiku, later: 'kept', maxAgents: 3 });

  await client.request('instruct', { profile: 'work', text: 'Answer in French.\n' });
  assert.equal(readFileSync(join(directory, 'AGENTS.md'), 'utf8'), 'Answer in French.\n');

  // The page keeps what the server answered, and is told why when a change was refused: by a Pi that holds the profile and
  // takes no changes too (one that is still starting, here), whose file the app then leaves alone.
  const app = new App({ storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }) });
  t.after(() => app.close());
  await app.start(server.url);
  await app.readConfig('work');
  assert.equal(app.state.config.work.instructions, 'Answer in French.\n');
  assert.equal(await app.configure('work', 'jobs', 0), 'Summaries at once must be a whole number from 1 to 64.');
  assert.equal(await app.configure('work', 'jobs', 4), undefined);
  assert.equal(app.state.config.work.settings.find(setting => setting.key === 'jobs')?.value, 4);
  const unlock = await lockProfile(directory, describeOwner({ profile: 'work', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));
  assert.match(await app.configure('work', 'jobs', 2) ?? '', /^The profile is busy: its Pi is still starting/);
  assert.equal(kept().jobs, 4);
  assert.equal(app.state.error, undefined, 'said beside the field, not above the page');
});
