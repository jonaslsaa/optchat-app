import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { build } from 'vite';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
import { createProfile } from '../test/support.ts';
import { seed } from './seed.ts';

/** `npm run screenshots [directory]`: a PNG of every main state of the UI, in /tmp/optchat-app-shots unless a directory is named.
 * It builds the UI, serves it against throwaway profiles under /tmp with the fake Pi (no model, no network, nothing of yours is
 * read), and drives it in your installed Chrome. The same command gives the same pictures. */
const out = process.argv[2] ?? '/tmp/optchat-app-shots';
/** When the pictures are taken. The seeded chats end here, the fake Pi's messages start here, and the page's clock stands a little later. */
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
process.env.FAKE_PI_CLOCK = String(NOW);
const home = realpathSync(mkdtempSync('/tmp/optchat-app-shots-home-'));
createProfile(home, 'empty');
seed(createProfile(home, 'work'), 95, NOW); // Ends with the turn that ran the tests.
seed(createProfile(home, 'notes'), 2, NOW);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({ logLevel: 'warn' });
const server = await startServer({ home, cwd: home, pi: { command: process.execPath, args: [join(import.meta.dirname, '../test/fake-pi.ts')] } });
const control = await connect(server.url);
const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars', '--disable-gpu', '--force-color-profile=srgb'] });

/** A page that opens with these profile tabs, the first one in front. */
async function open(tabs: string[], { width = 1280, height = 800, dark = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-GB' });
  await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs, profile: tabs[0], selected: {} }));
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW + 42_000);
  await page.goto(server.page);
  await page.getByLabel('Message').waitFor();
  return page;
}
const shot = async (page: Page, name: string) => { await page.mouse.move(0, 0); await page.waitForTimeout(150); await page.screenshot({ path: join(out, `${name}.png`) }); console.log(join(out, `${name}.png`)); };
const say = async (page: Page, text: string) => { await page.getByLabel('Message').fill(text); await page.keyboard.press('Enter'); };

const empty = await open(['empty']);
await shot(empty, '01-empty-profile');

const work = await open(['work']);
await work.getByText('which is the point of that test').last().waitFor();
await shot(work, '02-long-history');
await work.getByRole('button', { name: /Worked for/ }).last().click();
await work.getByText('npm test').last().click();
await shot(work, '03-work-opened');

await say(work, 'Give me a demo of where things stand, and wait for me');
await work.getByText('What I found').waitFor();
await shot(work, '04-streaming-reply');
await say(work, 'Also check the tests before you finish');
await work.getByText('waiting to be read').waitFor();
await shot(work, '05-queued-message');
await control.request('command', { window: 'work/main', command: { type: 'release' } });
await work.getByText('Next I would wire the agents panel.').waitFor();
await work.getByText(/messages · 0 pending/).waitFor(); // Its status line is back once the agent is idle.
await shot(work, '06-reply-finished');

await work.getByRole('button', { name: 'New window' }).first().click();
await shot(work, '07-connected-window-new');
await say(work, 'Give me a demo of this repository');
await work.getByText('Next I would wire the agents panel.').waitFor();
await work.getByRole('button', { name: 'Complete' }).first().waitFor();
await shot(work, '08-connected-window');
await work.getByRole('button', { name: 'Complete' }).first().click();
await work.getByText('Completed', { exact: true }).waitFor();
await shot(work, '09-completed-window');

await work.getByRole('button', { name: 'work', exact: true }).click();
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

await browser.close();
control.close();
await server.close();
rmSync(home, { recursive: true, force: true });
