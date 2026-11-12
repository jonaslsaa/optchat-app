import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { connect, type Client } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { describeOwner, lockProfile } from '../node_modules/pi-optchat/dist/profiles.js';
import { createProfile } from '../test/support.ts';
import { demo, seed } from './seed.ts';

/** `npm run screenshots [directory] [--dark]`: a PNG of every main state of the UI, in /tmp/optchat-app-shots unless a directory
 * is named, and all of them in dark mode with `--dark`. It builds the UI, serves it against throwaway profiles under /tmp with
 * the fake Pi (no model, no network, nothing of yours is read), and drives it in your installed Chrome. The same command gives
 * the same pictures. */
const options = process.argv.slice(2), allDark = options.includes('--dark'), out = options.find(option => !option.startsWith('--')) ?? '/tmp/optchat-app-shots';
/** When the pictures are taken. The seeded chats end here, the fake Pi's messages start here, and the page's clock stands a little later. */
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
// The pictures show paths, so the folder has one name; it is made here and removed at the end, and never taken from another run.
const WORKSPACE = '/tmp/optchat-app-shots-home';
try { mkdirSync(WORKSPACE); } catch { throw new Error(`${WORKSPACE} is there already: another run is taking pictures, or one was killed. Remove it once none is running.`); }
const home = realpathSync(WORKSPACE);
// Whatever happens, it is not left behind: not after an error, and not when the run is told to end.
process.on('exit', () => rmSync(home, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(1));
createProfile(home, 'empty');
const terminal = createProfile(home, 'terminal');
seed(terminal, 2, NOW);
seed(createProfile(home, 'work'), 95, NOW); // Ends with the turn that ran the tests.
seed(createProfile(home, 'notes'), 2, NOW);
writeFileSync(join(home, 'fake-pi.json'), JSON.stringify(demo(NOW)));
process.env.FAKE_PI_SCRIPT = join(home, 'fake-pi.json');
mkdirSync(out, { recursive: true });
// The fake Pi as a command of its own, with pi-optchat in it and a model logged in: a machine that is set up.
const fake = join(import.meta.dirname, '../test/fake-pi.ts'), pi = { command: join(home, 'bin', 'pi'), args: [] };
mkdirSync(join(home, 'bin'));
writeFileSync(pi.command, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
chmodSync(pi.command, 0o755);
process.env.FAKE_PI_HOME = join(home, 'pi');
mkdirSync(join(home, 'pi', 'pi-optchat'), { recursive: true });
writeFileSync(join(home, 'pi', 'pi-optchat', 'package.json'), JSON.stringify({ name: 'pi-optchat', version: '0.11.10' }));
writeFileSync(join(home, 'pi', 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic', 'openai'], packages: { 'npm:pi-optchat': join(home, 'pi', 'pi-optchat') } }));

await build({ logLevel: 'warn' });
const server = await startServer({ home, app: join(home, 'app'), cwd: home, pi });
// A machine with nothing on it yet: no Pi, no profile.
mkdirSync(join(home, 'new'));
const fresh = await startServer({ home: join(home, 'new'), app: join(home, 'new', 'app'), cwd: home, pi: { command: join(home, 'no-such-pi'), args: [] }, npm: { command: process.execPath, args: [join(import.meta.dirname, '../test/fake-npm.ts')] },
  opener: { command: process.execPath, args: ['-e', ''] } }); // In place of the terminal a sign-in opens: nothing.
let control: Client | undefined, browser: Browser | undefined;
// Whatever happens, nothing is left running: the browser, and the servers with their fake Pis.
try {
  control = await connect(server.url);
  browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars', '--disable-gpu', '--force-color-profile=srgb'] });
  await pictures(browser, control);
} finally {
  await browser?.close();
  control?.close();
  await Promise.all([server.close(), fresh.close()]);
}

async function pictures(browser: Browser, control: Client) {
  /** A page that opens with these profile tabs, the first one in front. */
  async function open(tabs: string[], { width = 1280, height = 800, dark = allDark, at = server.page, ready = 'Message' } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-GB' });
    await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs, profile: tabs[0], selected: {} }));
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW + 42_000);
    await page.goto(at);
    if (ready) await page.getByRole('textbox', { name: ready }).waitFor();
    return page;
  }
  // A code block gets its colours once Shiki's chunks are fetched: the picture waits for the page to have nothing left to fetch,
  // and then for what moves (a row that opens, 200 ms) to have come to rest.
  const shot = async (page: Page, name: string) => { await page.mouse.move(0, 0); await page.waitForLoadState('networkidle'); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `${name}.png`) }); console.log(join(out, `${name}.png`)); };
  const say = async (page: Page, text: string, key = 'Enter') => { await page.getByRole('textbox', { name: 'Message' }).fill(text); await page.keyboard.press(key); };

  const empty = await open(['empty']);
  await shot(empty, '01-empty-profile');

  const work = await open(['work']);
  await work.getByText('which is the point of that test').last().waitFor();
  await shot(work, '02-long-history');
  await work.getByRole('button', { name: /Worked for/ }).last().click();
  await work.waitForTimeout(150); // The chat follows what opened; a click before it has would land where the row was.
  await work.getByText('npm test').last().click();
  await shot(work, '03-work-opened');

  await say(work, 'Give me a demo of where things stand, and wait for me');
  await work.getByText('What I found').waitFor();
  await shot(work, '04-streaming-reply');
  await say(work, 'Also check the tests before you finish');
  await work.getByText('waiting to be read').waitFor();
  await say(work, 'Then open the pull request', 'ControlOrMeta+Enter');
  await work.getByText('Queued for after this run').waitFor();
  await shot(work, '05-queued-messages');
  await control.request('command', { window: 'work/main', command: { type: 'release' } });
  await work.getByText('Next I would wire the agents panel.').waitFor();
  await work.getByText('Opened the pull request').waitFor();
  await work.getByRole('button', { name: 'Send', exact: true }).waitFor(); // The composer sends again once the agent is idle.
  await shot(work, '06-reply-finished');

  await work.getByRole('button', { name: 'New window' }).click();
  await shot(work, '07-connected-window-new');
  await say(work, 'Give me a demo of this repository');
  await work.getByText('Next I would wire the agents panel.').waitFor();
  await work.getByRole('button', { name: 'Complete' }).first().waitFor();
  await shot(work, '08-connected-window');
  await work.getByRole('button', { name: 'Complete' }).first().click();
  await work.getByText('Completed', { exact: true }).waitFor();
  await shot(work, '09-completed-window');

  await work.getByRole('button', { name: 'Open a profile' }).click();
  await work.getByRole('option', { name: 'notes' }).click();
  await work.getByRole('tab', { name: 'notes' }).waitFor();
  await shot(work, '10-two-profile-tabs');

  const narrow = await open(['work'], { width: 420, height: 800 });
  await narrow.getByText('which is the point of that test').last().waitFor();
  await shot(narrow, '11-narrow');
  await narrow.getByRole('button', { name: 'Toggle the sidebar' }).click();
  await shot(narrow, '12-narrow-sidebar');

  const dark = await open(['work'], { dark: true });
  await dark.getByText('which is the point of that test').last().waitFor();
  await shot(dark, '13-dark');

  // The notes tab is in front on the first page: a connected window there whose Pi dies.
  await work.getByRole('button', { name: 'New window' }).click();
  await work.getByText('New connected window').waitFor();
  await say(work, 'please crash now');
  await work.getByRole('alert').waitFor();
  await shot(work, '14-pi-stopped');

  // The settings, and the same page in the dark theme chosen there (and put back, so the pictures before stay as they were).
  const settings = await open(['work']);
  await settings.getByRole('button', { name: 'Settings' }).click();
  await settings.getByText('logged in: anthropic, openai').waitFor();
  await shot(settings, '15-settings');
  await settings.getByText('Dark', { exact: true }).click(); // Its label: the choice is made when the server has kept it.
  await settings.locator('html.dark').waitFor();
  await shot(settings, '16-settings-dark');
  await settings.getByText('System', { exact: true }).click();
  await settings.getByRole('radio', { name: 'System', checked: true }).waitFor();

  // A profile a Pi in a terminal holds: the main chat says so, and takes no message.
  const unlock = await lockProfile(terminal, describeOwner({ profile: 'terminal', pid: 4242, host: 'jonas-macbook', cwd: '/Users/jonas/code/optchat' }));
  try {
    const outside = await open(['terminal'], { ready: '' });
    await outside.getByText('This chat is running outside the app').waitFor();
    await shot(outside, '17-running-outside');
  } finally { await unlock(); }

  // The first run on a machine with no Pi: the setup is the page. An install that fails, and one that works.
  const first = await open([], { at: fresh.page, ready: '' });
  await first.getByRole('button', { name: 'Install' }).waitFor();
  await shot(first, '18-first-run');
  process.env.FAKE_NPM_FAILS = '1';
  await first.getByRole('button', { name: 'Install' }).click();
  await first.getByText(/ended with code 1/).waitFor();
  await first.getByText('What it printed').click();
  await shot(first, '19-install-failed');
  delete process.env.FAKE_NPM_FAILS;
  await first.getByRole('button', { name: 'Install' }).click();
  await first.getByText('The app installed this Pi into its own folder.').waitFor();
  await first.getByText('Not installed in this Pi.').waitFor();
  await shot(first, '20-pi-installed');
  // Later, with a profile: the settings still say where the app's Pi is, and how to put it on your PATH.
  await first.getByRole('textbox', { name: 'Profile name' }).fill('work');
  await first.getByRole('button', { name: 'Create profile' }).click();
  await first.getByRole('button', { name: 'Settings' }).click();
  await first.getByText('The app installed this Pi into its own folder.').waitFor();
  await shot(first, '21-settings-app-pi');
  // A sign-in: the terminal is open somewhere, and the page waits for Pi to say it is done.
  await first.getByRole('button', { name: 'Claude' }).click();
  await first.getByText('Finish signing in to Claude').waitFor();
  await shot(first, '22-signing-in');
  await first.getByRole('button', { name: 'Cancel' }).click();
}
