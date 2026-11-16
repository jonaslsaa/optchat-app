import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connect } from '../src/client.ts';
import { editor, inside, type Launch } from '../src/server/files.ts';
import { startServer } from '../src/server/server.ts';
import { fileTarget } from '../src/ui/paths.ts';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome(), cwd = realpathSync(mkdtempSync(join(home, 'cwd-')));
mkdirSync(join(cwd, 'src'));
for (const file of ['src/App.tsx', 'run.command']) writeFileSync(join(cwd, file), '');
writeFileSync(join(home, 'secret.txt'), '');
symlinkSync(join(home, 'secret.txt'), join(cwd, 'src', 'out.txt'));

test('a path the chat names is one relative to the window\'s folder, with a folder or a line, and nothing that leaves it', () => {
  assert.deepEqual(fileTarget('src/ui/App.tsx:42'), { path: 'src/ui/App.tsx', line: 42 });
  assert.deepEqual(fileTarget('./src/ui/App.tsx#L7C2'), { path: 'src/ui/App.tsx', line: 7 });
  assert.deepEqual(fileTarget('App.tsx:3:9'), { path: 'App.tsx', line: 3 });
  assert.deepEqual(fileTarget('.github/workflows/release.yml'), { path: '.github/workflows/release.yml' });
  for (const text of ['package.json', '../secret.txt', 'src/../../x.ts', '/etc/hosts', '~/x.ts', 'https://example.com/a.ts', 'src/a b.ts', 'npm test', 'src/ui/', 'v1.2.3', 'src/a.ts\n'])
    assert.equal(fileTarget(text), undefined, text);
});

test('only a file that is there, under the folder the window runs in, can be opened', () => {
  assert.equal(inside(cwd, 'src/App.tsx'), join(cwd, 'src/App.tsx'));
  assert.equal(inside(cwd, './src/App.tsx'), join(cwd, 'src/App.tsx'));
  for (const path of ['src', 'src/Gone.tsx', '../secret.txt', 'src/../../secret.txt', join(home, 'secret.txt'), 'src/out.txt', '/etc/hosts', ''])
    assert.equal(inside(cwd, path), undefined, path);
});

test('the editor is found where the app opened from the Finder looks, with launchd\'s PATH: yours, a GUI one, or VS Code', () => {
  const brew = mkdtempSync(join(home, 'bin-')), stripped = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const name of ['code', 'zed', 'vim']) { writeFileSync(join(brew, name), ''); chmodSync(join(brew, name), 0o755); }
  assert.deepEqual(editor(stripped, [brew])?.('/a/b.ts', 42), { command: join(brew, 'code'), args: ['-g', '/a/b.ts:42'] });
  assert.deepEqual(editor({ ...stripped, EDITOR: 'zed --wait' }, [brew])?.('/a/b.ts', 42), { command: join(brew, 'zed'), args: ['/a/b.ts:42'] });
  // A terminal editor has no terminal to run in.
  assert.equal(editor({ ...stripped, VISUAL: 'vim' }, [brew])?.('/a/b.ts').command, join(brew, 'code'));
  assert.equal(editor(stripped, []), undefined);
});

test('the server opens what the chat named in the window\'s folder, and refuses what is not there', async t => {
  createProfile(home, 'work');
  const launched: Launch[] = [];
  const server = await startServer({ home, cwd, pi: { command: process.execPath, args: ['-e', ''] }, launcher: launch => launched.push(launch) });
  const client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  const { window } = await client.request('open', { profile: 'work' });
  assert.deepEqual(await client.request('isFile', { window: window.id, path: 'src/App.tsx' }), { file: true });
  assert.deepEqual(await client.request('isFile', { window: window.id, path: '../secret.txt' }), { file: false });
  await client.request('openFile', { window: window.id, path: 'run.command', line: 3 });
  assert.equal(launched.length, 1);
  assert.ok(launched[0].args.includes(join(cwd, 'run.command')) || launched[0].args.includes(`${join(cwd, 'run.command')}:3`), JSON.stringify(launched[0]));
  await assert.rejects(client.request('openFile', { window: window.id, path: 'src/out.txt' }), /not a file/);
  assert.equal(launched.length, 1);
});
