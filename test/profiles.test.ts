import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Profiles } from '../src/server/profiles.ts';
import { startServer } from '../src/server/server.ts';
import { createProfile, temporaryHome, writeMemory } from './support.ts';

const home = temporaryHome(), profiles = new Profiles(home);
/** Every file under a directory with its size and when it last changed. */
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(f => {
  const path = join(directory, f.name), stat = statSync(path);
  return f.isDirectory() ? [path, ...files(path)] : [`${path} ${stat.size} ${stat.mtimeMs}`];
});
const entry = (i: number, text: string, more = {}) => `${JSON.stringify({ i, kind: 'user', date: '2026-01-02T00:00:00.000Z', text, ...more })}\n`;

test('a long history is paged from disk, and reading a profile writes nothing to it', async () => {
  const directory = createProfile(home, 'long');
  writeMemory(directory, 20_000);
  const before = files(directory);

  const newest = profiles.history({ profile: 'long' });
  assert.equal(newest.total, 20_000);
  assert.deepEqual(newest.messages.map(m => m.i), Array.from({ length: 50 }, (_, k) => 19_950 + k));
  assert.deepEqual(newest.messages.at(-1), { i: 19_999, kind: 'talk', date: '2026-01-01T05:33:19.000Z', text: 'message 19999' });
  const older = profiles.history({ profile: 'long', before: newest.messages[0].i, limit: 100 });
  assert.deepEqual([older.messages[0].i, older.messages.at(-1)?.i, older.messages.length], [19_850, 19_949, 100]);
  assert.deepEqual((profiles.history({ profile: 'long', before: 3 })).messages.map(m => m.i), [0, 1, 2]);

  profiles.view({ profile: 'long' });
  assert.deepEqual(files(directory), before);
  assert.deepEqual(profiles.list(), { profiles: [{ name: 'long' }] });
});

test('the view tiles the whole log, and a line opens into the two under it', async () => {
  writeMemory(createProfile(home, 'tree'), 20_000, i => `message ${i} ${'x'.repeat(200)}`);
  const { total, lines } = profiles.view({ profile: 'tree' });
  let covered = 0;
  for (const line of lines) { assert.equal(line.id, covered); covered += line.n; }
  assert.equal(covered, total);
  const { n } = lines[0], half = n / 2;
  assert.ok(n >= 2 && lines.length < total / 4, 'the old end of a long log is folded into summaries');
  assert.equal(lines[0].text, `summary of 0+${n}`);

  assert.deepEqual(profiles.zoom({ profile: 'tree', id: 0, n }), { lines: [{ id: 0, n: half, text: `summary of 0+${half}` }, { id: half, n: half, text: `summary of ${half}+${half}` }] });
  assert.match((profiles.zoom({ profile: 'tree', id: 6, n: 2 })).lines[1].text ?? '', /^talk: message 7 /);
  assert.throws(() => profiles.zoom({ profile: 'tree', id: 3, n: 2 }), /No line 3\+2/);
});

test('a summary the owning Pi has not built yet is a line without text: the app summarizes nothing', async () => {
  const directory = createProfile(home, 'unbuilt'), long = 'long '.repeat(200);
  mkdirSync(join(directory, 'main'));
  writeFileSync(join(directory, 'main', '2026-01-02.jsonl'), [0, 1, 2, 3].map(i => entry(i, long)).join(''));
  assert.deepEqual((profiles.view({ profile: 'unbuilt' })).lines, [0, 1, 2, 3].map(id => ({ id, n: 1, text: undefined })));
});

test('what the owning Pi wrote since the last read is there on the next one', async () => {
  const directory = createProfile(home, 'live');
  writeMemory(directory, 2);
  assert.equal((profiles.history({ profile: 'live' })).total, 2);
  appendFileSync(join(directory, 'main', '2026-01-01.jsonl'), entry(2, 'a new message'));
  assert.partialDeepStrictEqual((profiles.history({ profile: 'live' })).messages.at(-1), { i: 2, text: 'a new message' });
});

test('after an import the active memory generation is read, and an old import\'s header is not part of its message', async () => {
  const directory = createProfile(home, 'imported'), generation = 'memories/123e4567-e89b-42d3-a456-426614174000';
  writeMemory(directory, 4);
  mkdirSync(join(directory, generation, 'main'), { recursive: true });
  const origin = { source: 'claude', conversation: 'c', message: 'm', title: 'An old chat' };
  writeFileSync(join(directory, generation, 'main', '2026-01-02.jsonl'),
    entry(0, '[Historical claude · 2026-03-27T13:24:25.262Z · conversation 5f130903 · An old chat]\nwhat it said', { origin }));
  writeFileSync(join(directory, 'active-memory.json'), JSON.stringify(generation));
  assert.deepEqual((profiles.history({ profile: 'imported' })).messages, [{ i: 0, kind: 'user', date: '2026-01-02T00:00:00.000Z', text: 'what it said', origin }]);
});

test('a profile\'s images are served over HTTP', async t => {
  const directory = createProfile(home, 'pictures'), png = Buffer.from('not really a png');
  mkdirSync(join(directory, 'images'));
  writeFileSync(join(directory, 'images', '0123456789abcdef.png'), png);
  const server = await startServer({ home });
  t.after(() => server.close());
  const image = await fetch(`http://127.0.0.1:${server.port}/images/pictures/0123456789abcdef`);
  assert.deepEqual([image.status, image.headers.get('content-type'), Buffer.from(await image.arrayBuffer())], [200, 'image/png', png]);
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/images/pictures/fedcba9876543210`)).status, 404);
});
