import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { connect, type Client } from '../src/client.ts';
import type { Result } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { createProfile, issue, pullRequest as pull, temporaryHome } from './support.ts';

const home = temporaryHome();
const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
const gh = { command: process.execPath, args: [join(import.meta.dirname, 'fake-gh.ts')] };

type Said = [kind: string, text: string];
const bash = (command: string): Said => ['tool', `bash ${JSON.stringify({ command })}`];
/** Adds messages to a profile's log as pi-optchat writes them, a second apart; a call and its result share a message's time. */
function log(directory: string, said: Said[], from = 0) {
  mkdirSync(join(directory, 'main'), { recursive: true });
  appendFileSync(join(directory, 'main', '2026-03-05.jsonl'), said.map(([kind, text], at) => `${JSON.stringify({ i: from + at, kind, date: new Date(Date.UTC(2026, 2, 5, 10, 0, from + at)).toISOString(), text })}\n`).join(''));
}
/** What GitHub has, and a `gh` that is signed in to it; `calls` are the runs of `gh` so far, by their arguments. */
function github(t: TestContext, state: object) {
  const directory = mkdtempSync(join(home, 'gh-'));
  const set = (state: object) => writeFileSync(join(directory, 'gh.json'), JSON.stringify(state));
  set(state);
  const before = process.env.FAKE_GH_HOME;
  process.env.FAKE_GH_HOME = directory;
  t.after(() => { process.env.FAKE_GH_HOME = before; });
  const calls = (): string[][] => existsSync(join(directory, 'calls.jsonl')) ? readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { set, calls };
}
/** The list once GitHub has been heard on everything it can be: a look answers at once and asks behind it. */
async function settled(client: Client, profile: string, limit?: number): Promise<Result<'github'>> {
  for (;;) {
    const list = await client.request('github', { profile, limit });
    if (list.pending === 0 || list.gh !== 'ok') return list;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const names = (list: Result<'github'>) => list.items.map(item => `${item.repo}#${item.number}`);

test('the issues and pull requests the chat named by link are listed with what GitHub says: the open ones first, then the latest named', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'work');
  log(directory, [
    ['user', 'Look at https://github.com/acme/app/pull/1 and at https://github.com/acme/app/issues/2, please.'],
    ['talk', 'Both read. I opened https://github.com/acme/tools/pull/30 for the fix (see also https://github.com/acme/app/pull/1/files#diff-1).'],
    ['work', '[1a2b3c4d · The fix] Done in https://github.com/Acme/App/pull/4.\n\nFull chat: zoom("1a2b3c4d")'],
    // What a command about an item printed counts, and the command too; a list of other people's work, and a page that was read, do not.
    bash('cd app\nGH_PAGER= gh pr create --title "Docs" --body "..."'), ['echo', 'bash: https://github.com/acme/app/pull/5'],
    bash('gh pr list --json url'), ['echo', 'bash: [{"url":"https://github.com/acme/app/pull/90"},{"url":"https://github.com/acme/app/pull/91"}]'],
    // Nor a command that only speaks of one, nor one that lists beside it: nothing says which output is whose.
    bash('echo "see it with: gh pr view 93" && cat docs/ci.md'), ['echo', 'bash: see it with: gh pr view 93\nhttps://github.com/acme/app/pull/93'],
    bash('gh pr view 1 --json url && gh pr list --json url'), ['echo', 'bash: {"url":"https://github.com/acme/app/pull/1"}\n[{"url":"https://github.com/acme/app/pull/94"}]'],
    bash('gh issue view https://github.com/acme/app/issues/6'), ['echo', 'bash: title: Slow start\nstate: OPEN'],
    // Of what such a command printed, only the item's own address counts: its body and its comments name other people's.
    bash('gh pr view 5 --json body,url'), ['echo', `bash: ${JSON.stringify({ body: 'Refs https://github.com/other/dep/pull/81 and\nhttps://github.com/other/dep/pull/82', url: 'https://github.com/acme/app/pull/5' })}`],
    bash('gh pr view 4 --comments'), ['echo', 'bash: title:\tThe fix\nurl:\thttps://github.com/acme/app/pull/4\n--\nUpdates [dep](https://github.com/other/dep/pull/83), see\nhttps://github.com/other/dep/issues/84\n--\nauthor:\tsomeone\n--\nurl: https://github.com/other/dep/issues/85\n'],
    bash('curl -s https://example.com/blog'), ['echo', 'bash: ... as discussed in https://github.com/someone/else/pull/777 ...'],
    ['note', 'An older note about https://github.com/acme/app/pull/92.'],
    ['talk', 'The private one is https://github.com/secret/repo/pull/8, and https://github.com/acme/app/pull/999 never existed.'],
  ]);
  const { calls } = github(t, { items: {
    'acme/app#1': pull('Stop faster', 'MERGED', { reviewDecision: 'APPROVED', checks: 'SUCCESS' }), 'acme/app#2': issue('Server hangs on Ctrl+C', 'CLOSED'),
    'acme/tools#30': pull('Clear the timer', 'OPEN', { reviewDecision: 'APPROVED', checks: 'SUCCESS' }),
    'acme/app#4': pull('The fix', 'OPEN', { isDraft: true, checks: 'PENDING' }), 'acme/app#5': pull('Docs', 'OPEN', { reviewDecision: 'CHANGES_REQUESTED', checks: 'FAILURE' }),
    'acme/app#6': issue('Slow start', 'OPEN'),
  } });
  const server = await startServer({ home, cwd: home, pi, gh }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });

  // A look answers at once, with the items as the log names them and nothing of GitHub's yet.
  const first = await client.request('github', { profile: 'work' });
  assert.deepEqual([first.items.length, first.pending, first.items.some(item => item.title !== undefined)], [8, 8, false]);
  const list = await settled(client, 'work');
  // Open ones first, the latest named first among them; then the rest, the latest named first.
  assert.deepEqual(names(list), ['acme/app#4', 'acme/app#5', 'acme/app#6', 'acme/tools#30', 'secret/repo#8', 'acme/app#999', 'acme/app#1', 'acme/app#2']);
  assert.deepEqual([list.more, list.pending, list.gh], [0, 0, 'ok']);
  const item = (name: string) => { const { at: _at, ...rest } = list.items[names(list).indexOf(name)]; return rest; };
  assert.deepEqual(item('acme/app#5'), { repo: 'acme/app', number: 5, url: 'https://github.com/acme/app/pull/5', kind: 'pull', title: 'Docs', state: 'open', checks: 'failing', review: 'changes_requested' });
  // Named as Acme/App in the report and as acme/app after: one item, as it was last named.
  assert.deepEqual(item('acme/app#4'), { repo: 'acme/app', number: 4, url: 'https://github.com/acme/app/pull/4', kind: 'pull', title: 'The fix', state: 'draft', checks: 'pending' });
  assert.deepEqual(item('acme/tools#30'), { repo: 'acme/tools', number: 30, url: 'https://github.com/acme/tools/pull/30', kind: 'pull', title: 'Clear the timer', state: 'open', checks: 'passing', review: 'approved' });
  assert.deepEqual(item('acme/app#6'), { repo: 'acme/app', number: 6, url: 'https://github.com/acme/app/issues/6', kind: 'issue', title: 'Slow start', state: 'open' });
  // One that is merged says nothing of checks; named twice, it is there once, by the last message that names it.
  assert.deepEqual(item('acme/app#1'), { repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', kind: 'pull', title: 'Stop faster', state: 'merged' });
  assert.equal(list.items[names(list).indexOf('acme/app#1')].at, 1);
  // What GitHub does not have, or does not show to this login, is listed as the log names it.
  assert.deepEqual([item('secret/repo#8'), item('acme/app#999')], [
    { repo: 'secret/repo', number: 8, url: 'https://github.com/secret/repo/pull/8', kind: 'pull' }, { repo: 'acme/app', number: 999, url: 'https://github.com/acme/app/pull/999', kind: 'pull' }]);

  // `gh` was run once, with its arguments in a list, and asks github.com: the query names only those items.
  assert.equal(calls().length, 1);
  const [[...words]] = calls(), query = words.pop()!;
  assert.deepEqual(words, ['api', 'graphql', '--hostname', 'github.com', '-f']);
  assert.deepEqual([...new Set([...query.matchAll(/owner: "([^"]+)", name: "([^"]+)"/g)].map(([, owner, name]) => `${owner}/${name}`.toLowerCase()))].sort(), ['acme/app', 'acme/tools', 'secret/repo']);
  assert.doesNotMatch(query, /someone|other|9[0-4]|777/);

  // Looked at again, nothing is asked: what was said of them is fresh.
  await client.request('github', { profile: 'work' });
  assert.equal(calls().length, 1);
  // A minute on, those that may have changed are asked about again: the open ones, of which one has been merged since, and
  // those GitHub said nothing of. Not the ones that are merged or closed.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(60_000);
  const { set, calls: later } = github(t, { items: { 'acme/app#5': pull('Docs', 'MERGED'), 'acme/app#4': pull('The fix', 'OPEN', { checks: 'SUCCESS' }), 'acme/app#6': issue('Slow start', 'OPEN'), 'acme/tools#30': pull('Clear the timer', 'OPEN') } });
  assert.equal((await client.request('github', { profile: 'work' })).pending, 6);
  const again = await settled(client, 'work');
  assert.deepEqual([...later()[0].at(-1)!.matchAll(/issueOrPullRequest\(number: (\d+)\)/g)].map(([, number]) => Number(number)).sort((a, b) => a - b), [4, 5, 6, 8, 30, 999]);
  assert.deepEqual(names(again).slice(0, 4), ['acme/app#4', 'acme/app#6', 'acme/tools#30', 'secret/repo#8']);
  assert.partialDeepStrictEqual(again.items.find(item => item.number === 5), { state: 'merged' });
  assert.partialDeepStrictEqual(again.items.find(item => item.number === 4), { state: 'open', checks: 'passing' });

  // The chat goes on and names one more: only the new item is asked about.
  log(directory, [['talk', 'And https://github.com/acme/app/issues/7 is the follow-up.']], 21);
  set({ items: { 'acme/app#7': issue('Follow-up', 'OPEN') } });
  const more = await settled(client, 'work', 2);
  assert.deepEqual([names(more), more.more], [['acme/app#7', 'acme/app#4'], 7]);
  assert.deepEqual([...later().at(-1)!.at(-1)!.matchAll(/issueOrPullRequest\(number: (\d+)\)/g)].map(([, number]) => number), ['7']);
});

test('only an address on github.com names an item, and nothing else of the log reaches gh', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'hostile'), marker = join(home, 'made-by-a-shell');
  log(directory, [
    ['user', [
      `https://github.com/acme/app";touch ${marker};"/pull/1`, `https://github.com/acme/$(touch ${marker})/pull/2`, `https://github.com/acme/\`touch ${marker}\`/issues/3`,
      'https://github.com/acme/app/pull/4;touch', 'https://github.com/acme/app/pull/0', 'https://github.com/acme/app/pull/12345678901', 'https://github.com/acme/app/pull/5abc',
      'https://github.com/-acme/app/pull/6', 'https://github.com/acme/../pull/7', 'https://github.com/acme/app/pull/-8', 'https://github.com/acme/a pp/pull/9',
      'https://github.com.evil.example/acme/app/pull/10', 'https://evil.example/acme/app/pull/11', 'http://github.com/acme/app/pull/12', 'https://github.com/acme/app/pulls/13',
      'https://github.com/acme/app/pull/14 --jq .', 'https://github.com/acme/app") { id } } mutation { x: deleteRepository(input: {}) { y } } query { r: repository(owner: "a", name: "b/pull/15',
    ].join('\n')],
  ]);
  const { calls } = github(t, { items: { 'acme/app#4': pull('Four', 'OPEN'), 'acme/app#14': pull('Fourteen', 'MERGED') } });
  const server = await startServer({ home, cwd: home, pi, gh }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  const list = await settled(client, 'hostile');
  // The two that are whole addresses are the items; what stands after them is not part of them.
  assert.deepEqual(list.items.map(item => [item.url, item.title]), [['https://github.com/acme/app/pull/4', 'Four'], ['https://github.com/acme/app/pull/14', 'Fourteen']]);
  assert.equal(calls().length, 1);
  assert.doesNotMatch(calls()[0].at(-1)!, /touch|mutation|jq|evil/);
  assert.equal(existsSync(marker), false, 'no shell ran anything of the log');
});

test('without the GitHub CLI, or signed out of it, the list is still there, and says which', { timeout: 30_000 }, async t => {
  const directory = createProfile(home, 'bare');
  log(directory, [['talk', 'See https://github.com/acme/app/pull/1.']]);
  const expected = [{ repo: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1', kind: 'pull', at: 0 }];
  const look = async (gh: { command: string; args: string[] }) => {
    const server = await startServer({ home, cwd: home, pi, gh }), client = await connect(server.url);
    try { return await settled(client, 'bare'); } finally { client.close(); await server.close(); }
  };
  assert.deepEqual(await look({ command: join(home, 'no-such-gh'), args: [] }), { items: expected, more: 0, pending: 1, gh: 'missing' });
  const { set } = github(t, { items: {}, signedOut: true });
  assert.deepEqual(await look(gh), { items: expected, more: 0, pending: 1, gh: 'signed_out' });
  set({ items: {}, fails: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com' });
  assert.deepEqual(await look(gh), { items: expected, more: 0, pending: 1, gh: 'failed', message: 'error connecting to api.github.com' });

  // Signed in since: a look that asks for it tries at once and waits for the answer, so it is the one that has the status.
  set({ items: {}, signedOut: true });
  const server = await startServer({ home, cwd: home, pi, gh }), client = await connect(server.url);
  t.after(async () => { client.close(); await server.close(); });
  assert.equal((await settled(client, 'bare')).gh, 'signed_out');
  set({ items: { 'acme/app#1': pull('One', 'OPEN') } });
  // One that does not ask for it leaves a `gh` that just failed alone for a few seconds.
  assert.equal((await client.request('github', { profile: 'bare' })).gh, 'signed_out');
  assert.deepEqual(await client.request('github', { profile: 'bare', fresh: true }), { items: [{ ...expected[0], title: 'One', state: 'open' }], more: 0, pending: 0, gh: 'ok' });
});
