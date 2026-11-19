import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CAP, listing, mentions } from '../src/server/mentions.ts';
import { mention, mentioned } from '../src/ui/mentions.ts';
import { temporaryHome } from './support.ts';

const home = temporaryHome();
const put = (root: string, files: string[]) => { for (const file of files) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), ''); } };
const paths = async (cwd: string, query: string) => (await mentions(cwd, query)).map(({ path, dir }) => dir ? `${path}/` : path);

test('in a git repository the files are git\'s, with what .gitignore leaves out left out, and the best match first', async () => {
  const repo = mkdtempSync(join(home, 'repo-'));
  put(repo, ['src/ui/Composer.tsx', 'src/ui/Commands.tsx', 'src/server/server.ts', 'README.md', 'dist/index.js', 'secret.env']);
  writeFileSync(join(repo, '.gitignore'), 'dist/\n*.env\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  // Nothing typed: what is at the top, its folders first. The ignored are nowhere, the untracked are there.
  assert.deepEqual(await paths(repo, ''), ['src/', '.gitignore', 'README.md', 'src/server/', 'src/ui/', 'src/server/server.ts', 'src/ui/Commands.tsx', 'src/ui/Composer.tsx']);
  assert.deepEqual((await paths(repo, 'compo'))[0], 'src/ui/Composer.tsx');
  for (const query of ['dist', 'secret']) assert.ok(!(await paths(repo, query)).some(path => path.startsWith(query)), query);
  // Typed up to a `/`, the folder's own.
  assert.deepEqual(await paths(repo, 'src/ui/'), ['src/ui/Commands.tsx', 'src/ui/Composer.tsx']);
});

test('a name that begins with what is typed comes before one that only has it in it, however much longer it is', async () => {
  const folder = mkdtempSync(join(home, 'ranked-'));
  put(folder, ['xcomp.ts', 'component-controller.ts']);
  assert.deepEqual(await paths(folder, 'comp'), ['component-controller.ts', 'xcomp.ts']);
});

test('outside a repository the folder is walked without node_modules and dot-folders, to the cap', async () => {
  const plain = mkdtempSync(join(home, 'plain-'));
  put(plain, ['notes.md', 'node_modules/left/index.js', '.cache/x', 'deep/er/file.ts', '.env']);
  assert.deepEqual(await paths(plain, ''), ['deep/', '.env', 'notes.md', 'deep/er/', 'deep/er/file.ts']);
  const many = mkdtempSync(join(home, 'many-'));
  put(many, Array.from({ length: CAP + 50 }, (_, k) => `f${k}`));
  assert.equal((await listing(many)).length, CAP);
  assert.equal((await mentions(many, 'f1')).length, 20);
});

test('in a git repository with more files than the cap, the cap holds too', async () => {
  const repo = mkdtempSync(join(home, 'big-'));
  put(repo, Array.from({ length: CAP + 50 }, (_, k) => `f${k}`));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  assert.equal((await listing(repo)).length, CAP);
});

test('nothing outside the window\'s folder is listed: no absolute path, no ~, no ..', async () => {
  const cwd = mkdtempSync(join(home, 'cwd-'));
  for (const query of ['/etc/', '~/', '../', 'src/../../', '..', 'a\\b'])
    await assert.rejects(mentions(cwd, query), /Only a file in the folder this chat runs in/, query);
});

test('an @ is read at the caret, at the start or after a space, and a path with a space in it is quoted as Pi quotes it', () => {
  const at = (text: string, caret = text.length) => mentioned(text, caret);
  assert.deepEqual(at('@'), { start: 0, query: '', quoted: false });
  assert.deepEqual(at('look at @src/ui'), { start: 8, query: 'src/ui', quoted: false });
  assert.deepEqual(at('look at @src and more', 12), { start: 8, query: 'src', quoted: false });
  assert.deepEqual(at('one\n@a'), { start: 4, query: 'a', quoted: false });
  assert.deepEqual(at('see @"my fi'), { start: 4, query: 'my fi', quoted: true });
  // A quote earlier in the message is no part of it.
  assert.deepEqual(at('the 12" one and @"my d'), { start: 16, query: 'my d', quoted: true });
  assert.deepEqual(at('x @a @b'), { start: 5, query: 'b', quoted: false });
  for (const text of ['jonas@kahoot.com', 'a @b c', '@"done" ', '/skill'])
    assert.equal(at(text), undefined, text);

  const typed = 'see @co please';
  assert.deepEqual(mention(typed, 7, at(typed, 7)!, { path: 'src/ui/Composer.tsx', dir: false }), { text: 'see @src/ui/Composer.tsx  please', caret: 25 });
  assert.deepEqual(mention('@sr', 3, at('@sr')!, { path: 'src', dir: true }), { text: '@src/', caret: 5 });
  // Picked with the caret inside a path, the whole path is the one picked.
  assert.deepEqual(mention('@src/ui and', 4, at('@src/ui and', 4)!, { path: 'src/server.ts', dir: false }), { text: '@src/server.ts  and', caret: 15 });
  assert.deepEqual(mention('@my', 3, at('@my')!, { path: 'my file.txt', dir: false }), { text: '@"my file.txt" ', caret: 15 });
  // A quoted folder keeps the caret before its closing quote, for the file in it.
  assert.deepEqual(mention('@"my d"', 6, at('@"my d"', 6)!, { path: 'my dir', dir: true }), { text: '@"my dir/"', caret: 9 });
});
