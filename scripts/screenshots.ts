import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { build } from 'vite';
import { connect, type Client } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
// pi-optchat's own lock, which only Pi takes: here it stands for a Pi in a terminal.
import { defaults, describeOwner, lockProfile } from 'pi-optchat/files';
import { createProfile, give, png, writeRun } from '../test/support.ts';
import { chatgptExport, writeHistories } from '../test/histories.ts';
import { agents, CHANGES, demo, FAILED, FILES, FORMULAS, limited, NAMED, PICTURED, remember, RESIZED, RESIZED_IMAGE, seed, SEEN, SEEN_IMAGE, SHIPPED, SHIPPING, SKILLED, spend, TEAM } from './seed.ts';

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
// Its compactor is pi-optchat's default, as a new profile's is: its settings show no test model.
writeFileSync(join(team, 'config.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(team, 'config.json'), 'utf8')), compactor: defaults.compactor }));
seed(team, TEAM.length, NOW, TEAM);
seed(createProfile(home, 'changes'), CHANGES.length, NOW, CHANGES);
agents(team, NOW + 42_000);
// The same chat with its agents as they were left, for them in the chat: none told, paused or started again yet.
const begun = createProfile(home, 'started');
seed(begun, TEAM.length, NOW, TEAM);
agents(begun, NOW + 42_000);
// The same chat once both its agents have reported, and no Pi has it.
const reported = createProfile(home, 'reported');
seed(reported, TEAM.length, NOW, TEAM);
agents(reported, NOW + 42_000);
writeRun(reported, { id: 'a41f09c2', title: 'Run the shutdown test on Windows', task: 'Run test/pi.test.ts on the Windows runner.', state: 'failed', started: NOW - 54_000, ended: NOW + 12_000, model: 'anthropic/claude-sonnet-5', report: 'The Windows runner is offline: no run could start.' });
const terminal = createProfile(home, 'terminal');
seed(terminal, 2, NOW);
// The models a profile keeps, as pi-optchat does: its main chat's, and its agents'.
const keeps = (profile: string, main: object, subagent?: object) => writeFileSync(join(profile, 'config.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')), main, ...subagent && { subagent } }));
keeps(terminal, { provider: 'anthropic', model: 'claude-fable-5', thinking: 'xhigh' });
const picks = createProfile(home, 'picks');
seed(picks, 4, NOW);
keeps(picks, { provider: 'anthropic', model: 'claude-opus-5-5', thinking: 'high' }, { provider: 'openai', model: 'gpt-6-sol', thinking: 'medium' });
seed(createProfile(home, 'work'), 95, NOW); // Ends with the turn that ran the tests.
seed(createProfile(home, 'notes'), 2, NOW);
// A chat that runs in a project of its own, a git repository, for the files an `@` lists.
seed(createProfile(home, 'mentions'), 2, NOW);
const project = join(home, 'optchat');
for (const file of ['README.md', 'package.json', 'src/protocol.ts', 'src/client.ts', 'src/server/server.ts', 'src/server/windows.ts', 'src/ui/App.tsx', 'src/ui/Composer.tsx', 'src/ui/Commands.tsx', 'src/ui/commands.ts', 'src/ui/store.ts', 'test/windows.test.ts', 'docs/ui.md', 'dist/index.js']) {
  mkdirSync(join(project, file, '..'), { recursive: true });
  writeFileSync(join(project, file), '');
}
writeFileSync(join(project, '.gitignore'), 'dist/\n');
execFileSync('git', ['init', '-q'], { cwd: project });
seed(createProfile(home, 'importing'), 2, NOW); // Its import was paused: pi-optchat takes no message for it.
seed(createProfile(home, 'slow'), 2, NOW); // Its Pi does not start in these pictures.
// A chat of ten days with its summaries, for the memory view.
const long = createProfile(home, 'long');
seed(long, 95, NOW, undefined, 40 * 60_000);
remember(long);
// A chat with its summaries where a message cites what was said: the last four messages a line each, the rest folded.
const cites = createProfile(home, 'cites');
seed(cites, TEAM.length, NOW, TEAM);
remember(cites, 4);
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
writeFileSync(join(home, 'chart.png'), png(240, [38, 99, 235]));
seed(createProfile(home, 'pictured'), 1, NOW, PICTURED(join(home, 'chart.png')));
seed(createProfile(home, 'failed'), 1, NOW, FAILED);
const resized = createProfile(home, 'resized');
seed(resized, 1, NOW, RESIZED);
mkdirSync(join(resized, 'images'));
writeFileSync(join(resized, 'images', `${RESIZED_IMAGE}.png`), png(240, [234, 138, 30]));
seed(createProfile(home, 'skills'), 1, NOW, SKILLED);
// The subscription's limits as they were with the latest answer: well within them, past the five hours and on extra usage,
// a request refused a moment ago, and a count from before the five hours began again. `empty` has none.
limited(long, NOW, { five: 0.62, week: 0.18 });
limited(join(home, 'profiles', 'notes'), NOW, { five: 1.01, week: 0.4, overage: true });
limited(join(home, 'profiles', 'work'), NOW, { five: 0.98, week: 0.71, ago: 4 * 60_000, refused: 60_000 });
limited(join(home, 'profiles', 'links'), NOW, { five: 0.35, week: 0.52, ago: 6 * 3600_000 });
seed(createProfile(home, 'files'), 1, NOW, NAMED);
// A reply whose work read a screenshot: the picture is the narrow chat's, once it is taken.
const seen = createProfile(home, 'seen');
seed(seen, 1, NOW, SEEN);
// Another tool's history on a made-up Mac, for the Import page: a profile with a chat to import into, and one with none.
writeHistories(join(home, 'mac'), NOW);
const history = createProfile(home, 'history');
writeFileSync(join(history, 'config.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(history, 'config.json'), 'utf8')), compactor: defaults.compactor }));
seed(history, 40, NOW);
remember(history, 4);
createProfile(home, 'research');
createProfile(home, 'pictures');
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
writeFileSync(join(home, 'pi', 'pi-optchat', 'package.json'), JSON.stringify({ name: 'pi-optchat', version: '0.12.2' }));
writeFileSync(join(home, 'pi', 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic', 'openai', 'openai-codex', 'github-copilot', 'lab'], packages: { 'npm:pi-optchat': join(home, 'pi', 'pi-optchat') } }));

await build({ logLevel: 'warn' });
// The editors it finds are these, whatever this machine has.
const server = await startServer({ home, app: join(home, 'app'), cwd: home, histories: join(home, 'mac'), pi, gh, now: () => NOW + 42_000, editors: () => new Map([['cursor', '/c'], ['vscode', '/v'], ['zed', '/z'], ['finder', '/usr/bin/open']]) });
// A machine with nothing on it yet: no Pi, no profile.
mkdirSync(join(home, 'new'));
const fresh = await startServer({ home: join(home, 'new'), app: join(home, 'new', 'app'), cwd: home, histories: join(home, 'mac'), pi: { command: join(home, 'no-such-pi'), args: [] }, npm: { command: process.execPath, args: [join(import.meta.dirname, '../test/fake-npm.ts')] },
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
  async function open(tabs: string[], { width = 1280, height = 800, dark = allDark, at = server.page, ready = 'Message', cutOff = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-GB' });
    await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs, profile: tabs[0], selected: {} }));
    // The seeded chats have agents saved as working, which with no Pi on the profile were cut off: the bar that offers to resume
    // them is dismissed, except in its own pictures (`cutOff`).
    if (!cutOff) await context.addInitScript(dismissed => localStorage.setItem('optchat-app-cut-off', dismissed), JSON.stringify(Object.fromEntries(readdirSync(join(home, 'profiles')).map(name => [name, Number.MAX_SAFE_INTEGER]))));
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW + 42_000);
    await page.goto(at);
    if (ready) await page.getByRole('textbox', { name: ready }).waitFor();
    return page;
  }
  // A code block gets its colours once Shiki's chunks are fetched: the picture waits for the page to have nothing left to fetch,
  // and then for what moves (a row that opens, 200 ms) to have come to rest.
  const shot = async (page: Page, name: string, hovered?: Locator) => { await (hovered ? hovered.hover() : page.mouse.move(0, 0)); await page.waitForLoadState('networkidle'); await page.waitForFunction(() => !document.querySelector('[aria-busy=true]')); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `${name}.png`) }); console.log(join(out, `${name}.png`)); };
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
  // ⌥↑ takes them back into the box while the run goes on; sent again as they were, the run ends as before.
  await work.keyboard.press('Alt+ArrowUp');
  await work.getByLabel('Messages waiting for the agent').waitFor({ state: 'detached' });
  await shot(work, '05b-queued-taken-back');
  await work.getByRole('textbox', { name: 'Message' }).fill('');
  await say(work, 'Also check the tests before you finish');
  await work.getByText('waiting to be read').waitFor();
  await say(work, 'Then open the pull request', 'ControlOrMeta+Enter');
  await work.getByText('Queued for after this run').waitFor();
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
  // The window's row with the pointer on it: what its one button offers while the conversation is open, and once it is done.
  const row = work.getByRole('navigation', { name: 'Windows' }).getByRole('listitem').nth(1);
  await shot(work, '270-window-row-open', row);
  // The window renamed in place, from its row and from its title, and given back its own name after.
  const named = work.getByRole('textbox', { name: 'Window name' });
  await row.getByText('Give me a demo of this repository').dblclick();
  await named.fill('Repository demo');
  await shot(work, '273-window-rename-row');
  await work.keyboard.press('Enter');
  await row.getByText('Repository demo').waitFor();
  await shot(work, '274-window-renamed');
  await work.locator('main > header h1').dblclick();
  await shot(work, '275-window-rename-title');
  await named.fill('');
  await work.keyboard.press('Enter');
  await row.getByText('Give me a demo of this repository').waitFor();
  await work.getByRole('main').getByRole('button', { name: 'Complete' }).click();
  await work.getByText('Completed', { exact: true }).waitFor();
  await shot(work, '09-completed-window');
  await shot(work, '271-window-row-completed', row);

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
  await settings.getByRole('tab', { name: 'Appearance' }).click();
  await settings.getByText('Dark', { exact: true }).click(); // Its label: the choice is made when the server has kept it.
  await settings.locator('html.dark').waitFor();
  await settings.getByRole('tab', { name: 'General' }).click();
  await shot(settings, '16-settings-dark');
  await settings.getByRole('tab', { name: 'Appearance' }).click();
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
  // The first profile's name, when it will not do: why is said under it.
  await first.getByRole('textbox', { name: 'Profile name' }).fill('My Chat');
  await first.getByRole('button', { name: 'Create profile' }).click();
  await first.getByRole('alert').waitFor();
  await shot(first, '145-first-profile-refused');
  // Later, with a profile: the settings still say where the app's Pi is, and how to put it on your PATH.
  await first.getByRole('textbox', { name: 'Profile name' }).fill('work');
  await first.getByRole('button', { name: 'Create profile' }).click();
  // pi-optchat is not in this Pi yet, so nothing could be imported: the profile is not asked what history it brings.
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
  for (const [page, name] of [[await open(['team'], { dark: true, height: 1500 }), '42-settings-profile-dark'], [await open(['team'], { width: 420, height: 800 }), '43-settings-profile-narrow']] as const) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Profile' }).click();
    await page.locator('input[aria-label="Compactor model"][value="anthropic/claude-sonnet-5-5"]').waitFor();
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
  // The agents in the chat that started them, with the panel closed: while one works, a line each under the reply that started
  // them, and a line over the composer, which opens the list. Light, dark and narrow; and in the reply opened, under the call.
  // Its Pi is started by asking it for its commands, which says nothing in the chat: its agents are then at work with it.
  for (const [name, options] of [['156-agents-in-chat', {}], ['157-agents-in-chat-dark', { dark: true }], ['158-agents-in-chat-narrow', { width: 420, height: 800 }]] as const) {
    const page = await open(['started'], options);
    await control.request('commands', { window: 'started/main' });
    await page.getByRole('button', { name: /agents working/ }).waitFor();
    await shot(page, name);
    if (name !== '156-agents-in-chat') continue;
    await page.getByRole('button', { name: /Worked for/ }).nth(1).click();
    await page.getByText('Started 2 agents:').waitFor();
    await shot(page, '159-agents-in-chat-opened');
    await page.getByRole('button', { name: /agents working/ }).click();
    await page.getByRole('complementary').getByText('Draft the release notes').waitFor();
    await shot(page, '160-agents-from-the-composer');
  }
  // Once they have ended the reply folds them away with its work, and opened it says how each ended.
  const reports = await open(['reported']);
  await reports.getByRole('button', { name: /Worked for/ }).nth(1).click();
  await reports.getByText('Started 2 agents:').waitFor();
  await shot(reports, '161-agents-in-chat-ended');

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
  // A message is in the chat the moment it is sent, with the agent at work under it, while its Pi still starts.
  const starting = await open(['slow']);
  await say(starting, 'Summarise the release notes');
  await starting.getByText(/^Starting Pi for/).waitFor();
  await shot(starting, '101-sent-while-pi-starts');
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
  // The files an `@` lists, of the folder the chat runs in: what is at its top, a folder narrowed to as it is typed, and the
  // message once a file is taken. Light, and dark and narrow.
  await control.request('open', { profile: 'mentions', cwd: project });
  const at = await open(['mentions']), slimAt = await open(['mentions'], { width: 420, height: 800, dark: true });
  for (const page of [at, slimAt]) {
    await page.getByRole('textbox', { name: 'Message' }).pressSequentially('Why does @');
    await page.getByRole('option', { name: /^src\// }).waitFor();
  }
  await shot(at, '260-mentions');
  await shot(slimAt, '263-mentions-narrow-dark');
  await at.getByRole('textbox', { name: 'Message' }).pressSequentially('src/ui/co');
  await at.getByRole('option', { name: /^Composer\.tsx/ }).waitFor();
  await at.waitForTimeout(300);
  await shot(at, '261-mentions-folder');
  for (const key of ['ArrowDown', 'ArrowDown', 'Enter']) await at.keyboard.press(key);
  await at.getByRole('textbox', { name: 'Message' }).pressSequentially('lose its list on Esc?');
  await at.getByRole('listbox', { name: 'Files' }).waitFor({ state: 'detached' });
  await shot(at, '262-mentions-picked');
  // A line of a report selected, and the button that cites it; then two citations as chips over what is typed, as cards in
  // the message once it is sent, and the same message as the log has it, dark and narrow.
  const citing = await open(['cites']), cite = citing.getByRole('button', { name: 'Cite', exact: true });
  await citing.locator('[data-cite] li', { hasText: 'The snapshot is the fallback, not the default' }).click({ clickCount: 3 });
  await cite.waitFor();
  await shot(citing, '72-cite-selection');
  await cite.click();
  await citing.locator('[data-cite] p', { hasText: 'Started two agents.' }).click({ clickCount: 3 });
  await cite.click();
  await citing.getByRole('textbox', { name: 'Message' }).fill('Is that still how ours works?');
  await shot(citing, '150-cited-in-composer');
  await citing.keyboard.press('Enter');
  await citing.getByText('reply', { exact: true }).waitFor();
  await shot(citing, '151-cited-message');
  await shot(await open(['cites'], { dark: true }), '152-cited-message-dark');
  await shot(await open(['cites'], { width: 420, height: 800 }), '153-cited-message-narrow');
  // The memory view: a line cited whole by its button, which is there for the line the keys are on, and a card opened where it is.
  await citing.keyboard.press('Alt+m');
  await citing.locator('[data-line]').first().hover();
  await citing.getByRole('button', { name: 'Cite this line' }).first().click();
  await citing.locator('[data-line]').nth(1).focus();
  await shot(citing, '154-memory-cite');
  await citing.keyboard.press('Alt+m');
  await citing.locator('[data-cited]').first().click();
  await citing.locator('[data-found]').waitFor();
  await shot(citing, '155-cited-in-memory');
  // Find in the chat: what is typed is marked wherever the chat shows it, with the match it is at marked stronger, and under the
  // box the way on to the memory, which is all there is to press for a text the chat does not have.
  for (const [name, options, text] of [['146-find-in-chat', {}, 'snapshot'], ['147-find-in-chat-dark', { dark: true }, 'snapshot'], ['148-find-in-chat-narrow', { width: 420 }, 'snapshot'], ['149-find-nothing', {}, 'heartbeat']] as const) {
    const page = await open(['team'], options);
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type(text);
    await page.getByRole('search', { name: 'Find in chat' }).locator('[aria-live]').waitFor();
    await shot(page, name);
  }
  // A message that runs a skill: the skill by its name over what was typed, and its file once the name is clicked.
  for (const [name, options] of [['162-skill-message', {}], ['163-skill-message-dark', { dark: true }]] as const) {
    const page = await open(['skills'], options);
    await shot(page, name);
    if (name !== '162-skill-message') continue;
    await page.getByRole('button', { name: 'sol-loop' }).click();
    await shot(page, '164-skill-opened');
  }
  // And one sent in a run, waiting under the chat as Pi has it: by its name too.
  const steering = await open(['skills']);
  await say(steering, 'wait');
  await steering.getByRole('button', { name: 'Stop the agent' }).waitFor();
  await steering.getByRole('textbox', { name: 'Message' }).fill('/skill:use-codex');
  await steering.getByRole('option', { name: '/skill:use-codex' }).waitFor();
  await steering.getByRole('textbox', { name: 'Message' }).pressSequentially(' is the fix right?');
  await steering.keyboard.press('Enter');
  await steering.getByLabel('Messages waiting for the agent').getByRole('button', { name: 'use-codex' }).waitFor();
  await shot(steering, '165-skill-waiting');
  // Formulas in a reply, a price beside them as written, and a table with its copy buttons.
  for (const [name, options] of [['91-formulas-and-table', {}], ['92-formulas-and-table-dark', { dark: true }], ['93-formulas-and-table-narrow', { width: 420 }]] as const) {
    const page = await open(['formulas'], options);
    await page.locator('.katex-display').waitFor();
    await shot(page, name);
  }
  // A reply that shows a picture on this machine by its path, one that is gone, and one on the web as a link.
  for (const [name, options] of [['196-reply-picture', {}], ['197-reply-picture-dark', { dark: true }], ['198-reply-picture-narrow', { width: 420 }]] as const) {
    const page = await open(['pictured'], options);
    await page.getByRole('button', { name: 'Show the image large: Cache share by day' }).waitFor();
    await page.getByText('No image at').waitFor();
    await page.waitForFunction(() => [...document.images].every(image => image.complete));
    await shot(page, name);
  }
  // A call that failed, opened with the rest of the work: said by a faint red icon and a small ×, not in red words.
  for (const [name, options] of [['200-tool-failed', {}], ['201-tool-failed-dark', { dark: true }]] as const) {
    const page = await open(['failed'], options);
    await page.getByRole('button', { name: /^Worked/ }).click();
    await page.getByLabel('Failed').waitFor();
    await shot(page, name);
  }
  // A picture Pi made smaller: your message shows it without the note Pi wrote for the model under it.
  {
    const page = await open(['resized']);
    await page.getByText('Why is the gap under the composer so big?').waitFor();
    await page.waitForFunction(() => [...document.images].every(image => image.complete));
    await shot(page, '202-resized-picture');
  }
  // A reply that names files: the two in the window's folder are links to your editor, the one that is not stays code.
  // A profile's instructions, with the button that opens them in your editor, and the editors it lists.
  for (const [button, list, options] of [['139-instructions-open-in', '140-instructions-editors', {}], ['141-instructions-open-in-dark', '142-instructions-editors-dark', { dark: true }]] as const) {
    const page = await open(['notes'], options);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Instructions' }).click();
    await page.getByRole('button', { name: 'Open in VS Code' }).waitFor();
    await shot(page, button);
    await page.getByRole('button', { name: 'Open in…' }).click();
    await page.getByRole('listbox', { name: 'Editors' }).waitFor();
    await shot(page, list);
  }
  // A tool call that returned a picture, opened: light and dark, and the picture large.
  mkdirSync(join(seen, 'images'));
  copyFileSync(join(out, '11-narrow.png'), join(seen, 'images', `${SEEN_IMAGE}.png`));
  for (const [name, options] of [['166-tool-image', {}], ['167-tool-image-dark', { dark: true }]] as const) {
    const page = await open(['seen'], options);
    await page.getByRole('button', { name: /^Worked/ }).click();
    await page.getByRole('button', { name: /^Read \/tmp\/shots\/11-narrow\.png/ }).click();
    const picture = page.getByRole('button', { name: 'Show the image large: What the tool returned', exact: true });
    await picture.locator('img').evaluate(img => img instanceof HTMLImageElement && (img.complete || new Promise(done => img.addEventListener('load', done, { once: true }))));
    await shot(page, name);
    if (name !== '166-tool-image') continue;
    await picture.click();
    await page.getByRole('dialog', { name: 'The image, large' }).waitFor();
    await shot(page, '168-tool-image-large');
  }
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
  // A reply's three pictures shown large: the second, with the counter and the buttons that step, and the first zoomed into
  // twice where it was clicked, light and dark. A grid on a gradient, so the zoom shows.
  const grid = (size: number, [red, green, blue]: [number, number, number]) => png(size, (x, y) => x % 60 < 3 || y % 60 < 3 ? [255, 255, 255] : [red * (1 - y / size / 2), green * (1 - x / size / 2), blue]);
  const gallery = await open(['pictures']);
  await give(gallery, 'paste', [{ name: 'chart.png', type: 'image/png', data: grid(960, [38, 99, 235]) }, { name: 'shot.png', type: 'image/png', data: grid(480, [234, 138, 30]) }, { name: 'plan.png', type: 'image/png', data: grid(480, [22, 163, 74]) }]);
  await gallery.getByRole('list', { name: 'Images to send' }).getByRole('listitem').nth(2).waitFor();
  await gallery.getByRole('textbox', { name: 'Message' }).fill('Show me the three pictures again');
  await gallery.keyboard.press('Enter');
  for (const [page, light] of [[gallery, true], [await open(['pictures'], { dark: true }), false]] as const) {
    const replied = page.getByRole('button', { name: 'Show the image large: yours' });
    await replied.nth(2).waitFor();
    await replied.nth(1).click();
    await page.getByRole('dialog', { name: 'The image, large' }).getByText('2 / 3').waitFor();
    await shot(page, light ? '210-gallery' : '211-gallery-dark');
    await page.keyboard.press('ArrowLeft');
    const large = page.getByRole('dialog', { name: 'The image, large' }).locator('img');
    await page.waitForFunction(() => document.querySelector<HTMLImageElement>('dialog img')?.naturalWidth === 960);
    const box = await large.boundingBox();
    if (!box) throw new Error('The picture is not shown large.');
    await large.click({ position: { x: box.width * 0.3, y: box.height * 0.35 } });
    await shot(page, light ? '212-gallery-zoomed' : '213-gallery-zoomed-dark');
  }

  // What the agent is thinking, opened from the line under your message while it thinks: wide, then narrow.
  for (const [name, options] of [['101-thinking-opened', {}], ['102-thinking-opened-narrow', { width: 420 }]] as const) {
    const thinks = await open(['changes'], options);
    await say(thinks, 'Have a think about the shutdown path, and wait');
    await thinks.getByRole('button', { name: /^Thinking for/ }).click();
    await shot(thinks, name);
    await thinks.keyboard.press('Escape');
    await thinks.getByRole('button', { name: 'Send', exact: true }).waitFor();
  }

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

  // Another profile: the list of profiles with the way to a new one under it, the dialog that names it, a name there is
  // already, and the dialog narrow and dark. Nothing is made.
  const naming = await open(['work'], { width: 900, height: 520 });
  await naming.getByRole('button', { name: 'Open a profile' }).click();
  await shot(naming, '141-profiles-list');
  await naming.getByRole('button', { name: 'New profile…' }).click();
  await naming.getByRole('textbox', { name: 'Profile name' }).fill('research');
  await shot(naming, '142-new-profile');
  await naming.getByRole('textbox', { name: 'Profile name' }).fill('work');
  await naming.keyboard.press('Enter');
  await naming.getByRole('dialog').getByRole('alert').waitFor();
  await shot(naming, '143-new-profile-taken');
  const pocketed = await open(['work'], { width: 420, dark: true });
  await pocketed.getByRole('button', { name: 'Open a profile' }).click();
  await pocketed.getByRole('button', { name: 'New profile…' }).click();
  await pocketed.getByRole('textbox', { name: 'Profile name' }).fill('Not a name');
  await pocketed.keyboard.press('Enter');
  await pocketed.getByRole('dialog').getByRole('alert').waitFor();
  await shot(pocketed, '144-new-profile-refused-dark-narrow');

  // The app started again after its Pis closed with agents at work, in two profiles: `work`'s Pi crashed (its agents are still
  // saved as working) and `notes`'s closed (pi-optchat marked its agent cut off). One bar offers to resume them, a line a
  // profile, open as a tab or not. Before: the same page without it, the agents panel saying how they ended.
  const again = join(home, 'restarted');
  const crashed = createProfile(again, 'work');
  seed(crashed, TEAM.length, NOW, TEAM);
  agents(crashed, NOW + 42_000);
  const closed = createProfile(again, 'notes');
  seed(closed, 2, NOW);
  writeRun(closed, { id: '9e1f2a3b', title: 'Tidy the release checklist', task: 'Tidy docs/release.md.', state: 'interrupted', started: NOW - 30_000, ended: NOW, cutOff: true, model: 'anthropic/claude-sonnet-5', report: 'Cut off when Pi closed.' });
  const restarted = await startServer({ home: again, app: join(again, 'app'), cwd: home, pi, now: () => NOW + 42_000 });
  try {
    const before = await open(['work'], { at: restarted.page });
    await before.getByRole('button', { name: 'Agents and GitHub' }).click();
    await before.getByText('Cut off when its Pi closed').first().waitFor();
    await shot(before, '162-cut-off-before');
    const bar = await open(['work'], { at: restarted.page, cutOff: true });
    await bar.getByRole('button', { name: 'Resume the agents of notes' }).waitFor();
    await shot(bar, '163-cut-off-bar');
    const dark = await open(['work'], { at: restarted.page, cutOff: true, dark: true, width: 420 });
    await dark.getByRole('button', { name: 'Resume the agents of notes' }).waitFor();
    await shot(dark, '164-cut-off-bar-dark-narrow');
    await bar.getByRole('button', { name: 'Resume the agents of notes' }).click();
    await bar.getByRole('tab', { name: 'notes', selected: true }).waitFor();
    await bar.getByRole('button', { name: 'Resume the agents of notes' }).waitFor({ state: 'detached' });
    await shot(bar, '165-cut-off-resumed');
  } finally { await restarted.close(); }
  // A newer pi-optchat was pulled into the checkout the Pi loads it from, while the app's Pis ran the one before: `notes` had
  // nothing to do and an agent a restart cut off, `work` was in a run. Resume starts the Pi of `notes` again on the new one and
  // then works; `work`'s is not stopped unasked, and once the setup is checked again a line offers to restart it.
  const later = join(home, 'pulled'), checkout = join(later, 'pi', 'pi-optchat'), older = { command: join(later, 'pi', 'pi'), args: [] };
  const pull = (version: string) => writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'pi-optchat', version }));
  mkdirSync(checkout, { recursive: true });
  pull('0.12.1');
  writeFileSync(join(later, 'pi', 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic'], packages: { [checkout]: checkout } }));
  writeFileSync(older.command, `#!/bin/sh\nFAKE_PI_HOME="${join(later, 'pi')}" exec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(older.command, 0o755);
  seed(createProfile(later, 'work'), TEAM.length, NOW, TEAM);
  const notes = createProfile(later, 'notes');
  seed(notes, 2, NOW);
  writeRun(notes, { id: '9e1f2a3b', title: 'Tidy the release checklist', task: 'Tidy docs/release.md.', state: 'interrupted', started: NOW - 30_000, ended: NOW, cutOff: true, model: 'anthropic/claude-sonnet-5', report: 'Cut off when Pi closed.' });
  const behind = await startServer({ home: later, app: join(later, 'app'), cwd: home, pi: older, now: () => NOW + 42_000 }), asked = await connect(behind.url);
  try {
    for (const [profile, text] of [['notes', 'hello'], ['work', 'wait for me']]) {
      const { window } = await asked.request('open', { profile });
      await asked.request('prompt', { window: window.id, text });
    }
    while ((await asked.request('windows', {})).windows.find(window => window.id === 'notes/main')?.status !== 'idle') await new Promise(resolve => setTimeout(resolve, 50));
    pull('0.12.2');
    const resume = await open(['work'], { at: behind.page, cutOff: true });
    await resume.getByRole('button', { name: 'Resume the agents of notes' }).click();
    await resume.getByRole('tab', { name: 'notes', selected: true }).waitFor();
    await resume.getByRole('button', { name: 'Resume the agents of notes' }).waitFor({ state: 'detached' });
    await resume.getByText('pi-optchat is too old for this app.').waitFor({ state: 'detached' }); // The setup looked again.
    await shot(resume, '232-older-pi-resumed');
    await asked.request('setup', { fresh: true }); // The setup's "Check again", as after a pull.
    for (const [name, dark] of [['230-older-pi-at-work', false], ['231-older-pi-at-work-dark', true]] as const) {
      const page = await open(['work'], { at: behind.page, dark });
      await page.getByRole('button', { name: 'Restart the Pi of work' }).waitFor();
      await shot(page, name);
    }
  } finally { asked.close(); await behind.close(); }
  // The Import page: its way in from the list of profiles, the sources found, the projects of two of them, a pick with what
  // the footer says of it (and its warnings), a filter, dark and narrow, a ChatGPT export given, and a profile with no messages,
  // which is not asked how they join. Then the import itself: running, the chat it takes, paused, and done.
  {
    const looked = async (page: Page) => { await page.getByRole('heading', { name: /Import into/ }).waitFor(); await page.getByText('Looking…').first().waitFor({ state: 'detached' }); };
    const counted = (page: Page) => page.getByText('Counting…').waitFor({ state: 'detached' });
    const toImport = async (profile: string, options: Parameters<typeof open>[1] = {}) => {
      const page = await open([profile], options);
      await page.getByRole('button', { name: 'Open a profile' }).click();
      await page.getByRole('button', { name: 'Import history…' }).click();
      await looked(page);
      return page;
    };
    const source = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sources' }).getByText(name, { exact: true }).click();
    const pickSome = async (page: Page) => {
      await source(page, 'Claude Code');
      await source(page, 'Codex');
      for (const project of ['~/code/garden-planner', '~/work/invoice-service', '~/tmp/scratch']) await page.getByRole('checkbox', { name: `All of ${project}` }).first().check();
      await page.getByRole('button', { name: /recipe-box/ }).first().click();
      const opened = page.locator('li:has(button[aria-expanded=true]) > ul');
      for (const at of [0, 2, 3]) await opened.getByRole('checkbox').nth(at).check();
      await counted(page);
    };
    const into = await open(['history'], { width: 1280, height: 800 });
    await into.getByRole('button', { name: 'Open a profile' }).click();
    await shot(into, '170-import-in-profiles-list');
    await into.getByRole('button', { name: 'Import history…' }).click();
    await looked(into);
    await shot(into, '171-import-sources');
    await source(into, 'Claude Code');
    await source(into, 'Codex');
    await shot(into, '172-import-projects');
    await source(into, 'Claude Code');
    await source(into, 'Codex');
    await pickSome(into);
    await shot(into, '173-import-picked');
    await into.getByText('Rebuild from scratch').click();
    await counted(into);
    await shot(into, '186-import-rebuild');
    await into.getByText('Append', { exact: true }).click();
    await into.getByRole('button', { name: /warning/ }).click();
    await shot(into, '174-import-warnings');
    await into.getByRole('textbox', { name: 'Filter projects and conversations' }).fill('tide');
    await into.getByText('3 months').click();
    await shot(into, '175-import-filter-range');
    const shade = await toImport('history', { dark: true });
    await pickSome(shade);
    await shot(shade, '176-import-picked-dark');
    const thin = await toImport('history', { width: 420, height: 800 });
    await pickSome(thin);
    await shot(thin, '177-import-picked-narrow');
    const exported = join(home, 'conversations.json');
    writeFileSync(exported, chatgptExport(12, NOW));
    await thin.close();
    await into.getByRole('textbox', { name: 'Filter projects and conversations' }).fill('');
    await into.getByText('All', { exact: true }).click();
    await into.locator('input[type=file]').setInputFiles(exported);
    await into.getByRole('navigation', { name: 'Sources' }).getByText('ChatGPT export', { exact: true }).waitFor();
    await counted(into);
    await shot(into, '178-import-chatgpt');
    const blank = await toImport('research');
    await source(blank, 'Claude Code');
    await blank.getByRole('checkbox', { name: 'All of ~/code/garden-planner' }).check();
    await counted(blank);
    await shot(blank, '179-import-new-profile');
    await into.getByRole('button', { name: 'Start import' }).click();
    await into.getByText('Importing into history').waitFor();
    await shot(into, '180-import-running');
    await shot(await toImport('history', { dark: true, ready: '' }), '181-import-running-dark');
    await into.getByRole('button', { name: 'Close the import' }).click();
    await into.getByRole('status').getByText(/Importing/).waitFor();
    await shot(into, '182-import-chat-line');
    await shot(await open(['history'], { width: 420, height: 800, dark: true, ready: '' }).then(async page => { await page.getByRole('status').getByText(/Importing/).waitFor(); return page; }), '183-import-chat-line-narrow-dark');
    await into.getByRole('button', { name: 'Show' }).click();
    await into.getByRole('button', { name: 'Pause' }).click();
    await into.getByText('Import paused').waitFor();
    await shot(into, '184-import-paused');
    await into.getByRole('button', { name: 'Resume' }).click();
    await into.getByText('Importing into history').waitFor();
    writeFileSync(join(history, 'import-done'), '');
    await into.getByText('Imported into history').waitFor();
    await shot(into, '185-import-done');
    await into.getByRole('button', { name: 'Open memory' }).click();
    await into.getByRole('button', { name: 'Import…' }).waitFor();
    await shot(into, '187-memory-import-button');
  }

  // A new profile's second step: what history it brings, by source, none picked; two picked, dark and narrow; and the
  // Import page they open on.
  {
    const made = async (page: Page, name: string) => {
      await page.getByRole('button', { name: 'Open a profile' }).click();
      await page.getByRole('button', { name: 'New profile…' }).click();
      await page.getByRole('textbox', { name: 'Profile name' }).fill(name);
      await page.keyboard.press('Enter');
      const step = page.getByRole('dialog', { name: 'Bring your history' });
      await step.getByText('Looking…').first().waitFor({ state: 'detached' });
      return step;
    };
    const onboarding = await open(['work'], { width: 1280, height: 800 });
    const second = await made(onboarding, 'garden');
    await shot(onboarding, '189-new-profile-bring');
    // Claude Code and Codex, first and third of the cards.
    for (const at of [0, 2]) await second.getByRole('checkbox').nth(at).click();
    await shot(onboarding, '190-new-profile-bring-picked');
    const pocket = await open(['work'], { width: 420, dark: true });
    await made(pocket, 'tides');
    await shot(pocket, '191-new-profile-bring-dark-narrow');
    await second.getByRole('button', { name: 'Choose what to import…' }).click();
    await onboarding.getByRole('heading', { name: 'Import into garden' }).waitFor();
    await onboarding.getByText('Looking…').first().waitFor({ state: 'detached' });
    await shot(onboarding, '192-new-profile-import');
    // The first profile, named on the first page of a machine with Pi and pi-optchat set up: the dialog is its second step alone.
    const blank = join(home, 'blank');
    mkdirSync(blank);
    const set = await startServer({ home: blank, app: join(blank, 'app'), cwd: home, histories: join(home, 'mac'), pi, now: () => NOW + 42_000 });
    try {
      const welcome = await open([], { at: set.page, ready: 'Profile name' });
      await welcome.getByRole('textbox', { name: 'Profile name' }).fill('work');
      await welcome.keyboard.press('Enter');
      await welcome.getByRole('dialog', { name: 'Bring your history' }).getByText('Looking…').first().waitFor({ state: 'detached' });
      await shot(welcome, '188-first-profile-bring');
      await welcome.context().close();
    } finally { await set.close(); }
    // A Mac where none of the tools kept anything: it says so, and offers a ChatGPT export.
    const bare = join(home, 'bare');
    mkdirSync(bare);
    const nothing = await startServer({ home: bare, app: join(bare, 'app'), cwd: home, pi, now: () => NOW + 42_000 });
    try {
      const welcome = await open([], { at: nothing.page, ready: 'Profile name' });
      await welcome.getByRole('textbox', { name: 'Profile name' }).fill('work');
      await welcome.keyboard.press('Enter');
      await welcome.getByRole('dialog', { name: 'Bring your history' }).getByText(/was found on this Mac/).waitFor();
      await shot(welcome, '193-first-profile-nothing-found');
      await welcome.context().close();
    } finally { await nothing.close(); }
  }

  // The desktop app's update button, at the sidebar's foot, in each thing its updater does. Last: from here on the server has
  // an updater, so every page has the button.
  const updates = await open(['work'], { width: 900, height: 420 });
  for (const [name, state] of [
    ['131-update-idle', { state: 'idle', looked: false }], ['132-update-looking', { state: 'looking' }], ['133-update-downloading', { state: 'downloading', version: '1.1.0', percent: 40 }],
    ['134-update-ready', { state: 'ready', version: '1.1.0' }], ['135-update-manual', { state: 'manual', version: '1.1.0', page: 'https://github.com/jonaslsaa/optchat-app/releases' }],
    ['136-update-failed', { state: 'failed', error: 'GitHub answered 403.' }],
  ] as const) {
    server.updating(state);
    await updates.locator(`[data-update="${state.state}"]`).waitFor();
    await shot(updates, name);
  }
  // With the sidebar closed it is in the top row, while there is something to say: wide, then narrow and dark.
  server.updating({ state: 'ready', version: '1.1.0' });
  await updates.getByRole('button', { name: 'Toggle the sidebar' }).click();
  await shot(updates, '137-update-sidebar-closed');
  await shot(await open(['work'], { width: 420, dark: true }), '138-update-narrow-dark');

  // Themes, last too: the page's colours change for every page. The Appearance tab, with a file of yours that is no theme.
  mkdirSync(join(home, 'app', 'themes'), { recursive: true });
  writeFileSync(join(home, 'app', 'themes', 'sunset.json'), JSON.stringify({ version: 1, name: 'Sunset', appearance: 'dark', colors: { background: 'url(https://example.com/x.png)' } }));
  for (const [name, dark] of [['240-appearance', false], ['241-appearance-dark', true]] as const) {
    const page = await open(['work'], { dark, height: 1240 });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByText('Not a theme.').waitFor();
    await shot(page, name);
  }
  // Each theme in light and dark, with its drawing at the sidebar's top over a list of windows, two profiles' tabs and the
  // update button: the chat of 02, with seven connected windows more.
  for (let n = 0; n < 7; n++) await control.request('open', { profile: 'work', role: 'connected' });
  const themes = ['optchat', 'blossom', 'grove', 'ocean', 'ember', 'iris'];
  for (const [k, theme] of themes.entries()) {
    await control.request('setSettings', { palette: theme === 'optchat' ? { light: null, dark: null } : { light: theme, dark: theme } });
    for (const dark of [false, true]) {
      const page = await open(['work', 'notes'], { dark });
      await page.getByText('which is the point of that test').last().waitFor();
      if (theme !== 'optchat') await page.locator('html[data-art]').waitFor();
      await shot(page, `${242 + 2 * k + Number(dark)}-theme-${theme}${dark ? '-dark' : ''}`);
    }
  }
  // The drawing turned off, and a narrow page with the sidebar open.
  await control.request('setSettings', { palette: { light: 'grove', dark: 'grove' }, art: false });
  await shot(await open(['work']), '254-theme-grove-no-art');
  await control.request('setSettings', { art: true });
  const tiny = await open(['work'], { width: 420, height: 800, dark: true });
  await tiny.getByRole('button', { name: 'Toggle the sidebar' }).click();
  await shot(tiny, '255-theme-grove-narrow-dark');
  // A Complete its Pi never answers: the row offers to close the window instead. Last, as it leaves a handoff in that chat.
  await control.request('setSettings', { palette: { light: null, dark: null } });
  const hung = await open(['empty']), waiting = hung.getByRole('navigation', { name: 'Windows' }).getByRole('listitem').nth(1);
  await hung.getByRole('button', { name: 'New window' }).click();
  await say(hung, 'Give me a demo of this repository, and hold Complete');
  await hung.getByRole('main').getByRole('button', { name: 'Complete' }).waitFor();
  await waiting.hover();
  await waiting.getByRole('button', { name: 'Complete', exact: true }).click();
  await shot(hung, '272-window-row-completing', waiting);
  await hung.getByRole('button', { name: 'Close window' }).click();
  await waiting.waitFor({ state: 'detached' });
  await hung.close();
}
