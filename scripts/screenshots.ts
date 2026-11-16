import { appendFileSync, chmodSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { connect, type Client } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { createProfile, give, png } from '../test/support.ts';
import { agents, CHANGES, demo, FILES, FORMULAS, limited, NAMED, remember, seed, SHIPPED, SHIPPING, spend, TEAM } from './seed.ts';

/** `npm run screenshots [directory] [--dark]`: a PNG of every main state of the UI, in /tmp/optchat-app-shots unless a directory
 * is named, and all of them in dark mode with `--dark`. It builds the UI, serves it against throwaway profiles under /tmp with
 * the fake Pi (no model, no network, nothing of yours is read), and drives it in your installed Chrome. The same command gives
 * the same pictures. */
// The pages are drawn in UTC (`timezoneId` below), and so is what the server makes of a day: its bars of what a profile used.
process.env.TZ = 'UTC';
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
seed(createProfile(home, 'changes'), CHANGES.length, NOW, CHANGES);
agents(team, NOW + 42_000);
const terminal = createProfile(home, 'terminal');
seed(terminal, 2, NOW);
// The models a profile keeps, as pi-optchat does: its main chat's, and its agents'.
const keeps = (profile: string, main: object, subagent?: object) => writeFileSync(join(profile, 'config.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')), main, ...subagent && { subagent } }));
keeps(terminal, { provider: 'anthropic', model: 'claude-fable-5', thinking: 'xhigh' });
const picks = createProfile(home, 'picks');
seed(picks, 4, NOW);
keeps(picks, { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'high' }, { provider: 'openai', model: 'gpt-6-sol', thinking: 'medium' });
const work = createProfile(home, 'work');
writeFileSync(join(work, 'config.json'), '{}'); // pi-optchat's defaults, as a new profile has them: its settings show no test model.
seed(work, 95, NOW); // Ends with the turn that ran the tests.
seed(createProfile(home, 'notes'), 2, NOW);
seed(createProfile(home, 'importing'), 2, NOW); // Its import was paused: pi-optchat takes no message for it.
// A chat of ten days with its summaries, for the memory view.
const long = createProfile(home, 'long');
seed(long, 95, NOW, undefined, 40 * 60_000);
remember(long);
// What it used in those ten days, and a ledger with a line that cannot be read.
spend(long, NOW);
spend(join(home, 'profiles', 'notes'), NOW, 1);
appendFileSync(join(home, 'profiles', 'notes', 'usage.jsonl'), '{"date":"2026-11-12T08:00:00.000Z","role":"main","mod\n');
// A chat that names issues and pull requests and has agents, one that only names them, and a GitHub CLI that is not signed in yet.
const ship = createProfile(home, 'ship');
seed(ship, SHIPPING.length, NOW, SHIPPING);
agents(ship, NOW + 42_000);
seed(createProfile(home, 'links'), SHIPPING.length, NOW, SHIPPING);
seed(createProfile(home, 'formulas'), 1, NOW, FORMULAS);
// The subscription's limits as they were with the latest answer: well within them, past the five hours and on extra usage,
// a request refused a moment ago, and a count from before the five hours began again. `empty` has none.
limited(long, NOW, { five: 0.62, week: 0.18 });
limited(join(home, 'profiles', 'notes'), NOW, { five: 1.01, week: 0.4, overage: true });
limited(join(home, 'profiles', 'work'), NOW, { five: 0.98, week: 0.71, ago: 4 * 60_000, refused: 60_000 });
limited(join(home, 'profiles', 'links'), NOW, { five: 0.35, week: 0.52, ago: 6 * 3600_000 });
seed(createProfile(home, 'files'), 1, NOW, NAMED);
for (const file of FILES) { mkdirSync(join(home, file, '..'), { recursive: true }); writeFileSync(join(home, file), ''); }
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
writeFileSync(join(home, 'pi', 'pi-optchat', 'package.json'), JSON.stringify({ name: 'pi-optchat', version: '0.11.13' }));
writeFileSync(join(home, 'pi', 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic', 'openai', 'openai-codex', 'github-copilot', 'lab'], packages: { 'npm:pi-optchat': join(home, 'pi', 'pi-optchat') } }));

await build({ logLevel: 'warn' });
const server = await startServer({ home, app: join(home, 'app'), cwd: home, pi, gh, now: () => NOW + 42_000 });
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
  const shot = async (page: Page, name: string) => { await page.mouse.move(0, 0); await page.waitForLoadState('networkidle'); await page.waitForFunction(() => !document.querySelector('[aria-busy=true]')); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `${name}.png`) }); console.log(join(out, `${name}.png`)); };
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
  await settings.getByText('logged in: anthropic').waitFor();
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
  // A diff longer than the box it opens in scrolls there, light, dark and narrow.
  for (const [name, options] of [['86-long-diff', {}], ['87-long-diff-dark', { dark: true }], ['88-long-diff-narrow', { width: 420 }]] as const) {
    const page = await open(['changes'], options);
    await page.getByRole('button', { name: /Worked/ }).first().click();
    await page.getByText('Edited src/server/pi.ts').click();
    await shot(page, name);
  }

  // The main chat's agents, beside it. They are at work only while a Pi has the profile open, so one takes it here: after the
  // pages have opened the chat, which is therefore still the app's.
  const panel = await open(['team']), small = await open(['team'], { width: 420, height: 800 });
  const working = await lockProfile(team, describeOwner({ profile: 'team', pid: process.pid, host: 'jonas-macbook', cwd: home }));
  try {
    await panel.getByRole('button', { name: 'Agents and GitHub' }).click();
    await panel.getByText('Draft the release notes').waitFor();
    await shot(panel, '24-agents');
    await panel.getByText('Run the shutdown test on Windows').last().click();
    await panel.getByRole('textbox', { name: 'Tell the agent' }).waitFor();
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
  // Its search: the messages that say a word, newest first; the oldest of them opened in the tree, where it is; and a word
  // nothing says.
  const sought = memory.getByRole('searchbox', { name: 'Search the memory' }), found = memory.getByRole('region', { name: 'Messages found' });
  await sought.fill('grace');
  await memory.getByRole('button', { name: /Show older ones/ }).waitFor();
  await shot(memory, '60-memory-search');
  await memory.getByRole('button', { name: /Show older ones/ }).click();
  await memory.getByRole('button', { name: /Show older ones/ }).waitFor({ state: 'detached' });
  await found.locator('[data-line]').last().click();
  await memory.locator('[data-found]').waitFor();
  await shot(memory, '61-memory-found');
  await sought.fill('gracefully');
  await memory.getByText('No message contains').waitFor();
  await shot(memory, '62-memory-search-none');
  await dim.getByRole('searchbox', { name: 'Search the memory' }).fill('grace');
  await dim.getByRole('button', { name: /Show older ones/ }).waitFor();
  await shot(dim, '63-memory-search-dark');
  await dim.getByRole('region', { name: 'Messages found' }).locator('[data-line]').nth(1).click();
  await dim.locator('[data-found]').waitFor();
  await shot(dim, '65-memory-found-dark');
  await slim.getByRole('searchbox', { name: 'Search the memory' }).fill('grace');
  await slim.getByRole('button', { name: /Show older ones/ }).waitFor();
  await shot(slim, '64-memory-search-narrow');

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

  // The desktop app: its shell marks the page, whose top row is then the window's title bar and leaves the window's three
  // buttons their room (they are the window's, so not in these pictures). With two profiles that row is the tabs.
  const desk = await open(['long']), desks = await open(['long', 'work'], { width: 420, height: 800 });
  for (const page of [desk, desks]) await page.evaluate(() => { document.documentElement.dataset.shell = 'windowed'; });
  await shot(desk, '39-desktop-window');
  await shot(desks, '40-desktop-window-tabs-narrow');
  // The desktop app's settings have what only it can do: keeping the Mac awake. A browser's do not show it (15-settings).
  await desk.getByRole('button', { name: 'Settings' }).click();
  await desk.getByRole('switch', { name: 'Keep the Mac awake while agents work', checked: true }).waitFor();
  await shot(desk, '40b-desktop-settings');

  // A profile's own settings, as pi-optchat keeps them: a model saved at a level it has, with Enter, which leaves the focus in
  // its field; one that was changed; and one pi-optchat would not have.
  const profile = await open(['notes'], { height: 1500 });
  await profile.getByRole('button', { name: 'Settings' }).click();
  await profile.getByRole('tab', { name: 'Profile' }).click();
  await profile.locator('datalist option').first().waitFor({ state: 'attached' }); // The models are read, with their levels.
  await profile.getByRole('combobox', { name: 'Compactor model' }).fill('anthropic/claude-opus-5-5');
  await profile.keyboard.press('Enter');
  await profile.getByText('Saved. Thinking is Low: this model has no Off.').waitFor();
  await profile.locator('input[aria-label="Compactor model"]:focus').waitFor({ timeout: 5000 });
  await profile.getByRole('switch', { name: 'Memory search' }).click(); // It is on once pi-optchat has kept it.
  await profile.getByText('Saved. Applies from the next turn and to new or resumed subagents.').waitFor();
  await profile.getByRole('textbox', { name: 'Summaries at once' }).fill('100');
  await profile.keyboard.press('Enter');
  await profile.getByRole('alert').waitFor();
  await shot(profile, '41-settings-profile');
  // One as pi-optchat made it, untouched: its compactor is the default it names.
  for (const [page, name] of [[await open(['work'], { dark: true, height: 1500 }), '42-settings-profile-dark'], [await open(['work'], { width: 420, height: 800 }), '43-settings-profile-narrow']] as const) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Profile' }).click();
    await page.locator('datalist option').first().waitFor({ state: 'attached' });
    await shot(page, name);
  }

  // What a profile used, under its subscription's limits: today's, the week's (light, dark, narrow), a profile that has used
  // nothing and has no limits saved, and a ledger with a line that cannot be read.
  const usage = async (profile: string, options?: Parameters<typeof open>[1], range?: string) => {
    const page = await open([profile], options);
    await page.getByRole('button', { name: 'Usage' }).click();
    if (range) await page.getByRole('radio', { name: range }).check({ force: true });
    await page.getByText(range ? 'Cost over time' : 'Estimated at API prices').waitFor();
    return page;
  };
  await shot(await usage('long', { height: 1200 }), '73-usage-today');
  await shot(await usage('long', { height: 1200 }, 'Last 7 days'), '74-usage-week');
  await shot(await usage('long', { dark: true, height: 1200 }, 'Last 7 days'), '75-usage-week-dark');
  await shot(await usage('long', { width: 420, height: 1300 }, 'Last 7 days'), '76-usage-week-narrow');
  await shot(await usage('empty'), '77-usage-none');
  // Past a limit and on extra usage, which has to be said plainly (and with a ledger line that cannot be read).
  await shot(await usage('notes', { height: 1400 }, 'All time'), '78-usage-unreadable-line');
  await shot(await usage('notes', { dark: true, width: 420, height: 700 }), '79-usage-extra-dark-narrow');
  await shot(await usage('work', { height: 700 }), '80-usage-refused');
  await shot(await usage('links', { height: 700 }), '81-usage-limits-old');

  // Talking to an agent, under its chat. A message is worth a Pi: the app's own is started on the chat for the first one, and
  // its agents are at work with it. One at work keeps the message until it reads it.
  const crew = await open(['team']), dusk = await open(['team'], { dark: true }), sheet = await open(['team'], { width: 420, height: 800 });
  const agent = async (page: Page, title: string) => {
    if (await page.getByRole('button', { name: 'Back to the lists' }).isVisible()) await page.getByRole('button', { name: 'Back to the lists' }).click();
    else await page.getByRole('button', { name: 'Agents and GitHub' }).click();
    await page.getByRole('complementary').getByText(title).click();
  };
  const tell = async (page: Page, text: string) => { await page.getByRole('textbox', { name: 'Tell the agent' }).fill(text); await page.keyboard.press('Enter'); };
  await agent(crew, 'Run the shutdown test on Windows');
  await tell(crew, 'Skip the macOS run: only Windows matters here.');
  await crew.getByText('waiting to be read').waitFor();
  await crew.getByRole('button', { name: 'Interrupt' }).waitFor();
  await shot(crew, '44-agent-told');
  await agent(dusk, 'Run the shutdown test on Windows');
  await dusk.getByText('waiting to be read').waitFor();
  await shot(dusk, '45-agent-told-dark');
  await agent(sheet, 'Run the shutdown test on Windows');
  await sheet.getByText('waiting to be read').waitFor();
  await shot(sheet, '46-agent-told-narrow');
  // Interrupted with nothing it could go on with, it waits for a message: there is no step left to cut.
  await agent(crew, 'Draft the release notes');
  await crew.getByRole('button', { name: 'Interrupt' }).click();
  await crew.getByText('Paused ·').waitFor();
  await crew.getByText('Working for').waitFor({ state: 'detached' });
  await shot(crew, '47-agent-paused');
  // An agent that has ended is started again by a message, in the same box.
  await agent(crew, 'How T3 Code reconnects');
  await tell(crew, 'And what does the client do when the server started again?');
  await crew.getByText('Working ·').waitFor();
  await shot(crew, '48-agent-resumed');
  // An agent's own agent that has ended is its parent's to resume: no box, and a line for whose it is.
  await agent(crew, 'Find the failing CI run');
  await crew.getByText('so only it can resume it').waitFor();
  await shot(crew, '49-agent-of-an-agent-ended');
  // What pi-optchat refuses is said as it says it, and the message is still in the box.
  await agent(crew, 'Benchmark the log reader');
  await tell(crew, 'Try again, the API is back.');
  await crew.getByRole('alert').waitFor();
  await shot(crew, '50-agent-refused');

  // The model a chat runs on, picked in its composer: the list, a search, the model of the profile's agents, dark and narrow.
  const pick = await open(['picks']);
  await pick.getByRole('button', { name: 'Model' }).click();
  await pick.getByRole('radio', { name: 'High', exact: true, checked: true }).waitFor();
  await shot(pick, '51-model');
  await pick.getByRole('combobox', { name: 'Search models' }).fill('gpt 6');
  await shot(pick, '52-model-search');
  await pick.getByRole('combobox', { name: 'Search models' }).fill('');
  await pick.getByText('Subagents').click();
  await pick.getByRole('radio', { name: 'Medium', checked: true }).waitFor();
  await shot(pick, '53-model-subagents');
  const dimmed = await open(['picks'], { dark: true });
  await dimmed.getByRole('button', { name: 'Model' }).click();
  await dimmed.getByRole('radio', { name: 'High', exact: true, checked: true }).waitFor();
  await shot(dimmed, '54-model-dark');
  const lean = await open(['picks'], { width: 420, height: 800 });
  await lean.getByRole('button', { name: 'Model' }).click();
  await lean.getByRole('radio', { name: 'High', exact: true, checked: true }).waitFor();
  await shot(lean, '55-model-narrow');
  // A message pi-optchat did not take: it says why above the composer, and the message is back in it.
  const refused = await open(['importing']);
  await say(refused, 'Summarise the release notes');
  await refused.getByRole('status').filter({ hasText: 'import in progress' }).waitFor();
  await shot(refused, '66-message-not-taken');
  // The commands Pi knows, in the list a `/` opens over the composer, and as a name is typed.
  const slash = await open(['notes']), slim2 = await open(['notes'], { width: 420, height: 800, dark: true });
  for (const page of [slash, slim2]) {
    await page.getByRole('textbox', { name: 'Message' }).pressSequentially('/');
    await page.getByRole('option', { name: '/skill:sol-loop' }).waitFor();
  }
  await shot(slash, '67-commands');
  await shot(slim2, '69-commands-narrow-dark');
  await slash.getByRole('textbox', { name: 'Message' }).pressSequentially('s');
  await shot(slash, '68-commands-typed');
  // A line of a report selected, and the button that quotes it into the composer.
  const quoting = await open(['team']);
  await quoting.getByText('The snapshot is the fallback, not the default').click({ clickCount: 3 });
  await quoting.getByRole('button', { name: 'Quote' }).waitFor();
  await shot(quoting, '72-quote-selection');
  // Formulas in a reply, a price beside them as written, and a table with its copy buttons.
  for (const [name, options] of [['91-formulas-and-table', {}], ['92-formulas-and-table-dark', { dark: true }], ['93-formulas-and-table-narrow', { width: 420 }]] as const) {
    const page = await open(['formulas'], options);
    await page.locator('.katex-display').waitFor();
    await shot(page, name);
  }
  // A reply that names files: the two in the window's folder are links to your editor, the one that is not stays code.
  for (const [name, options] of [['98-files-named', {}], ['99-files-named-dark', { dark: true }], ['100-files-named-narrow', { width: 420 }]] as const) {
    const page = await open(['files'], options);
    await page.getByRole('button', { name: 'the shutdown test' }).waitFor();
    await shot(page, name);
  }
  // Not a picture: Esc closes the list and the run goes on, wherever the focus is. A click on a row once left the key to the
  // shortcut that stops the agent.
  await pick.getByText('Main chat', { exact: true }).last().click();
  await pick.keyboard.press('Escape');
  await pick.getByRole('textbox', { name: 'Message' }).fill('wait');
  await pick.keyboard.press('Enter');
  await pick.getByRole('button', { name: 'Stop the agent' }).waitFor();
  await pick.getByRole('button', { name: 'Model' }).click();
  await pick.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await pick.getByRole('button', { name: 'Model' }).getByText('Claude Sonnet 5.5').waitFor();
  await pick.keyboard.press('Escape');
  await pick.getByRole('dialog', { name: 'Model' }).waitFor({ state: 'detached' });
  await pick.waitForTimeout(300);
  if (!await pick.getByRole('button', { name: 'Stop the agent' }).isVisible()) throw new Error('Esc in the model list stopped the run.');
  // Nor is this: Esc in the memory view's search box ends the search and the run goes on, with nothing in the box too. Ending
  // a search leaves the keys there, and the Esc after it once went to the shortcut that stops the agent.
  const ended = pick.getByRole('region', { name: 'Messages found' });
  await pick.keyboard.press('Alt+m');
  await pick.locator('[data-line]').first().waitFor();
  await pick.keyboard.press('ControlOrMeta+f');
  await pick.keyboard.press('Escape');
  await pick.keyboard.type('wait');
  await ended.waitFor();
  await pick.keyboard.press('Escape');
  await ended.waitFor({ state: 'detached' });
  await pick.keyboard.press('Escape');
  await pick.waitForTimeout(300);
  if (!await pick.getByRole('button', { name: 'Stop the agent' }).isVisible()) throw new Error('Esc in the memory view\'s search box stopped the run.');
  // Images on their way with a message: two that go and one that cannot, then the message in the chat, and its image large.
  const sends = async (page: Page) => {
    await give(page, 'paste', [{ name: 'chart.png', type: 'image/png', data: png(240, [38, 99, 235]) }]);
    await give(page, 'drop', [{ name: 'shot.png', type: 'image/png', data: png(240, [234, 138, 30]) }, { name: 'notes.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }]);
    await page.getByRole('list', { name: 'Images to send' }).getByRole('listitem').nth(1).waitFor();
    await page.getByRole('textbox', { name: 'Message' }).fill('Which of these two pictures is the build chart?');
  };
  const pictures = await open(['empty']);
  await sends(pictures);
  await shot(pictures, '94-composer-images');
  await pictures.keyboard.press('Enter');
  await pictures.locator('img[src^="/images/empty/"]').nth(3).waitFor(); // Two of yours, and the two the reply shows.
  await shot(pictures, '95-image-sent');
  await pictures.getByRole('button', { name: 'Show the image large' }).first().click();
  await shot(pictures, '96-image-large');
  const pocket = await open(['long'], { dark: true, width: 420 });
  await sends(pocket);
  await shot(pocket, '97-composer-images-dark-narrow');

  // Nor this: what is typed and not sent is there when the page is opened again, and not once it is sent.
  const typed = await open(['notes']), box = typed.getByRole('textbox', { name: 'Message' });
  await box.fill('half a thought');
  await typed.reload();
  await box.waitFor();
  if (await box.inputValue() !== 'half a thought') throw new Error('What was typed and not sent is gone after a reload.');
  await box.press('Enter');
  await typed.getByText('half a thought').waitFor();
  await typed.reload();
  await box.waitFor();
  if (await box.inputValue() !== '') throw new Error('A message that was sent is in the box again after a reload.');
}
