import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { Push, WindowState } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { transcript } from '../src/ui/agents.ts';
import { building, listed, path, polled } from '../src/ui/memory.ts';
import { cite, citing } from '../src/ui/cite.ts';
import { App, cutOffShown, title, UNTITLED, type State } from '../src/ui/store.ts';
import { chat } from '../src/ui/transcript.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { createProfile, temporaryHome, writeMemory, writeRun } from './support.ts';

const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
/** The page's store, without a page: what it would keep in the browser stays in `saved`. */
function page(t: TestContext, retry = 1000, poll = 3000, saved = new Map<string, string>()) {
  const app = new App({ retry, poll, storage: () => ({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); } }) });
  t.after(() => app.close());
  const until = (met: (state: State) => boolean) => new Promise<State>(resolve => {
    const check = () => { if (met(app.state)) { stop(); resolve(app.state); } };
    const stop = app.subscribe(check);
    check();
  });
  return { app, saved, until };
}
const directory = temporaryHome();
createProfile(directory, 'work');

test('a server that is away is tried again one connection at a time, and found once it is back', async t => {
  // Something that takes connections and drops them, as a server that is restarting does.
  let attempts = 0;
  const away = createServer(socket => { attempts++; socket.destroy(); });
  await new Promise<void>(resolve => away.listen(0, '127.0.0.1', resolve));
  const { port } = away.address() as { port: number };
  const { app, until } = page(t, 25);
  void app.start(`ws://127.0.0.1:${port}/ws?token=back`);
  await sleep(500);
  await new Promise(resolve => away.close(resolve));
  // One try every 25 ms and its connection: retries that doubled would be in the thousands by now.
  assert.ok(attempts >= 3 && attempts <= 21, `${attempts} attempts`);

  // Back with the token it had: one it starts with anew refuses a page from before (below).
  const server = await startServer({ port, home: directory, cwd: directory, pi, token: 'back' });
  t.after(() => server.close());
  assert.deepEqual((await until(state => state.connection === 'open' && state.windows.length > 0)).windows.map(window => window.id), ['work/main']);
});

test('a server that started again numbers its records from one, and the page follows them', async t => {
  const first = await startServer({ home: directory, cwd: directory, pi, token: 'again' });
  const { app, until } = page(t, 25);
  const answered = (replies: number) => until(state => state.windows[0]?.status === 'idle' && state.logs.work?.entries.filter(entry => entry.kind === 'talk').length === replies);
  await app.start(first.url);
  await until(state => state.windows.length > 0);
  await app.send('work/main', 'hello');
  const before = (await answered(1)).live['work/main'].seq;
  await first.close();
  await until(state => state.connection === 'lost');
  // What is asked meanwhile fails quietly: that the server is away is said once, by the connection.
  assert.equal(await app.send('work/main', 'anyone there?'), false);
  assert.equal(app.state.error, undefined);

  const second = await startServer({ port: first.port, home: directory, cwd: directory, pi, token: 'again' });
  t.after(() => second.close());
  await until(state => state.connection === 'open' && state.windows.length > 0);
  await app.send('work/main', 'hello again');
  const after = await answered(2);
  // The new server's window began at one again; records under the old number were not taken for ones already seen.
  assert.ok(after.live['work/main'].seq <= before, `${after.live['work/main'].seq} after ${before}`);
  assert.deepEqual(after.live['work/main'].messages.map(message => message.role), ['user', 'assistant']);

  // One that starts with a token of its own, as every start does, refuses the page, which says so and stops trying.
  await second.close();
  const third = await startServer({ port: first.port, home: directory, cwd: directory, pi });
  t.after(() => third.close());
  await until(state => state.connection === 'refused');
  // Not even once the server with the page's token is back.
  await third.close();
  const fourth = await startServer({ port: first.port, home: directory, cwd: directory, pi, token: 'again' });
  t.after(() => fourth.close());
  await sleep(250);
  assert.equal(app.state.connection, 'refused');
});

test('a dialog goes when its time is up, when its answer has arrived, and with its window', async t => {
  const { app, until } = page(t);
  const window = (status: WindowState['status']): Push => ({ push: 'window', window: { id: 'work/1', profile: 'work', role: 'connected', cwd: '/tmp', status, seq: 0 } });
  app.receive(window('idle'));
  const ask = (id: string, timeout?: number): Push => ({ push: 'record', window: 'work/1', seq: id === 'a' ? 1 : 2, record: { type: 'extension_ui_request', id, method: 'confirm', title: 'Go on?', ...timeout && { timeout } } });
  app.receive(ask('a', 30));
  app.receive(ask('b'));
  assert.deepEqual(app.state.live['work/1'].dialogs.map(dialog => dialog.id), ['a', 'b']);
  // No window is shown here: the time runs in the store, not in the dialog on the page.
  assert.deepEqual((await until(state => state.live['work/1'].dialogs.length === 1)).live['work/1'].dialogs.map(dialog => dialog.id), ['b']);
  // An answer that did not reach the server (there is none here) leaves the question to be answered again.
  await app.answer('work/1', { id: 'b', confirmed: true });
  assert.deepEqual([app.state.live['work/1'].dialogs.length, app.state.error], [1, 'Not connected to the server.']);
  app.receive(window('closed'));
  assert.deepEqual([app.state.windows, app.state.live], [[], {}]);
});

test('what is typed and not sent is there when the page is opened again, until it is sent or its window is gone', async t => {
  const { app, saved } = page(t);
  app.keep('work/main', 'half a thought');
  app.keep('work/1', 'for the other window');
  app.keep('work/2', 'sent in a moment');
  // The page opened again: another store over what the browser kept.
  const { app: again, until } = page(t, undefined, undefined, saved);
  assert.deepEqual([again.draft('work/main'), again.draft('work/1'), again.draft('work/3')], ['half a thought', 'for the other window', '']);
  // Sent, the box is empty, and nothing of it is kept; nor of a window that is closed.
  again.keep('work/2', '');
  again.receive({ push: 'window', window: { id: 'work/1', profile: 'work', role: 'connected', cwd: '/tmp', status: 'closed', seq: 0 } });
  assert.deepEqual(JSON.parse(saved.get('optchat-app-drafts')!), { 'work/main': 'half a thought' });
  // A server that started again has the main chat and none of the other windows, and numbers new ones from one. What was
  // typed in a window it does not have is let go before a new window can have its number; the main chat's stays.
  again.keep('work/1', 'typed before the server started again');
  const server = await startServer({ home: directory, cwd: directory, pi });
  t.after(() => server.close());
  await again.start(server.url);
  await until(state => state.connection === 'open');
  assert.deepEqual([again.draft('work/1'), again.draft('work/main')], ['', 'half a thought']);
});

test('records the page missed are read again from the server, so it shows what a page that saw them all shows', async t => {
  const server = await startServer({ home: directory, cwd: directory, pi });
  t.after(() => server.close());
  const whole = page(t), gaps = page(t);
  // One page loses what the agent said: every record of its reply's messages but the first.
  const receive = gaps.app.receive.bind(gaps.app), dropped: number[] = [];
  gaps.app.receive = (push: Push) => {
    if (push.push === 'record' && (push.record.type === 'message_update' || push.record.type === 'message_end')) dropped.push(push.seq); else receive(push);
  };
  await Promise.all([whole, gaps].map(async ({ app, until }) => { await app.start(server.url); await until(state => state.windows.length > 0); }));
  const logged = whole.app.state.logs.work.total;
  const settled = ({ until }: typeof whole) => until(state => state.windows[0].status === 'idle' && state.live['work/main']?.running === false && state.logs.work?.total === logged + 2);

  assert.equal(await whole.app.send('work/main', 'hello'), true);
  const [seen, caught] = await Promise.all([settled(whole), settled(gaps)]);
  assert.ok(dropped.length > 0);
  assert.deepEqual(caught.live, seen.live);
  assert.deepEqual(caught.logs, seen.logs);
  assert.equal(seen.live['work/main'].messages.length, 2);
});

test('a sign-in waits for Pi to say it is done, and stops asking when you cancel', async t => {
  const folder = process.env.FAKE_PI_HOME = mkdtempSync(join(directory, 'pi-')), state = join(folder, 'state.json'), opened = join(folder, 'opened.txt');
  t.after(() => { delete process.env.FAKE_PI_HOME; });
  writeFileSync(state, JSON.stringify({ version: '1.5.2', providers: [], packages: {} }));
  // In place of the terminal: it notes the file it was asked to open, and each time Pi is asked is noted too.
  const opener = { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(opened)}, process.argv[1])`] };
  const appFolder = mkdtempSync(join(directory, 'app-')), script = join(appFolder, 'sign-in-openai-codex.command');
  const server = await startServer({ home: directory, app: appFolder, cwd: directory, pi, opener });
  t.after(() => server.close());
  const { app, until } = page(t, 1000, 20);
  await app.start(server.url);
  await until(state => state.setup?.login.state === 'missing');

  // Two clicks: the page waits for the one made last, whichever the server answers first, and from the click on.
  void app.signIn('github-copilot');
  void app.signIn('openai-codex');
  assert.equal(app.state.signingIn, 'openai-codex');
  while (!existsSync(script) || !existsSync(opened)) await sleep(10);
  await sleep(50);
  assert.equal(app.state.signingIn, 'openai-codex');
  assert.match(readFileSync(script, 'utf8'), / auth login openai-codex\n/);
  await sleep(100);
  assert.equal(app.state.signingIn, 'openai-codex', 'it waits while Pi says not yet');
  // You finish in the terminal: Pi says so, and the setup is looked at again.
  writeFileSync(state, JSON.stringify({ version: '1.5.2', providers: ['openai-codex'], packages: {} }));
  const done = await until(state => !state.signingIn);
  assert.deepEqual(done.setup?.login.providers, ['openai-codex']);

  // Cancelled, it asks no more: Pi being ready later changes nothing by itself.
  writeFileSync(state, JSON.stringify({ version: '1.5.2', providers: [], packages: {} }));
  await app.checkSetup(true);
  void app.signIn('anthropic');
  await sleep(50);
  app.cancelSignIn();
  writeFileSync(state, JSON.stringify({ version: '1.5.2', providers: ['anthropic'], packages: {} }));
  await sleep(150);
  assert.equal(app.state.setup?.login.state, 'missing');

  // Pi that cannot read its own logins ends the wait, and the page says why instead of going quiet.
  writeFileSync(state, JSON.stringify({ version: '1.5.2', providers: [], packages: {}, broken: true }));
  await app.signIn('github-copilot');
  assert.equal(app.state.signingIn, undefined);
  assert.match(app.state.error ?? '', /Pi could not say whether it is signed in\. Try in a terminal: .*fake-pi\.ts auth check --provider github-copilot$/);
});

test('the first profile is made from the page: pi-optchat makes it, and it opens', async t => {
  const home = temporaryHome();
  const server = await startServer({ home, app: mkdtempSync(join(home, 'app-')), cwd: home, pi });
  t.after(() => server.close());
  const { app } = page(t);
  await app.start(server.url);
  assert.deepEqual([app.state.profiles, app.state.profile], [[], undefined]);

  // What makes a name is pi-optchat's to say, and the page says it after it: where the name was typed, not over the page.
  assert.match(await app.createProfile('My Chat') ?? '', /Profile names: 1–64 lowercase letters, digits, hyphens, or underscores\./);
  assert.match(await app.createProfile('../elsewhere') ?? '', /Profile names:/);
  assert.equal(app.state.error, undefined);
  assert.equal(existsSync(join(home, 'profiles')), false, 'and nothing is written for a name that will not do');

  assert.equal(await app.createProfile('first'), undefined);
  assert.deepEqual([app.state.profiles, app.state.profile], [['first'], undefined], 'it is there to open');
  await app.openProfile('first');
  assert.deepEqual([app.state.profiles, app.state.profile, app.state.windows.map(window => window.id)], [['first'], 'first', ['first/main']]);
  // The profile is pi-optchat's own: its settings and its instructions, where pi-optchat keeps them.
  assert.deepEqual(readdirSync(join(home, 'profiles', 'first')).sort(), ['AGENTS.md', 'config.json']);
  assert.equal(await app.send('first/main', 'hello'), true);
  // One that is there is not made again, nor written over.
  assert.match(await app.createProfile('first') ?? '', /Profile already exists: first/);
  // A second profile is opened beside the first, which stays open with its window.
  assert.equal(await app.createProfile('second'), undefined);
  await app.openProfile('second');
  assert.deepEqual([app.state.profiles, app.state.tabs, app.state.profile, app.state.windows.map(window => window.id).sort()], [['first', 'second'], ['first', 'second'], 'second', ['first/main', 'second/main']]);
});

test('an agent\'s chat is read on from where the page has it, and a report that is not its last answer closes it', async t => {
  const profile = createProfile(directory, 'team'), server = await startServer({ home: directory, cwd: directory, pi });
  t.after(() => server.close());
  const message = (role: string, text: string, timestamp: number) => ({ role, content: [{ type: 'text', text }], timestamp });
  writeRun(profile, { id: 'aaaaaaaa', state: 'running', started: 1000, task: 'Count the files.' }, [message('user', 'a view\n\nYour task:\nCount the files.', 1000), message('assistant', 'Counting.', 2000)]);
  const { app, until } = page(t);
  void app.start(server.url);
  await until(state => state.connection === 'open');

  const texts = () => transcript(app.state.chats['team/aaaaaaaa'], true).map(({ kind, text }) => [kind, text]);
  await app.readAgent('team', 'aaaaaaaa');
  assert.deepEqual(texts(), [['user', 'Count the files.'], ['talk', 'Counting.']]);
  // It goes on, and fails, while the page asks twice at once, as a timer and a change of the main chat can. The two answers
  // start at the same message and need not end at the same one: what it said since is there once, and how it ended comes last.
  const early = app.readAgent('team', 'aaaaaaaa');
  writeRun(profile, { id: 'aaaaaaaa', state: 'failed', started: 1000, ended: 4000, task: 'Count the files.', report: 'Task error: overloaded' },
    [message('user', 'a view\n\nYour task:\nCount the files.', 1000), message('assistant', 'Counting.', 2000), message('assistant', 'Twelve so far.', 3000)]);
  await Promise.all([early, app.readAgent('team', 'aaaaaaaa'), app.readAgent('team', 'aaaaaaaa')]);
  assert.deepEqual(texts(), [['user', 'Count the files.'], ['talk', 'Counting.'], ['talk', 'Twelve so far.'], ['work', 'Task error: overloaded']]);
  assert.equal(transcript(app.state.chats['team/aaaaaaaa'], true).at(-1)?.date, new Date(4000).toISOString());
  // An agent that answered has said its report already.
  assert.deepEqual(transcript({ ...app.state.chats['team/aaaaaaaa'], report: ' Twelve so far.\n' }, true).length, 3);
});

test('what you told an agent waits under its chat until it reads it, and a refusal is handed back whole, not shown as a failure', async t => {
  const home = temporaryHome(), profile = createProfile(home, 'crew'), server = await startServer({ home, cwd: home, pi });
  t.after(() => server.close());
  writeRun(profile, { id: 'aaaaaaaa', state: 'running', started: 1000 });
  writeRun(profile, { id: 'bbbbbbbb', state: 'completed', started: 900, ended: 950, parentId: 'aaaaaaaa' });
  const { app, until } = page(t);
  void app.start(server.url);
  await until(state => state.connection === 'open');

  await app.readAgent('crew', 'aaaaaaaa');
  assert.equal(await app.act('tellAgent', { profile: 'crew', id: 'aaaaaaaa', text: 'Skip the slow test.' }), undefined);
  // Nothing new was said in its chat: the message alone is news.
  await app.readAgent('crew', 'aaaaaaaa');
  assert.deepEqual(app.state.chats['crew/aaaaaaaa'].queued, ['Skip the slow test.']);
  assert.match(await app.act('tellAgent', { profile: 'crew', id: 'bbbbbbbb', text: 'Go on.' }) ?? '', /^Only bbbbbbbb's parent aaaaaaaa can resume it/);
  assert.equal(app.state.error, undefined);
});

test('the memory view opens line by line down to a message, and what is open stays open when it is read again', async t => {
  const home = temporaryHome(), directory = createProfile(home, 'deep'), log = join(directory, 'main', '2026-01-01.jsonl'), tree = join(directory, 'tree', '2026-01-01.jsonl');
  const entry = (i: number, kind: string, text: string) => `${JSON.stringify({ i, kind, date: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), text })}\n`;
  const leaf = (i: number, text: string) => `${JSON.stringify({ l: 0, i, text, size: Buffer.byteLength(text) })}\n`;
  // Eight messages the agent reads as two lines of four.
  writeMemory(directory, 8);
  writeFileSync(join(directory, 'view.json'), JSON.stringify({ parts: [[2, 0], [2, 1]], merging: false }));
  const server = await startServer({ home, app: mkdtempSync(join(home, 'app-')), cwd: home, pi });
  t.after(() => server.close());
  const { app } = page(t);
  await app.start(server.url);
  const memory = () => app.state.memory.deep, names = (lines: { id: number; n: number; text?: string }[]) => lines.map(line => [`${line.id}+${line.n}`, line.text]);

  await app.readMemory('deep');
  assert.deepEqual([memory().view?.total, names(memory().view!.lines)], [8, [['0+4', 'summary of 0+4'], ['4+4', 'summary of 4+4']]]);
  // A line opens into the two under it, and those in turn, down to a line of one message, which opens into the message.
  await app.toggleLine('deep', memory().view!.lines[0]);
  assert.deepEqual(names(memory().under['0+4']), [['0+2', 'summary of 0+2'], ['2+2', 'summary of 2+2']]);
  await app.toggleLine('deep', memory().under['0+4'][1]);
  assert.deepEqual(names(memory().under['2+2']), [['2+1', 'user: message 2'], ['3+1', 'talk: message 3']]);
  await app.toggleLine('deep', memory().under['2+2'][1]);
  assert.deepEqual(memory().originals[3], [{ i: 3, kind: 'talk', date: '2026-01-01T00:00:03.000Z', text: 'message 3' }]);
  assert.deepEqual([memory().open, building(memory())], [['0+4', '2+2', '3+1'], false]);

  // The chat goes on: its Pi logs a tool call, whose line it has not written yet, and the call has not printed. The view
  // has the message without a summary, and the message opens as the call alone.
  appendFileSync(log, entry(8, 'tool', 'bash {"command":"ls"}'));
  await app.readMemory('deep');
  assert.deepEqual([memory().view?.total, names(memory().view!.lines).at(-1), building(memory())], [9, ['8+1', undefined], true]);
  await app.toggleLine('deep', memory().view!.lines[2]);
  assert.deepEqual(memory().originals[8].map(message => message.kind), ['tool']);
  // Then the line is written and the call prints. Read again, the view has both, the call has what it printed, every line
  // that was open is open still, and what was read under them was not read again.
  const before = memory().under['2+2'];
  appendFileSync(tree, leaf(8, 'tool: bash {"command":"ls"}') + leaf(9, 'echo: bash: a.txt'));
  appendFileSync(log, entry(9, 'echo', 'bash: a.txt'));
  await app.readMemory('deep');
  assert.deepEqual([memory().view?.total, names(memory().view!.lines).slice(2), building(memory())], [10, [['8+1', 'tool: bash {"command":"ls"}'], ['9+1', 'echo: bash: a.txt']], false]);
  assert.deepEqual(memory().originals[8].map(message => [message.kind, message.text]), [['tool', 'bash {"command":"ls"}'], ['echo', 'bash: a.txt']]);
  assert.deepEqual(memory().open, ['0+4', '2+2', '3+1', '8+1']);
  assert.equal(memory().under['2+2'], before);

  // Closed and opened again, a line shows what was open under it as it was.
  await app.toggleLine('deep', memory().view!.lines[0]);
  assert.deepEqual(memory().open, ['2+2', '3+1', '8+1']);
  await app.toggleLine('deep', memory().view!.lines[0]);
  assert.deepEqual(memory().open, ['2+2', '3+1', '8+1', '0+4']);
  assert.equal(memory().under['2+2'], before);

  // An import moves the profile to another memory, here a longer one. Its lines are other lines: nothing read holds.
  const imported = 'memories/0f8fad5b-d9cb-469f-a165-70867728950e';
  writeMemory(join(directory, imported), 12);
  writeFileSync(join(directory, 'active-memory.json'), JSON.stringify(imported));
  await app.readMemory('deep');
  assert.deepEqual([memory().view?.total, memory().open, memory().under, memory().originals], [12, [], {}, {}]);
});

test('what a search found stands in the tree\'s place, and a message of it opens in the tree, down to where it is', async t => {
  const home = temporaryHome(), directory = createProfile(home, 'sought'), log = join(directory, 'main', '2026-01-01.jsonl');
  // Sixty-four messages the agent reads as two lines of thirty-two: one deep in the second says the word, and every other one "reply".
  writeMemory(directory, 64, i => i === 37 ? 'The needle is here.' : i % 2 ? `reply ${i}` : `message ${i}`);
  writeFileSync(join(directory, 'view.json'), JSON.stringify({ parts: [[5, 0], [5, 1]], merging: false }));
  const server = await startServer({ home, app: mkdtempSync(join(home, 'app-')), cwd: home, pi });
  t.after(() => server.close());
  const { app } = page(t);
  await app.start(server.url);
  const memory = () => app.state.memory.sought;
  // The search is typed before the view has been read: its answer, which comes after the view, is kept.
  await Promise.all([app.readMemory('sought'), app.search('sought', 'NEEDLE')]);
  await app.toggleLine('sought', memory().view!.lines[0]);
  assert.deepEqual(memory().search, { text: 'NEEDLE', answer: { of: 'NEEDLE', hits: [{ id: 37, kind: 'talk', date: '2026-01-01T00:00:37.000Z', lead: 'The ', match: 'needle', rest: ' is here.' }], more: 0 } });
  assert.deepEqual([listed(memory()), memory().open], [true, ['0+32']]);
  // Opened, it is in the tree: each line from the view's down to its own is open, with what is under it read.
  const down = ['32+32', '32+16', '32+8', '36+4', '36+2', '37+1'];
  assert.deepEqual(path(memory().view!.lines, 37).map(line => `${line.id}+${line.n}`), down);
  await app.find('sought', 37);
  assert.deepEqual([listed(memory()), memory().found, memory().open], [false, '37+1', ['0+32', ...down]]);
  assert.deepEqual(Object.keys(memory().under).sort(), ['0+32', ...down.slice(0, -1)].sort());
  assert.deepEqual(memory().originals[37].map(message => message.text), ['The needle is here.']);
  // Back at what was found, and then with the search ended while a message of it was still being opened: the tree is there,
  // as it was left, and nothing in it is marked.
  await app.find('sought');
  assert.deepEqual([listed(memory()), memory().found], [true, undefined]);
  const opening = app.find('sought', 37);
  await app.search('sought', '');
  await opening;
  assert.deepEqual([memory().search, memory().found, memory().open], [undefined, undefined, ['0+32', ...down]]);

  // The older ones are asked for after those that are here, and asked for twice they are still added once.
  const answer = () => memory().search?.answer;
  await app.search('sought', 'reply');
  assert.deepEqual([answer()?.hits.length, answer()?.hits.at(-1)?.id, answer()?.more], [20, 23, 11]);
  await Promise.all([app.moreFound('sought'), app.moreFound('sought')]);
  assert.deepEqual([answer()?.hits.map(hit => hit.id), answer()?.more], [Array.from({ length: 32 }, (_, k) => 63 - 2 * k).filter(id => id !== 37), 0]);
  // While the answer for other text is on its way the one before stands, and its older ones are not asked for under the new text.
  const typed = app.search('sought', 'message');
  await app.moreFound('sought');
  assert.deepEqual([memory().search?.text, answer()?.of, answer()?.hits.length], ['message', 'reply', 31]);
  await typed;
  assert.deepEqual([answer()?.of, answer()?.hits[0].id, answer()?.more], ['message', 62, 12]);

  // The log has grown since the view was read. The search finds the new message, and opening it reads the view again.
  appendFileSync(log, `${JSON.stringify({ i: 64, kind: 'user', date: '2026-01-01T00:01:04.000Z', text: 'Another needle.' })}\n`);
  await app.search('sought', 'needle');
  assert.deepEqual(answer()?.hits.map(hit => hit.id), [64, 37]);
  await app.find('sought', 64);
  assert.deepEqual([memory().view?.total, memory().found, memory().open.at(-1), memory().originals[64]?.[0].text], [65, '64+1', '64+1', 'Another needle.']);

  // What a message cites is shown the same way, and can be a line of several messages: the tree is open down to that line,
  // which is the one pointed out. Where the view's own line is shorter than what is cited, it is that line.
  await app.search('sought', '');
  await app.find('sought', 8, 4);
  assert.deepEqual([memory().found, memory().open.slice(-3), Object.keys(memory().under).includes('8+4')], ['8+4', ['0+16', '8+8', '8+4'], true]);
  await app.find('sought', 0, 64);
  assert.equal(memory().found, '0+32');
});

test('the memory view is looked at again by the clock while the chat says too little: its Pi runs, or a Pi outside the app has it', async t => {
  const home = temporaryHome(), directory = createProfile(home, 'held');
  writeMemory(directory, 2);
  const server = await startServer({ home, app: mkdtempSync(join(home, 'app-')), cwd: home, pi });
  t.after(() => server.close());
  const unlock = await lockProfile(directory, describeOwner({ profile: 'held', pid: 4242, host: 'a-terminal', cwd: '/somewhere' }));
  t.after(() => unlock().catch(() => {}));
  const { app } = page(t);
  await app.start(server.url);
  await app.openProfile('held');
  await app.readMemory('held');
  const window = () => app.state.windows.find(window => window.id === 'held/main')!, memory = () => app.state.memory.held;
  assert.equal(window().outside !== undefined && window().status, 'stopped');

  // The Pi in the terminal logs a message. Nothing tells the app: the chat's window does not change, so the clock has to.
  const still = JSON.stringify(window());
  appendFileSync(join(directory, 'main', '2026-01-01.jsonl'), `${JSON.stringify({ i: 2, kind: 'user', date: '2026-01-01T00:00:02.000Z', text: 'from the terminal' })}\n`);
  assert.equal(JSON.stringify(window()), still);
  assert.equal(polled(memory(), window()), true);
  await app.readMemory('held');
  assert.equal(memory().view?.total, 3);
  // So it does while that message's line is not written, whoever has the chat. After that, a chat left to itself says
  // when it changed; a run does not, until it ends.
  assert.deepEqual([polled(memory(), { status: 'idle' }), polled(memory(), { status: 'stopped' })], [true, true]);
  appendFileSync(join(directory, 'tree', '2026-01-01.jsonl'), `${JSON.stringify({ l: 0, i: 2, text: 'user: from the terminal', size: 23 })}\n`);
  await app.readMemory('held');
  assert.deepEqual([polled(memory(), { status: 'idle' }), polled(memory(), { status: 'stopped' }), polled(memory(), { status: 'running' }), polled(memory(), { status: 'stopped', outside: 'unknown' })], [false, false, true, true]);
});

test('a message pi-optchat does not take is not sent: what it said about it stands until the next message, and a command is sent', async t => {
  const home = temporaryHome(), server = await startServer({ home, cwd: home, pi });
  createProfile(home, 'importing');
  t.after(() => server.close());
  const { app, until } = page(t);
  void app.start(server.url);
  await until(state => state.connection === 'open');
  await app.openProfile('importing');
  const window = 'importing/main', notices = () => app.state.live[window].notices.map(notice => notice.text);

  // The composer puts back a message that was not sent (`send` answers false), as one the server refused.
  assert.equal(await app.send(window, 'Hello there'), false);
  await until(state => state.live[window].notices.length === 1);
  assert.match(notices()[0], /^This profile has an import in progress/);
  assert.equal(app.state.error, undefined);
  // Said again for the next message, it is there once; a command Pi ran is sent, and what was said before it is gone.
  assert.equal(await app.send(window, 'Hello again'), false);
  await until(state => state.live[window].notices.length === 1);
  assert.equal(await app.send(window, '/optchat'), true);
  assert.deepEqual(notices(), []);
});

test('your message is in the chat the moment it is sent: Pi\'s copy takes its place, and one that is not sent is taken back', async t => {
  const home = temporaryHome(), server = await startServer({ home, cwd: home, pi });
  for (const profile of ['work', 'importing']) createProfile(home, profile);
  t.after(() => server.close());
  const { app, until } = page(t);
  void app.start(server.url);
  await until(state => state.connection === 'open');
  await app.openProfile('work');
  const window = 'work/main', said = () => chat([], app.state.live[window]).filter(item => item.kind === 'user').map(item => [item.key, item.text]);

  // Before the server has answered, and before its Pi has started: the message is the chat's next line.
  const sending = app.send(window, 'Please wait here'), stopped = app.state.windows.find(w => w.id === window);
  assert.deepEqual([said(), stopped?.status], [[[0, 'Please wait here']], 'stopped']);
  // The window is said again before its Pi starts, stopped as it was (the server looked at its model): the message stays.
  if (stopped) app.receive({ push: 'window', window: { ...stopped } });
  assert.deepEqual(said(), [[0, 'Please wait here']]);
  assert.equal(await sending, true);
  // Pi's own copy is the same line under the same key, once: the row is not drawn anew.
  await until(state => state.live[window].messages.some(message => message.role === 'user'));
  assert.deepEqual([said(), app.state.live[window].sent], [[[0, 'Please wait here']], undefined]);
  // In a run a message waits under the chat as Pi says, so it is not shown here as well; nor is a command, which is no message.
  const steering = app.send(window, 'And this');
  assert.equal(app.state.live[window].sent, undefined);
  await steering;
  assert.deepEqual(app.state.live[window].queued.steering, ['And this']);
  // A run that began before the page knew of it has the message waiting too: Pi says so, and it is not in the chat as well.
  const running = app.state.windows.find(w => w.id === window);
  if (running) app.receive({ push: 'window', window: { ...running, status: 'idle' } });
  const late = app.send(window, 'And that');
  assert.equal(said().at(-1)?.[1], 'And that');
  assert.deepEqual([await late, app.state.live[window].sent, app.state.live[window].queued.steering], [true, undefined, ['And this', 'And that']]);

  // One that pi-optchat does not take is in the chat until that is known, and then it is gone from it.
  await app.openProfile('importing');
  const refused = app.send('importing/main', 'Hello there');
  assert.equal(chat([], app.state.live['importing/main']).at(-1)?.text, 'Hello there');
  assert.deepEqual([await refused, chat([], app.state.live['importing/main'])], [false, []]);
  void app.send('importing/main', '/optchat');
  assert.equal(app.state.live['importing/main'].sent, undefined);
  // A Pi that dies with a message on its way never says so: the window does, and the message is not left in the chat.
  const idle = app.state.windows.find(w => w.id === 'importing/main');
  void app.send('importing/main', 'One more');
  assert.equal(chat([], app.state.live['importing/main']).at(-1)?.text, 'One more');
  if (idle) app.receive({ push: 'window', window: { ...idle, status: 'stopped' } });
  assert.deepEqual([idle?.status, chat([], app.state.live['importing/main'])], ['idle', []]);
});

test('the profiles whose agents were cut off are offered: Resume resumes the one it is for and opens it, and a dismissed one stays away until an agent of it that started later is cut off', async t => {
  const home = temporaryHome();
  writeRun(createProfile(home, 'one'), { id: 'aaaaaaaa', state: 'interrupted', started: 2000, ended: 2500, cutOff: true });
  const two = createProfile(home, 'two');
  writeRun(two, { id: 'bbbbbbbb', state: 'running', started: 3000 });
  writeRun(createProfile(home, 'calm'), { id: 'cccccccc', state: 'completed', started: 1000, ended: 1500 });
  // A profile may be named as an object's property is: nothing of the kind counts as dismissed.
  writeRun(createProfile(home, 'constructor'), { id: 'dddddddd', state: 'running', started: 500 });
  const server = await startServer({ home, cwd: home, pi });
  t.after(() => server.close());
  const opened = async (saved?: Map<string, string>) => {
    const store = page(t, undefined, undefined, saved);
    void store.app.start(server.url);
    await store.until(state => state.connection === 'open' && state.cutOff.length > 0);
    return store;
  };
  const shown = (state: State) => cutOffShown(state).map(({ profile, agents }) => [profile, agents.length]);

  const { app, saved } = await opened();
  assert.deepEqual([shown(app.state), app.state.tabs], [[['constructor', 1], ['one', 1], ['two', 1]], ['calm']]);
  await app.resumeAgents('one');
  assert.deepEqual([shown(app.state), app.state.tabs, app.state.profile], [[['constructor', 1], ['two', 1]], ['calm', 'one'], 'one']);
  app.dismissCutOff('two');
  app.dismissCutOff('constructor');
  assert.deepEqual(shown(app.state), []);
  // The page opened again: the line stays away, while the agent is still cut off and in its list.
  const again = await opened(saved);
  assert.deepEqual([shown(again.app.state), again.app.state.cutOff.map(cut => cut.profile)], [[], ['constructor', 'two']]);
  // Until an agent that started after it was dismissed is cut off too.
  writeRun(two, { id: 'bbbbbbbc', state: 'running', started: 4000 });
  assert.deepEqual(shown((await opened(saved)).app.state), [['two', 2]]);
});

test('a connected window is called by what its first message says, and by what that cites when it says nothing else', t => {
  const { app } = page(t), window: WindowState = { id: 'work/1', profile: 'work', role: 'connected', cwd: '/tmp', status: 'idle', seq: 0 };
  const called = (text: string) => title(window, { ...app.state, sessions: { [window.id]: [{ role: 'user', timestamp: 1, content: [{ type: 'text', text }] }] } });
  assert.deepEqual([called(citing([cite('the banner', { id: 9, n: 1 })], 'Which colour?\nThe hex.')), called(citing([cite('the banner\nof the release')], '').trim()), title(window, app.state)], ['Which colour?', 'the banner', UNTITLED]);
});

test('a connected window renamed is called by its name on every page, an empty name gives back the automatic one, and the main chat keeps its own', async t => {
  const server = await startServer({ home: directory, cwd: directory, pi, token: 'rename' });
  t.after(() => server.close());
  const one = page(t), other = page(t);
  await Promise.all([one.app.start(server.url), other.app.start(server.url)]);
  await one.app.openProfile('work');
  await one.app.newWindow('work');
  const id = one.app.state.selected.work, called = (state: State) => title(state.windows.find(window => window.id === id)!, state);
  await one.app.rename(id, '  Release notes  ');
  assert.equal(called(await other.until(state => state.windows.some(window => window.name !== undefined))), 'Release notes');
  await one.app.rename(id, ' ');
  assert.equal(called(await other.until(state => state.windows.every(window => window.name === undefined))), UNTITLED);
  await one.app.rename('work/main', 'Not mine');
  assert.equal(one.app.state.error, 'The main chat keeps its name.');
  assert.equal(title(one.app.state.windows.find(window => window.role === 'main')!, one.app.state), 'Main chat');
});
