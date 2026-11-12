import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { Push, WindowState } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { transcript } from '../src/ui/agents.ts';
import { App, type State } from '../src/ui/store.ts';
import { createProfile, temporaryHome, writeRun } from './support.ts';

const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
/** The page's store, without a page: what it would keep in the browser stays in `saved`. */
function page(t: TestContext, retry = 1000, poll = 3000) {
  const saved = new Map<string, string>();
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
  void app.start(`ws://127.0.0.1:${port}/ws`);
  await sleep(500);
  await new Promise(resolve => away.close(resolve));
  // One try every 25 ms and its connection: retries that doubled would be in the thousands by now.
  assert.ok(attempts >= 3 && attempts <= 21, `${attempts} attempts`);

  const server = await startServer({ port, home: directory, cwd: directory, pi });
  t.after(() => server.close());
  assert.deepEqual((await until(state => state.connection === 'open' && state.windows.length > 0)).windows.map(window => window.id), ['work/main']);
});

test('a server that started again numbers its records from one, and the page follows them', async t => {
  const first = await startServer({ home: directory, cwd: directory, pi });
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

  const second = await startServer({ port: first.port, home: directory, cwd: directory, pi });
  t.after(() => second.close());
  await until(state => state.connection === 'open' && state.windows.length > 0);
  await app.send('work/main', 'hello again');
  const after = await answered(2);
  // The new server's window began at one again; records under the old number were not taken for ones already seen.
  assert.ok(after.live['work/main'].seq <= before, `${after.live['work/main'].seq} after ${before}`);
  assert.deepEqual(after.live['work/main'].messages.map(message => message.role), ['user', 'assistant']);
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

  // What makes a name is pi-optchat's to say, and the page says it after it.
  assert.equal(await app.createProfile('My Chat'), false);
  assert.match(app.state.error ?? '', /Profile names: 1–64 lowercase letters, digits, hyphens, or underscores\./);
  assert.equal(await app.createProfile('../elsewhere'), false);
  assert.equal(existsSync(join(home, 'profiles')), false, 'and nothing is written for a name that will not do');

  assert.equal(await app.createProfile('first'), true);
  assert.deepEqual([app.state.profiles, app.state.profile, app.state.windows.map(window => window.id)], [['first'], 'first', ['first/main']]);
  // The profile is pi-optchat's own: its settings and its instructions, where pi-optchat keeps them.
  assert.deepEqual(readdirSync(join(home, 'profiles', 'first')).sort(), ['AGENTS.md', 'config.json']);
  assert.equal(await app.send('first/main', 'hello'), true);
  // One that is there is not made again, nor written over.
  app.dismiss();
  assert.equal(await app.createProfile('first'), false);
  assert.match(app.state.error ?? '', /Profile already exists: first/);
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
  // An agent that answered has said its report already.
  assert.deepEqual(transcript({ ...app.state.chats['team/aaaaaaaa'], report: ' Twelve so far.\n' }, true).length, 3);
});
