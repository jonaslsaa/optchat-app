import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import type { Command, Push } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { asked, matching, offered } from '../src/ui/commands.ts';
import { createProfile, temporaryHome } from './support.ts';

const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };

test('the commands are the window\'s Pi\'s, which is started for them; a window lists the ones that do something in it', { timeout: 30_000 }, async t => {
  const home = temporaryHome(), server = await startServer({ home, cwd: home, pi }), statuses: string[] = [];
  createProfile(home, 'work');
  const client = await connect(server.url, (push: Push) => { if (push.push === 'window') statuses.push(push.window.status); });
  t.after(async () => { client.close(); await server.close(); });
  const { window } = await client.request('open', { profile: 'work' });
  const { commands } = await client.request('commands', { window: window.id });
  // No message was sent: its Pi runs, and nothing else does.
  assert.deepEqual(statuses.filter((status, k) => status !== statuses[k - 1]), ['stopped', 'starting', 'idle']);
  assert.deepEqual(commands.slice(0, 3).map(command => [command.name, command.source]), [['complete', 'extension'], ['tell-main', 'extension'], ['optchat', 'extension']]);

  // Your prompt templates and skills first, then what extensions add. `/optchat` is the words of it that answer in the app, in
  // the main chat only, and the two commands of a connected window are in a connected window only.
  const names = (role: 'main' | 'connected') => offered(commands, role).map(command => command.name);
  assert.deepEqual(names('main'), ['fix-tests', 'skill:sol-loop', 'skill:use-codex', 'skill:write-a-skill', 'optchat instructions', 'optchat import', 'mcp']);
  assert.deepEqual(names('connected'), ['fix-tests', 'skill:sol-loop', 'skill:use-codex', 'skill:write-a-skill', 'complete', 'tell-main', 'mcp']);

  // The list is asked for a name while the message is no more than one, and is gone once more is typed after it.
  const found = (text: string) => { const typed = asked(text); return typed === undefined ? undefined : matching(offered(commands, 'main'), typed).map(command => command.name); };
  assert.deepEqual(found('/')?.length, 7);
  assert.deepEqual(found('/s'), ['skill:sol-loop', 'skill:use-codex', 'skill:write-a-skill', 'fix-tests', 'optchat instructions']);
  assert.deepEqual(found('/Sol'), ['skill:sol-loop']);
  assert.deepEqual(found('/optchat i'), ['optchat instructions', 'optchat import']);
  assert.deepEqual(found('/skill:sol-loop the last commit'), []);
  assert.deepEqual([found('hello /s'), found('/s\nmore')], [undefined, undefined]);
  // A name typed in full is first, before a longer one that begins with it: Enter then sends it.
  const two: Command[] = [{ name: 'mcp-tools', source: 'prompt' }, { name: 'mcp', source: 'extension' }];
  assert.deepEqual(matching(two, 'mcp').map(command => command.name), ['mcp', 'mcp-tools']);
});
