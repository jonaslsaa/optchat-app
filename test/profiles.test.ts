import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'node:http';
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

  const newest = await profiles.history({ profile: 'long' });
  assert.equal(newest.total, 20_000);
  assert.deepEqual(newest.messages.map(m => m.i), Array.from({ length: 50 }, (_, k) => 19_950 + k));
  assert.deepEqual(newest.messages.at(-1), { i: 19_999, kind: 'talk', date: '2026-01-01T05:33:19.000Z', text: 'message 19999' });
  const older = await profiles.history({ profile: 'long', before: newest.messages[0].i, limit: 100 });
  assert.deepEqual([older.messages[0].i, older.messages.at(-1)?.i, older.messages.length], [19_850, 19_949, 100]);
  assert.deepEqual((await profiles.history({ profile: 'long', before: 3 })).messages.map(m => m.i), [0, 1, 2]);

  await profiles.view({ profile: 'long' });
  assert.deepEqual(files(directory), before);
  assert.deepEqual(profiles.list(), { profiles: [{ name: 'long' }] });
});

test('the view tiles the whole log, and a line opens into the two under it', async () => {
  writeMemory(createProfile(home, 'tree'), 20_000, i => `message ${i} ${'x'.repeat(200)}`);
  const { memory, total, lines, size, budget } = await profiles.view({ profile: 'tree' });
  assert.equal(memory, 'tree 2026-01-01T00:00:00.000Z', 'which memory it is: the directory it is in, and when it begins');
  let covered = 0;
  for (const line of lines) { assert.equal(line.id, covered); covered += line.n; }
  assert.equal(covered, total);
  const { n } = lines[0], half = n / 2;
  assert.ok(n >= 2 && lines.length < total / 4, 'the old end of a long log is folded into summaries');
  assert.equal(lines[0].text, `summary of 0+${n}`);

  // The view is what the agent reads, and as much as it reads: its bytes, of the budget pi-optchat keeps it under.
  assert.ok(size > 0 && size <= budget && budget === 128_000, `${size} of ${budget}`);
  // A line says when its messages were said (one a second here), from the first of them to the last.
  const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
  assert.deepEqual([lines[0].from, lines[0].to], [at(0), at(n - 1)]);
  assert.deepEqual(await profiles.zoom({ profile: 'tree', id: 0, n }), { lines: [{ id: 0, n: half, text: `summary of 0+${half}`, from: at(0), to: at(half - 1) }, { id: half, n: half, text: `summary of ${half}+${half}`, from: at(half), to: at(n - 1) }] });
  assert.match((await profiles.zoom({ profile: 'tree', id: 6, n: 2 })).lines[1].text ?? '', /^talk: message 7 /);
  await assert.rejects(profiles.zoom({ profile: 'tree', id: 3, n: 2 }), /No line 3\+2/);
});

test('a summary the owning Pi has not built yet is a line without text: the app summarizes nothing', async () => {
  const directory = createProfile(home, 'unbuilt'), long = 'long '.repeat(200);
  mkdirSync(join(directory, 'main'));
  writeFileSync(join(directory, 'main', '2026-01-02.jsonl'), [0, 1, 2, 3].map(i => entry(i, long)).join(''));
  assert.deepEqual((await profiles.view({ profile: 'unbuilt' })).lines, [0, 1, 2, 3].map(id => ({ id, n: 1, text: undefined, from: '2026-01-02T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' })));
});

test('a message is answered as it was said, a tool call with what it printed; and a line of imported history by its earliest and latest message', async () => {
  const directory = createProfile(home, 'said'), day = (d: number) => `2026-03-0${d}T10:00:00.000Z`;
  // Two calls and their results, as pi-optchat logs a step: the calls in a run, the results after them in the same order.
  const said: [kind: string, text: string, date: string][] = [
    ['user', 'check both', day(5)], ['tool', 'bash {"command":"ls"}', day(5)], ['tool', 'read {"path":"a.txt"}', day(5)], ['echo', 'bash: a.txt', day(5)], ['echo', 'read: hello', day(5)],
    ['talk', 'Both are there.', day(5)], ['user', 'an old one, imported later', day(2)], ['tool', 'bash {"command":"sleep 9"}', day(7)],
    // A message that says something between its calls, and a call that ended in an error of the agent's, not in a result.
    ['tool', 'bash {"command":"pwd"}', day(8)], ['talk', 'and the file', day(8)], ['tool', 'read {"path":"b.txt"}', day(8)], ['echo', 'bash: /tmp', day(8)], ['echo', 'read: world', day(8)],
    ['tool', 'bash {"command":"make"}', day(9)], ['echo', 'Agent error: 529 overloaded', day(9)],
  ];
  mkdirSync(join(directory, 'main')); mkdirSync(join(directory, 'tree'));
  writeFileSync(join(directory, 'main', '2026-03-05.jsonl'), said.map(([kind, text, date], i) => `${JSON.stringify({ i, kind, date, text })}\n`).join(''));
  writeFileSync(join(directory, 'tree', '2026-03-05.jsonl'), `${JSON.stringify({ l: 3, i: 0, text: 'all eight', size: 9 })}\n`);
  writeFileSync(join(directory, 'view.json'), JSON.stringify({ parts: [[3, 0]], merging: false }));
  assert.deepEqual((await profiles.view({ profile: 'said' })).lines[0], { id: 0, n: 8, text: 'all eight', from: day(2), to: day(7) });

  const original = async (id: number) => (await profiles.original({ profile: 'said', id })).messages.map(message => message.i);
  assert.deepEqual((await profiles.original({ profile: 'said', id: 0 })).messages, [{ i: 0, kind: 'user', date: day(5), text: 'check both' }]);
  assert.deepEqual([await original(5), await original(6)], [[5], [6]]);
  // A call comes with what it printed, and what it printed with the call: the two are one row of the chat.
  assert.deepEqual([await original(1), await original(3), await original(2), await original(4)], [[1, 3], [1, 3], [2, 4], [2, 4]]);
  assert.deepEqual(await original(7), [7], 'a call that never printed is there alone');
  assert.deepEqual([await original(8), await original(11), await original(10), await original(12), await original(9)], [[8, 11], [8, 11], [10, 12], [10, 12], [9]]);
  assert.deepEqual([await original(13), await original(14)], [[13], [14]], 'an error of the agent\'s is no result of the call before it');
  await assert.rejects(profiles.original({ profile: 'said', id: 15 }), /No message 15: the log has 15\./);
});

test('what the owning Pi wrote since the last read is there on the next one', async () => {
  const directory = createProfile(home, 'live');
  writeMemory(directory, 2);
  assert.equal((await profiles.history({ profile: 'live' })).total, 2);
  appendFileSync(join(directory, 'main', '2026-01-01.jsonl'), entry(2, 'a new message'));
  assert.partialDeepStrictEqual((await profiles.history({ profile: 'live' })).messages.at(-1), { i: 2, text: 'a new message' });
});

test('a log that could not be read is read again, though its size is the same', async () => {
  const directory = createProfile(home, 'torn'), log = join(directory, 'main', '2026-01-01.jsonl');
  writeMemory(directory, 2);
  const whole = readFileSync(log, 'utf8');
  writeFileSync(log, whole.replace('"kind"', '"kind!'));
  await assert.rejects(profiles.history({ profile: 'torn' }));
  writeFileSync(log, whole);
  assert.equal((await profiles.history({ profile: 'torn' })).total, 2);
});

test('after an import the active memory generation is read, and an old import\'s header is not part of its message', async () => {
  const directory = createProfile(home, 'imported'), generation = 'memories/123e4567-e89b-42d3-a456-426614174000';
  writeMemory(directory, 4);
  mkdirSync(join(directory, generation, 'main'), { recursive: true });
  const origin = { source: 'claude', conversation: 'c', message: 'm', title: 'An old chat' };
  writeFileSync(join(directory, generation, 'main', '2026-01-02.jsonl'),
    entry(0, '[Historical claude · 2026-03-27T13:24:25.262Z · conversation 5f130903 · An old chat]\nwhat it said', { origin }));
  writeFileSync(join(directory, 'active-memory.json'), JSON.stringify(generation));
  assert.deepEqual((await profiles.history({ profile: 'imported' })).messages, [{ i: 0, kind: 'user', date: '2026-01-02T00:00:00.000Z', text: 'what it said', origin }]);
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
  // A page whose own name points at this machine is refused by that name.
  const status = await new Promise(resolve => get({ port: server.port, path: '/images/pictures/0123456789abcdef', headers: { host: 'rebound.example' } }, response => resolve(response.statusCode)));
  assert.equal(status, 404);
});

test('a search finds the messages that say the text as the agent\'s own search does: newest first, a page at a time, in any case', async () => {
  const directory = createProfile(home, 'found'), log = join(directory, 'main', '2026-01-01.jsonl');
  // Fifty messages name the town, and one long one says something else in the middle of itself.
  writeMemory(directory, 100, i => i === 40 ? `${'before '.repeat(20)}BLÅBÆRSYLTETØY${' after'.repeat(60)}` : i % 2 ? `reply ${i}` : `Vi møtes i Århus, ${i}`);
  // The agent's own looks into its memory are in the log too, and only copy it.
  const call = (i: number, kind: string, text: string) => `${JSON.stringify({ i, kind, date: '2026-01-02T00:00:00.000Z', text })}\n`;
  appendFileSync(log, call(100, 'tool', 'search {"text":"Århus"}') + call(101, 'echo', 'search: 49 messages contain "Århus", newest first'));

  const newest = await profiles.search({ profile: 'found', text: 'århus' });
  assert.deepEqual([newest.hits.map(hit => hit.id), newest.more], [Array.from({ length: 20 }, (_, k) => 98 - 2 * k), 29]);
  assert.deepEqual(newest.hits[0], { id: 98, kind: 'user', date: '2026-01-01T00:01:38.000Z', lead: 'Vi møtes i ', match: 'Århus', rest: ', 98' });
  const older = await profiles.search({ profile: 'found', text: 'århus', before: 60 });
  assert.deepEqual([older.hits[0].id, older.hits.at(-1)?.id, older.more], [58, 18, 9]);
  assert.deepEqual((await profiles.search({ profile: 'found', text: 'ÅRHUS', before: 4 })).hits.map(hit => hit.id), [2, 0]);

  // Of a long message, the stretch around where it says it, with the words as the message writes them.
  const { hits: [long], more } = await profiles.search({ profile: 'found', text: 'blåbærsyltetøy' });
  assert.deepEqual([long.id, more, long.match], [40, 0, 'BLÅBÆRSYLTETØY']);
  assert.deepEqual([long.lead, long.rest.length, long.rest.slice(0, 12), long.rest.at(-1)], [`…${'before '.repeat(20).slice(-40)}`, 161, ' after after', '…']);
  assert.deepEqual(await profiles.search({ profile: 'found', text: 'Aarhus' }), { hits: [], more: 0 });
});
