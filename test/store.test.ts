import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { Push } from '../src/protocol.ts';
import { startServer } from '../src/server/server.ts';
import { App, type State } from '../src/ui/store.ts';
import { createProfile, temporaryHome } from './support.ts';

const pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
/** The page's store, without a page: what it would keep in the browser stays in `saved`. */
function page(t: TestContext, retry = 1000) {
  const saved = new Map<string, string>();
  const app = new App({ retry, storage: () => ({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); } }) });
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
  const settled = ({ until }: typeof whole) => until(state => state.windows[0].status === 'idle' && state.live['work/main']?.running === false && state.logs.work?.total === 2);

  assert.equal(await whole.app.send('work/main', 'hello'), true);
  const [seen, caught] = await Promise.all([settled(whole), settled(gaps)]);
  assert.ok(dropped.length > 0);
  assert.deepEqual(caught.live, seen.live);
  assert.deepEqual(caught.logs, seen.logs);
  assert.equal(seen.live['work/main'].messages.length, 2);
});
