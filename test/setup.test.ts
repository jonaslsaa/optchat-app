import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { test, type TestContext } from 'node:test';
import { connect } from '../src/client.ts';
import type { Push, Setup } from '../src/protocol.ts';
import { startServer, type ServerOptions } from '../src/server/server.ts';
import { appHome } from '../src/server/settings.ts';
import { createProfile, temporaryHome } from './support.ts';

const home = temporaryHome();
createProfile(home, 'work');
const node = (script: string) => ({ command: process.execPath, args: [join(import.meta.dirname, script)] });
const nowhere = { command: join(home, 'no-such-pi'), args: [] };

/** A server with its own app folder and its own fake Pi folder (which says which Pi the fake one is), and a client that keeps
 * the setups it was pushed. */
async function setup(t: TestContext, options: ServerOptions = {}, pi?: object) {
  const app = mkdtempSync(join(home, 'app-')), folder = process.env.FAKE_PI_HOME = mkdtempSync(join(home, 'pi-'));
  if (pi) writeFileSync(join(folder, 'state.json'), JSON.stringify(pi));
  // A window's Pi gets flags, and after flags Pi reads a word such as `list` as a message to the agent: the setup's commands
  // must never get them. The fake Pi reads its command from its first word, as Pi does.
  const server = await startServer({ home, app, cwd: home, pi: node('fake-pi.ts'), npm: node('fake-npm.ts'), flags: ['--model', 'a-model'], ...options });
  const pushed: Setup[] = [], waiting = new Set<() => void>();
  const client = await connect(server.url, (push: Push) => { if (push.push === 'setup') pushed.push(push.setup); for (const check of waiting) check(); });
  t.after(async () => { client.close(); await server.close(); });
  const ended = () => new Promise<Setup>(resolve => {
    const check = () => { const last = pushed.at(-1); if (last?.job && last.job.state !== 'running') { waiting.delete(check); resolve(last); } };
    waiting.add(check); check();
  });
  return { app, folder, pushed, ended, request: client.request };
}

test('the settings are kept in the app\'s own folder, reach every page, and name where new windows run', async t => {
  const { app, request } = await setup(t), elsewhere = mkdtempSync(join(home, 'elsewhere-'));
  assert.deepEqual(await request('settings', {}), { theme: 'system' });
  assert.equal((await request('open', { profile: 'work', role: 'connected' })).window.cwd, home);

  // Each is changed by itself: the theme stays when only the folder is named. A folder is kept as its whole path.
  assert.deepEqual(await request('setSettings', { theme: 'dark' }), { theme: 'dark' });
  assert.deepEqual(await request('setSettings', { cwd: relative(process.cwd(), elsewhere) }), { theme: 'dark', cwd: elsewhere });
  assert.deepEqual(JSON.parse(readFileSync(join(app, 'settings.json'), 'utf8')), { theme: 'dark', cwd: elsewhere });
  assert.equal((await request('open', { profile: 'work', role: 'connected' })).window.cwd, elsewhere);
  // A folder that is not there is refused, and what was kept stays.
  await assert.rejects(request('setSettings', { theme: 'light', cwd: join(home, 'missing') }), /No such directory/);
  assert.deepEqual(await request('settings', {}), { theme: 'dark', cwd: elsewhere });

  // A folder that is gone since it was kept does not stop a window from opening: it runs where it would with none kept.
  rmSync(elsewhere, { recursive: true });
  assert.equal((await request('open', { profile: 'work', role: 'connected' })).window.cwd, home);
  assert.deepEqual(await request('setSettings', { cwd: null }), { theme: 'dark' });

  // The app's own folder may be named with `~` too, as in a file that sets the environment.
  const kept = process.env.OPTCHAT_APP_HOME;
  t.after(() => { process.env.OPTCHAT_APP_HOME = kept; });
  process.env.OPTCHAT_APP_HOME = '~/somewhere';
  assert.equal(appHome(), join(homedir(), 'somewhere'));
});

test('setup tells a Pi that is ready from one that lacks pi-optchat, has an old one, or has no login', async t => {
  const { folder, request } = await setup(t, {}, { version: '1.5.2', providers: [], packages: {} });
  const bare = await request('setup', {});
  assert.partialDeepStrictEqual(bare, { pi: { state: 'ok', version: '1.5.2' }, optchat: { state: 'missing', installable: true }, login: { state: 'missing', providers: [] } });
  assert.equal(bare.pi.shell, undefined);
  assert.match(bare.optchat.command ?? '', / install npm:pi-optchat$/);
  assert.match(bare.login.command ?? '', / auth login anthropic$/);

  // pi-optchat from a folder of yours is read where it is, and is not the app's to update.
  const checkout = join(folder, 'checkout');
  mkdirSync(checkout);
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'pi-optchat', version: '0.11.11' }));
  // It is found however many packages Pi lists after it.
  const others = Object.fromEntries(Array.from({ length: 150 }, (_, at) => [`npm:something-else-${at}`, folder]));
  writeFileSync(join(folder, 'state.json'), JSON.stringify({ version: '1.4.0', providers: ['openai', 'anthropic'], packages: { '../checkout': checkout, ...others } }));
  assert.equal((await request('setup', {})).optchat.state, 'missing', 'what was found is kept until it is asked for afresh');
  const old = await request('setup', { fresh: true });
  assert.partialDeepStrictEqual(old, { pi: { state: 'old', version: '1.4.0' }, optchat: { state: 'old', version: '0.11.11', path: checkout }, login: { state: 'ok', providers: ['anthropic', 'openai'], models: ['anthropic/claude-fable-5', 'anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-5-5', 'anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5', 'openai/gpt-4.1', 'openai/gpt-5.5', 'openai/gpt-6-sol', 'openai/gpt-6.1-terra', 'openai/o3'] } });
  assert.equal(old.optchat.installable, undefined);
  await assert.rejects(request('install', { what: 'optchat' }), /a folder of yours/);
  // Nor is a Pi of yours the app's to change, too old or not: it says which command updates it, and runs none.
  assert.equal(old.pi.installable, undefined);
  assert.match(old.pi.command ?? '', / update self$/);
  await assert.rejects(request('install', { what: 'pi' }), /a Pi of yours/);
  assert.equal((await request('setup', { fresh: true })).job, undefined);
});

test('the app installs pi-optchat with Pi\'s own installer, and says how it went', async t => {
  const { pushed, ended, request } = await setup(t, {}, { version: '1.5.2', providers: ['anthropic'], packages: {} });
  await request('install', { what: 'optchat' });
  const done = await ended();
  assert.partialDeepStrictEqual(done, { optchat: { state: 'ok', version: '0.11.12' }, job: { what: 'optchat', state: 'done' } });
  assert.match(pushed[0].job?.line ?? '', /^Running: .* install npm:pi-optchat$/);
  await assert.rejects(request('install', { what: 'optchat' }), /installed already/);
});

test('with no Pi on the machine the app installs one into its own folder, and windows run that one', async t => {
  // The folder is named from where the server runs, and has in its name what a shell would read as more than a name.
  const folder = join(mkdtempSync(join(home, 'app-')), `it's "$HOME" \`here\``);
  const { ended, request } = await setup(t, { pi: nowhere, app: relative(process.cwd(), folder) });
  assert.partialDeepStrictEqual(await request('setup', {}), { pi: { state: 'missing', installable: true }, optchat: { state: 'unknown' }, login: { state: 'unknown' } });
  const { window } = await request('open', { profile: 'work' });
  await assert.rejects(request('prompt', { window: window.id, text: 'hello' }), /Pi is not installed/);

  await request('install', { what: 'pi' });
  const bin = join(folder, 'pi', 'node_modules', '.bin'), { pi, job, optchat } = await ended();
  assert.partialDeepStrictEqual({ pi, job }, { pi: { state: 'ok', path: join(bin, 'pi') }, job: { what: 'pi', state: 'done' } });
  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
  // The line for your shell's profile puts that folder on the PATH as it is, and a command the page shows runs that Pi.
  const sh = (line: string) => execFileSync('/bin/sh', ['-c', line], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } }).trim();
  assert.equal(sh(`${pi.shell}; command -v pi`), join(bin, 'pi'));
  assert.match(optchat.command ?? '', / install npm:pi-optchat$/);
  assert.equal(sh(optchat.command!.replace(/ install npm:pi-optchat$/, ' --version')), '1.5.2');
});

test('the pi on the PATH is run by its whole path, and a PATH entry that is not a whole path is passed over', async t => {
  const bin = mkdtempSync(join(home, 'bin-')), script = `#!/bin/sh\nexec '${process.execPath}' '${join(import.meta.dirname, 'fake-pi.ts')}' "$@"\n`;
  for (const name of ['pi-whole', 'pi-part']) { writeFileSync(join(bin, name), script); chmodSync(join(bin, name), 0o755); }
  const path = process.env.PATH;
  t.after(() => { process.env.PATH = path; });

  // A window runs in its own folder, where an entry such as `bin` would be another folder: such a pi is not one to run.
  process.env.PATH = `${relative(process.cwd(), bin)}${delimiter}${path}`;
  const part = await setup(t, { pi: { command: 'pi-part', args: [] } }, { version: '1.5.2', providers: [], packages: {} });
  assert.equal((await part.request('setup', {})).pi.state, 'missing');

  process.env.PATH = `${bin}${delimiter}${path}`;
  const whole = await setup(t, { pi: { command: 'pi-whole', args: [] } }, { version: '1.5.2', providers: [], packages: {} });
  assert.partialDeepStrictEqual(await whole.request('setup', {}), { pi: { state: 'ok', path: join(bin, 'pi-whole') } });
  const { window } = await whole.request('open', { profile: 'work' });
  assert.deepEqual(await whole.request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
});

test('the app\'s own Pi stays the app\'s to update once its folder is on your PATH', async t => {
  const app = mkdtempSync(join(home, 'app-')), bin = join(app, 'pi', 'node_modules', '.bin'), path = process.env.PATH;
  t.after(() => { process.env.PATH = path; });
  process.env.PATH = bin; // As after adding the line the page shows to your shell's profile: `pi` is the app's.
  const { ended, request } = await setup(t, { app, pi: { command: 'pi', args: [] } });
  await request('install', { what: 'pi' });
  const { pi } = await ended();
  assert.partialDeepStrictEqual(pi, { state: 'ok', path: join(bin, 'pi') });
  assert.equal(pi.shell, undefined);

  mkdirSync(join(app, 'pi', 'home'));
  writeFileSync(join(app, 'pi', 'home', 'state.json'), JSON.stringify({ version: '1.4.0', providers: [], packages: {} }));
  assert.partialDeepStrictEqual((await request('setup', { fresh: true })).pi, { state: 'old', installable: true });
});

test('a pi on the PATH that does not run is passed over, and never changed', async t => {
  // It fails whatever it is asked, and notes what that was.
  const asked = join(home, 'asked.txt'), broken = { command: join(home, 'broken-pi'), args: [] };
  writeFileSync(broken.command, `#!/bin/sh\necho "$@" >> '${asked}'\necho 'broken 9.9.9' >&2\nexit 1\n`);
  chmodSync(broken.command, 0o755);
  const { app, pushed, ended, request } = await setup(t, { pi: broken });
  assert.partialDeepStrictEqual(await request('setup', {}), { pi: { state: 'missing', installable: true } });
  await request('install', { what: 'pi' });
  assert.partialDeepStrictEqual(await ended(), { pi: { state: 'ok', path: join(app, 'pi', 'node_modules', '.bin', 'pi') }, job: { what: 'pi', state: 'done' } });
  assert.match(pushed[0].job?.line ?? '', / install --prefix /);
  assert.deepEqual([...new Set(readFileSync(asked, 'utf8').trim().split('\n'))], ['--version']);
});

test('a Pi installed in a terminal meanwhile is found by the next prompt, and the page hears of it', async t => {
  const later = join(home, 'later-pi');
  const { pushed, request } = await setup(t, { pi: { command: later, args: [] } }, { version: '1.5.2', providers: ['anthropic'], packages: {} });
  const { window } = await request('open', { profile: 'work' });
  await assert.rejects(request('prompt', { window: window.id, text: 'hello' }), /Pi is not installed/);
  writeFileSync(later, `#!/bin/sh\nexec '${process.execPath}' '${join(import.meta.dirname, 'fake-pi.ts')}' "$@"\n`);
  chmodSync(later, 0o755);
  assert.deepEqual(await request('prompt', { window: window.id, text: 'hello' }), { disposition: 'started' });
  assert.partialDeepStrictEqual(await request('setup', {}), { pi: { state: 'ok', path: later } });
  assert.equal(pushed.at(-1)?.pi.state, 'ok');
});

test('a sign-in opens a terminal with Pi\'s own login, for a provider the app knows and no other', async t => {
  // In place of macOS's `open`: it notes which file it was asked to open.
  const opened = join(home, 'opened.txt'), opener = { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(opened)}, process.argv[1])`] };
  process.env.PI_CODING_AGENT_DIR = join(home, `pi's folder`);
  t.after(() => { delete process.env.PI_CODING_AGENT_DIR; });
  const { app, folder, request } = await setup(t, { opener }, { version: '1.5.2', providers: [], packages: {} });
  assert.partialDeepStrictEqual(await request('setup', {}), { login: { state: 'missing', terminal: true } });
  assert.deepEqual(await request('signedIn', { provider: 'anthropic' }), { status: 'not_ready' });

  // Anything but one of the three is refused before a file is written, whatever is in it.
  const file = join(app, 'sign-in-anthropic.command');
  for (const provider of ['openai', 'anthropic; touch /tmp/nope', '$(id)']) await assert.rejects(request('signIn', { provider: provider as 'anthropic' }), /Invalid signIn request/);
  assert.equal(existsSync(file), false);

  await request('signIn', { provider: 'anthropic' });
  assert.equal(readFileSync(opened, 'utf8'), file);
  assert.equal(statSync(file).mode & 0o777, 0o700);
  // Pi's own login and nothing else, with Pi's folder where the app's Pi has it, and no flag of a window's.
  assert.deepEqual(readFileSync(file, 'utf8').split('\n').slice(0, 3), ['#!/bin/sh', `export PI_CODING_AGENT_DIR='${home}/pi'\\''s folder'`, `${process.execPath} ${join(import.meta.dirname, 'fake-pi.ts')} auth login anthropic`]);
  // Run as the terminal would run it, it is Pi's login that runs (which here finds no terminal), and then the last line.
  const ran = spawnSync('/bin/sh', [file], { encoding: 'utf8' });
  assert.match(ran.stderr, /requires an interactive terminal/);
  assert.match(ran.stdout, /You can close this window and go back to OptChat\.\n$/);
  // The file is the server's own each time, whatever was put in its place.
  writeFileSync(file, 'something else');
  chmodSync(file, 0o644);
  await request('signIn', { provider: 'anthropic' });
  assert.match(readFileSync(file, 'utf8'), / auth login anthropic\n/);
  assert.equal(statSync(file).mode & 0o777, 0o700);
  // Each provider has a file of its own: a second sign-in leaves what the first terminal runs as it was.
  await request('signIn', { provider: 'github-copilot' });
  assert.match(readFileSync(join(app, 'sign-in-github-copilot.command'), 'utf8'), / auth login github-copilot\n/);
  assert.match(readFileSync(file, 'utf8'), / auth login anthropic\n/);

  // Pi says when the sign-in is done; the app reads no credential to know.
  writeFileSync(join(folder, 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic'], packages: {} }));
  assert.deepEqual(await request('signedIn', { provider: 'anthropic' }), { status: 'ready' });
  // A Pi that cannot read its own logins is no answer: the command that shows it asks the same Pi, with its files where they are.
  writeFileSync(join(folder, 'state.json'), JSON.stringify({ version: '1.5.2', providers: [], packages: {}, broken: true }));
  const refused = await request('signedIn', { provider: 'anthropic' }).catch((error: Error) => error.message);
  assert.equal(refused, `Pi could not say whether it is signed in. Try in a terminal: PI_CODING_AGENT_DIR='${home}/pi'\\''s folder' ${process.execPath} ${join(import.meta.dirname, 'fake-pi.ts')} auth check --provider anthropic`);
  assert.match(spawnSync('/bin/sh', ['-c', String(refused).split('terminal: ')[1]], { encoding: 'utf8' }).stdout, /"status":"invalid"/);
});

test('without a way to open a terminal, a sign-in says which command to run', async t => {
  const { request } = await setup(t, {}, { version: '1.5.2', providers: [], packages: {} });
  const { login } = await request('setup', {});
  assert.equal(login.terminal, false);
  assert.match(login.command ?? '', / auth login anthropic$/);
  await assert.rejects(request('signIn', { provider: 'github-copilot' }), /cannot open a terminal on this system\. Run this in one: .* auth login github-copilot$/);
});

test('an install that fails says why, with the end of what it printed', async t => {
  process.env.FAKE_NPM_FAILS = '1';
  t.after(() => { delete process.env.FAKE_NPM_FAILS; });
  const { ended, request } = await setup(t, { pi: nowhere });
  await request('install', { what: 'pi' });
  const { pi, job } = await ended();
  assert.equal(pi.state, 'missing');
  assert.partialDeepStrictEqual(job, { what: 'pi', state: 'failed' });
  assert.match(job?.line ?? '', /ended with code 1: npm error/);
  assert.match(job?.output ?? '', /ENOTFOUND/);
});

test('an install that says all is well and leaves nothing there has failed', async t => {
  process.env.FAKE_NPM_FAILS = 'quietly';
  t.after(() => { delete process.env.FAKE_NPM_FAILS; });
  const { ended, request } = await setup(t, { pi: nowhere });
  await request('install', { what: 'pi' });
  const { pi, job } = await ended();
  assert.equal(pi.state, 'missing');
  assert.partialDeepStrictEqual(job, { what: 'pi', state: 'failed' });
  assert.match(job?.line ?? '', /ran to its end, but what it was to install is not there/);
});
