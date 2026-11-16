import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { connect } from '../src/client.ts';
import { inside, installed, opening, preferred, type Installed, type Launch } from '../src/server/files.ts';
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

test('an editor is found by its command or, with launchd\'s PATH, inside its app, and yours is the one used unless you picked another', () => {
  const bin = mkdtempSync(join(home, 'bin-')), apps = mkdtempSync(join(home, 'apps-'));
  const put = (file: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, ''); chmodSync(file, 0o755); };
  for (const file of [join(bin, 'code'), join(bin, 'vim'), join(apps, 'Zed.app/Contents/MacOS/cli'), join(apps, 'Cursor.app/Contents/Resources/app/bin/cursor')]) put(file);
  const found = installed({ env: { PATH: '/usr/bin:/bin' }, extra: [bin], apps: [apps] });
  assert.deepEqual([...found], [['cursor', join(apps, 'Cursor.app/Contents/Resources/app/bin/cursor')], ['vscode', join(bin, 'code')], ['zed', join(apps, 'Zed.app/Contents/MacOS/cli')], ['finder', '/usr/bin/open']]);
  assert.equal(preferred(found, undefined, {}), 'vscode');
  assert.equal(preferred(found, undefined, { EDITOR: 'zed --wait' }), 'zed');
  // A terminal editor has no terminal to run in, and an editor picked that is gone since is passed over too.
  assert.equal(preferred(found, 'windsurf', { VISUAL: 'vim' }), 'vscode');
  assert.equal(preferred(found, 'cursor', { EDITOR: 'zed' }), 'cursor');
  assert.equal(preferred(new Map([['finder', '/usr/bin/open']]), undefined, {}), undefined);
  const all: Installed = new Map([['cursor', '/c'], ['zed', '/z'], ['idea', '/i'], ['finder', '/usr/bin/open']]);
  assert.deepEqual(opening(all, 'cursor', '/a/b.ts', 42), { command: '/c', args: ['--classic', '-g', '/a/b.ts:42'] });
  assert.deepEqual(opening(all, 'zed', '/a/b.ts', 42), { command: '/z', args: ['/a/b.ts:42'] });
  assert.deepEqual(opening(all, 'idea', '/a/b.ts', 42), { command: '/i', args: ['--line', '42', '/a/b.ts'] });
  assert.deepEqual(opening(all, 'finder', '/a/b.ts', 42), { command: '/usr/bin/open', args: ['-R', '/a/b.ts'] });
  // With no editor, the Mac's text editor: `open` on the file itself would run a script.
  assert.deepEqual(opening(all, undefined, '/a/run.command'), { command: 'open', args: ['-t', '/a/run.command'] });
});

test('a profile\'s instructions open in the editor of your choice, which is one of the editors found and is kept', async t => {
  const directory = createProfile(home, 'instructed'), launched: Launch[] = [];
  writeFileSync(join(directory, 'AGENTS.md'), '# instructed\n');
  const server = await startServer({ home, app: mkdtempSync(join(home, 'app-')), cwd, pi: { command: process.execPath, args: ['-e', ''] }, launcher: launch => launched.push(launch), editors: () => new Map([['zed', '/z'], ['finder', '/usr/bin/open']]) });
  const client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  assert.deepEqual(await client.request('editors', {}), { editors: [{ id: 'zed', label: 'Zed' }, { id: 'finder', label: 'Finder' }], current: 'zed' });
  await client.request('openInstructions', { profile: 'instructed' });
  assert.deepEqual(launched.pop(), { command: '/z', args: [join(directory, 'AGENTS.md')] });
  await client.request('setSettings', { editor: 'finder' });
  await client.request('openInstructions', { profile: 'instructed' });
  assert.deepEqual(launched.pop(), { command: '/usr/bin/open', args: ['-R', join(directory, 'AGENTS.md')] });
  await assert.rejects(client.request('setSettings', { editor: '/bin/sh' }), /No editor/);
  await assert.rejects(client.request('openInstructions', { profile: 'nobody' }), /No profile/);
  assert.equal(launched.length, 0);
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

test('a main chat a Pi outside the app holds names files in that Pi\'s folder, and in none when that Pi is on another machine', async t => {
  const there = realpathSync(mkdtempSync(join(home, 'there-')));
  mkdirSync(join(there, 'src'));
  writeFileSync(join(there, 'src', 'There.ts'), '');
  const server = await startServer({ home, cwd, pi: { command: process.execPath, args: ['-e', ''] }, launcher: () => {} });
  const client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  for (const [profile, host] of [['terminal', hostname()], ['remote', 'another-machine']]) {
    const unlock = await lockProfile(createProfile(home, profile), describeOwner({ profile, pid: process.pid, host, cwd: there }));
    t.after(() => unlock().catch(() => {}));
  }
  const terminal = (await client.request('open', { profile: 'terminal' })).window.id, remote = (await client.request('open', { profile: 'remote' })).window.id;
  assert.deepEqual(await client.request('isFile', { window: terminal, path: 'src/There.ts' }), { file: true });
  assert.deepEqual(await client.request('isFile', { window: terminal, path: 'src/App.tsx' }), { file: false });
  assert.deepEqual(await client.request('isFile', { window: remote, path: 'src/There.ts' }), { file: false });
  await assert.rejects(client.request('openFile', { window: remote, path: 'src/There.ts' }), /not a file/);
});
