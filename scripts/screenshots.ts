import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { connect, type Client } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { describeOwner, lockProfile } from '../node_modules/pi-optchat/dist/profiles.js';
import { createProfile } from '../test/support.ts';
import { agents, demo, remember, seed, SHIPPED, SHIPPING, TEAM } from './seed.ts';

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
const team = createProfile(home, 'team');
seed(team, TEAM.length, NOW, TEAM);
agents(team, NOW + 42_000);
const terminal = createProfile(home, 'terminal');
seed(terminal, 2, NOW);
seed(createProfile(home, 'work'), 95, NOW); // Ends with the turn that ran the tests.
seed(createProfile(home, 'notes'), 2, NOW);
// A chat of ten days with its summaries, for the memory view.
const long = createProfile(home, 'long');
seed(long, 95, NOW, undefined, 40 * 60_000);
remember(long);
// A chat that names issues and pull requests and has agents, one that only names them, and a GitHub CLI that is not signed in yet.
const ship = createProfile(home, 'ship');
seed(ship, SHIPPING.length, NOW, SHIPPING);
agents(ship, NOW + 42_000);
seed(createProfile(home, 'links'), SHIPPING.length, NOW, SHIPPING);
const gh = { command: process.execPath, args: [join(import.meta.dirname, '../test/fake-gh.ts')] }, github = (state: object) => writeFileSync(join(home, 'gh', 'gh.json'), JSON.stringify(state));
process.env.FAKE_GH_HOME = join(home, 'gh');
mkdirSync(join(home, 'gh'));
github({ items: {}, signedOut: true });
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
const server = await startServer({ home, app: join(home, 'app'), cwd: home, pi, gh });
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

  // What an agent changed: an edit opens as the lines it took out and put in, a write as what it wrote.
  const changes = await open(['team']);
  await changes.getByRole('button', { name: /Worked for/ }).first().click();
  await changes.getByText('Edited test/pi.test.ts').click();
  await changes.getByText('Wrote docs/windows.md').click();
  await shot(changes, '23-edit-and-write-opened');

  // The main chat's agents, beside it. They are at work only while a Pi has the profile open, so one takes it here: after the
  // pages have opened the chat, which is therefore still the app's.
  const panel = await open(['team']), small = await open(['team'], { width: 420, height: 800 });
  const working = await lockProfile(team, describeOwner({ profile: 'team', pid: process.pid, host: 'jonas-macbook', cwd: home }));
  try {
    await panel.getByRole('button', { name: 'Agents and GitHub' }).click();
    await panel.getByText('Draft the release notes').waitFor();
    await shot(panel, '24-agents');
    await panel.getByText('Run the shutdown test on Windows').last().click();
    await panel.getByText('Runs on its own').waitFor();
    await shot(panel, '25-agent-working');
    // A report in the chat opens the agent it is from.
    await panel.getByRole('button', { name: 'Report: How T3 Code reconnects' }).click();
    await panel.getByText('Completed · 1m 42s').waitFor();
    await shot(panel, '26-agent-report');
    await small.getByRole('button', { name: 'Agents and GitHub' }).click();
    await small.getByText('Draft the release notes').waitFor();
    await shot(small, '27-agents-narrow');
  } finally { await working(); }

  // The memory view: the lines the agent reads, the newest in sight; then the oldest opened twice, and messages as they were said.
  const memory = await open(['long']), lines = memory.locator('[data-line]');
  await memory.getByText('Memory', { exact: true }).click();
  await lines.first().waitFor();
  await shot(memory, '28-memory');
  for (const name of ['message 346', 'message 347', 'message 349']) await lines.filter({ hasText: name }).click();
  await memory.getByText('Ran npm test').waitFor();
  await shot(memory, '29-memory-messages');
  await lines.first().click();
  await lines.nth(1).click();
  await lines.nth(2).waitFor();
  await memory.getByRole('heading', { name: 'Mon 2 Nov' }).scrollIntoViewIfNeeded();
  await shot(memory, '30-memory-opened');
  const dim = await open(['long'], { dark: true });
  await dim.keyboard.press('Alt+m');
  await dim.locator('[data-line]').first().click();
  await dim.locator('[data-line]').nth(2).waitFor();
  await dim.getByRole('heading', { name: 'Mon 2 Nov' }).scrollIntoViewIfNeeded();
  await shot(dim, '31-memory-dark');
  const slim = await open(['long'], { width: 420, height: 800 });
  await slim.keyboard.press('Alt+m');
  await slim.locator('[data-line]').first().waitFor();
  await shot(slim, '32-memory-narrow');

  // The main chat's agents and what it named on GitHub, in one panel. The GitHub CLI is not signed in at first: the list is
  // there, and says so.
  const both = await open(['ship']), shade = await open(['ship'], { dark: true }), thin = await open(['ship'], { width: 420, height: 800 });
  const shipping = await lockProfile(ship, describeOwner({ profile: 'ship', pid: process.pid, host: 'jonas-macbook', cwd: home }));
  try {
    await both.getByRole('button', { name: 'Agents and GitHub' }).click();
    await both.getByText('gh auth login').waitFor();
    await shot(both, '33-github-signed-out');
    github({ items: SHIPPED });
    await both.getByRole('button', { name: 'Check again' }).click();
    await both.getByText('Release notes for 0.2.0').waitFor();
    await shot(both, '34-agents-and-github');
    await shade.getByRole('button', { name: 'Agents and GitHub' }).click();
    await shade.getByText('Release notes for 0.2.0').waitFor();
    await shot(shade, '35-agents-and-github-dark');
    await thin.getByRole('button', { name: 'Agents and GitHub' }).click();
    await thin.getByText('Release notes for 0.2.0').waitFor();
    await shot(thin, '36-agents-and-github-narrow');
  } finally { await shipping(); }
  // A chat with neither, and one that only named pull requests and issues.
  await empty.getByRole('button', { name: 'Agents and GitHub' }).click();
  await empty.getByText('Nothing yet.').waitFor();
  await shot(empty, '37-panel-empty');
  const links = await open(['links']);
  await links.getByRole('button', { name: 'Agents and GitHub' }).click();
  await links.getByText('Release notes for 0.2.0').waitFor();
  await shot(links, '38-github-only');
}
