import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { agents, seed, TEAM } from '../scripts/seed.ts';
import { connect } from '../src/client.ts';
import { startServer } from '../src/server/server.ts';
import { createProfile, temporaryHome, writeMemory, writeRun } from './support.ts';

/** `npm run test:ui`: whose a key is and where the focus goes, which only a browser decides. The page is built and driven in
 * your installed Chrome, headless, against the fake Pi and throwaway profiles under /tmp: no model, no network, nothing of
 * yours is read. Each test has a profile of its own, with the agents and the chat of the screenshots' `team`. */
const home = temporaryHome(), pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
// A machine that is set up: Pi with pi-optchat in it and two providers logged in, so there are models to pick.
process.env.FAKE_PI_HOME = join(home, 'pi');
mkdirSync(join(home, 'pi', 'pi-optchat'), { recursive: true });
writeFileSync(join(home, 'pi', 'pi-optchat', 'package.json'), JSON.stringify({ name: 'pi-optchat', version: '0.11.12' }));
writeFileSync(join(home, 'pi', 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic', 'openai'], packages: { 'npm:pi-optchat': join(home, 'pi', 'pi-optchat') } }));
for (const name of ['chat', 'beside', 'sheet', 'memory', 'rows', 'menus', 'fields', 'asks', 'windows', 'importing', 'keys', 'spend', 'commands', 'arrows', 'mute']) {
  const profile = createProfile(home, name);
  if (['memory', 'windows', 'keys', 'spend', 'arrows'].includes(name)) { writeMemory(profile, 16); continue; }
  seed(profile, TEAM.length, Date.now(), TEAM);
  agents(profile, Date.now());
  // More that ended than the list shows at first.
  for (let i = 0; i < 6; i++) writeRun(profile, { id: `e000000${i}`, title: `An older agent ${i}`, state: 'completed', started: Date.now() - 9_000_000 - i * 1000, ended: Date.now() - 8_000_000, report: 'Done.' });
}
mkdirSync(join(home, 'new'));

let server: Awaited<ReturnType<typeof startServer>>, fresh: typeof server, browser: Browser;
before(async () => {
  await build({ logLevel: 'warn' });
  server = await startServer({ home, app: join(home, 'app'), cwd: home, pi });
  // A machine with no profile yet, for the first one's name.
  fresh = await startServer({ home: join(home, 'new'), app: join(home, 'new', 'app'), cwd: home, pi });
  browser = await chromium.launch({ channel: 'chrome' });
});
after(async () => { await browser?.close(); await Promise.all([server?.close(), fresh?.close()]); });

const WIDE = { width: 1280, height: 800 }, NARROW = { width: 420, height: 800 };
/** A page with one profile open, or the first run's page where there is none. */
async function open(profile?: string, viewport = WIDE) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  if (profile) await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs: [profile], profile, selected: {} }));
  const page = await context.newPage();
  await page.goto(profile ? server.page : fresh.page);
  if (profile) await page.getByRole('textbox', { name: 'Message' }).waitFor();
  return page;
}
const stop = (page: Page) => page.getByRole('button', { name: 'Stop the agent' });
/** The main agent at work until it is stopped. */
async function run(page: Page) {
  await page.getByRole('textbox', { name: 'Message' }).fill('wait');
  await page.keyboard.press('Enter');
  await stop(page).waitFor();
}
/** Esc stops the main agent. */
async function stops(page: Page, where: string) {
  await page.keyboard.press('Escape');
  await stop(page).waitFor({ state: 'detached', timeout: 5000 }).catch(() => assert.fail(`Esc ${where} did not stop the run.`));
}
/** Esc, and the main agent is still at work a moment later. */
async function goesOn(page: Page, where: string) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.ok(await stop(page).isVisible(), `Esc ${where} stopped the run.`);
}
/** What has the focus, as a reader would name it, and `the page` when nothing has. */
const focused = (page: Page) => page.evaluate(() => {
  const at = document.activeElement;
  return !at || at === document.body ? 'the page' : at.getAttribute('aria-label') ?? at.textContent?.trim().slice(0, 40) ?? at.tagName;
});
/** The focus on nothing, as when what had it is gone. */
const lose = (page: Page) => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
const panel = (page: Page) => page.getByLabel('Agents and GitHub', { exact: true }).last();
const agent = (page: Page, title: string) => panel(page).getByRole('button', { name: title });
const back = (page: Page) => page.getByRole('button', { name: 'Back to the lists' });

test('Esc stops the run when the keys are in the chat, or outside every part that has its own: on the windows at the left, after a notice is dismissed', async () => {
  const page = await open('chat');
  await run(page);
  await stops(page, 'in the composer');
  await run(page);
  await page.getByText('Started two agents.').click();
  await stops(page, 'after a click on the transcript');
  await run(page);
  await page.getByRole('button', { name: 'Toggle the sidebar' }).focus();
  await stops(page, 'on a button of the chat\'s top row');
  await run(page);
  await lose(page);
  await stops(page, 'with the focus on nothing');
  // The windows at the left have no keys of their own.
  await run(page);
  await page.getByRole('button', { name: 'New window' }).focus();
  await stops(page, 'on the sidebar');
  await run(page);
  await page.getByRole('button', { name: 'New window' }).focus();
  await lose(page);
  await stops(page, 'with the focus lost on the sidebar');
  // A notice that is dismissed takes its button, and the focus, with it.
  await run(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('textbox', { name: 'Folder for new windows' }).fill('/no/such/folder');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Dismiss' }).waitFor();
  await page.getByRole('button', { name: 'Close the settings' }).click();
  await stop(page).waitFor();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  assert.equal(await focused(page), 'the page');
  await stops(page, 'after a notice was dismissed');
  // Stopped with its button, the focus is where the next message is typed.
  await run(page);
  await stop(page).click();
  await stop(page).waitFor({ state: 'detached' });
  assert.equal(await focused(page), 'Message');
});

test('the usage page closes on Esc and the run goes on, and it reads the ledger again when the main chat changes', async () => {
  // An answer of a model as pi-optchat writes it to a profile's ledger, a minute ago.
  const ledger = join(home, 'profiles', 'spend', 'usage.jsonl'), spent = (id: string, total: number) => appendFileSync(ledger, `${JSON.stringify({ id, date: new Date(Date.now() - 60_000).toISOString(), role: 'main', model: 'claude-opus-5-5',
    usage: { input: 10, output: 20, cacheRead: 70, cacheWrite: 0, totalTokens: 100, cost: { input: 0, output: total, cacheRead: 0, cacheWrite: 0, total } } })}\n`);
  spent('one', 1);
  const page = await open('spend'), usage = page.getByRole('button', { name: 'Usage' });
  await run(page);
  await usage.click();
  await page.getByText('$1.00').first().waitFor();
  assert.ok(await page.getByRole('radio', { name: 'Last hour' }).isVisible());
  await page.keyboard.press('Escape');
  await usage.waitFor();
  await page.waitForTimeout(400);
  assert.ok(await stop(page).isVisible(), 'Esc on the usage page stopped the run.');
  // The ledger grows while the page is open: it is read again when the run ends, which the server pushes.
  await usage.click();
  await page.getByText('$1.00').first().waitFor();
  spent('two', 2.5);
  const client = await connect(server.url);
  await client.request('abort', { window: 'spend/main' });
  client.close();
  await page.getByText('$3.50').first().waitFor({ timeout: 5000 });
});

test('Esc in a question Pi asks answers no, and the run goes on with that', async () => {
  const page = await open('asks'), question = page.getByRole('dialog', { name: 'Go on?' });
  await page.getByRole('textbox', { name: 'Message' }).fill('ask');
  await page.keyboard.press('Enter');
  await question.waitFor();
  assert.equal(await focused(page), 'Yes');
  await page.keyboard.press('Escape');
  // A run that is stopped at its question says nothing more: this one answers with what it was told.
  await page.getByText('confirmed: false').waitFor({ timeout: 5000 }).catch(() => assert.fail('Esc in a question stopped the run.'));
  assert.equal(await question.count(), 0, 'the question is gone');
});

test('a message pi-optchat does not take is back in the box with what it said about it, which Esc or its button takes away', async () => {
  const page = await open('importing'), box = page.getByRole('textbox', { name: 'Message' });
  const said = page.getByRole('status').filter({ hasText: 'This profile has an import in progress.' });
  await box.fill('Summarise the release notes');
  await page.keyboard.press('Enter');
  await said.waitFor({ timeout: 5000 }).catch(() => assert.fail('Nothing says why the message was not taken.'));
  // The notice comes before Pi's answer to the message, and the message is back once that has come.
  await page.locator('textarea:text-is("Summarise the release notes")').waitFor({ timeout: 5000 }).catch(() => assert.fail('The message is not back in the box.'));
  // Esc is the chat's: with no run to stop, it takes the notice away, and from beside the chat it does not.
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  await agent(page, 'How T3 Code reconnects').click();
  await page.keyboard.press('Escape');
  await back(page).waitFor({ state: 'detached' });
  assert.equal(await said.count(), 1, 'Esc in the panel left the notice');
  await box.focus();
  await page.keyboard.press('Escape');
  await said.waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await box.inputValue(), 'Summarise the release notes');
  // It was never said in the chat, so ↑ does not take it for one of the messages it goes through.
  await page.keyboard.press('ArrowUp');
  assert.equal(await box.inputValue(), 'Summarise the release notes');
  // Sent again it is said again, once; its button takes it away and leaves the focus where you type.
  await page.keyboard.press('Enter');
  await said.waitFor();
  await said.getByRole('button', { name: 'Dismiss' }).click();
  await said.waitFor({ state: 'detached' });
  assert.equal(await focused(page), 'Message');
});

test('a / at the start of a message lists Pi\'s commands: typing finds one, the arrows move, Tab or Enter takes it, and Esc closes the list and nothing else', async () => {
  const page = await open('commands'), box = page.getByRole('textbox', { name: 'Message' }), list = page.getByRole('listbox', { name: 'Commands' });
  const at = () => list.locator('[data-at]').innerText();
  await run(page);
  await box.pressSequentially('/');
  await list.getByRole('option', { name: '/skill:sol-loop' }).waitFor({ timeout: 5000 }).catch(() => assert.fail('No list of commands opened.'));
  assert.deepEqual(await list.getByRole('option').evaluateAll(rows => rows.map(row => row.firstElementChild?.textContent)),
    ['/fix-tests', '/skill:sol-loop', '/skill:use-codex', '/skill:write-a-skill', '/optchat instructions', '/optchat import', '/mcp']);
  // The arrows go round the list while the typing stays in the message.
  await page.keyboard.press('ArrowUp');
  assert.match(await at(), /^\/mcp/);
  // With Shift an arrow is the text's: it selects, and the list stays where it is.
  await page.keyboard.press('Shift+ArrowUp');
  assert.match(await at(), /^\/mcp/);
  await page.keyboard.press('ArrowRight'); // Nothing is selected again, with the caret at the end.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.match(await at(), /^\/skill:sol-loop/);
  assert.equal(await focused(page), 'Message');
  await box.pressSequentially('use');
  assert.deepEqual(await list.getByRole('option').count(), 1);
  // Esc closes the list and the list stays shut while the same command is typed on. The run goes on: the button that stops
  // it is there again once the box is empty.
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  await box.pressSequentially('-');
  assert.equal(await list.count(), 0);
  await box.fill('');
  await page.waitForTimeout(400);
  assert.ok(await stop(page).isVisible(), 'Esc in the list of commands stopped the run.');
  // A click on the model beside it closes the list of commands: only one list is open.
  await box.pressSequentially('/');
  await list.waitFor();
  await page.getByRole('button', { name: 'Model' }).click();
  await list.waitFor({ state: 'detached', timeout: 5000 }).catch(() => assert.fail('The list of commands stayed open under the model list.'));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Model' }).waitFor({ state: 'detached' });
  await box.fill('');
  // A new command opens it again. Tab takes the row, with a space for what follows, and the list is gone.
  await box.pressSequentially('/sol');
  await page.keyboard.press('Tab');
  assert.equal(await box.inputValue(), '/skill:sol-loop ');
  assert.equal(await list.count(), 0);
  assert.equal(await focused(page), 'Message');
  // Enter takes it too, and does not send the half-typed name; Enter on a name typed in full sends it.
  await box.fill('');
  await box.pressSequentially('/fix');
  await page.keyboard.press('Enter');
  assert.equal(await box.inputValue(), '/fix-tests ');
  await box.fill('');
  await box.pressSequentially('/fix-tests');
  await list.waitFor();
  await page.keyboard.press('Enter');
  await page.getByLabel('Messages waiting for the agent').getByText('/fix-tests').waitFor();
  assert.equal(await box.inputValue(), '');
});

test('while Pi is still asked for its commands, Enter sends nothing: half a name is not a message', async () => {
  // This Pi never answers, so the list never comes.
  const page = await open('mute'), box = page.getByRole('textbox', { name: 'Message' });
  await box.pressSequentially('/fix');
  await page.getByText('Asking Pi for its commands…').waitFor();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await box.inputValue(), '/fix', 'Enter sent the half-typed name.');
  // Closed with Esc, the list is out of the way, and the keys are the message's again.
  await page.keyboard.press('Escape');
  await page.getByText('Asking Pi for its commands…').waitFor({ state: 'detached' });
});

test('with the list of commands open ↑ and ↓ are its own, and bring back what you said only once it is closed', async () => {
  const page = await open('arrows'), box = page.getByRole('textbox', { name: 'Message' }), list = page.getByRole('listbox', { name: 'Commands' });
  const press = async (key: string) => { await page.keyboard.press(key); return box.inputValue(); };
  // A command you sent is the first message back, and being one, it opens the list.
  await box.fill('/skill:use-codex');
  await list.getByRole('option', { name: '/skill:use-codex' }).waitFor(); // Enter waits for the list, and sends a name typed in full.
  await page.keyboard.press('Enter');
  await list.waitFor({ state: 'detached' });
  await page.getByRole('main').getByText('/skill:use-codex').waitFor();
  assert.equal(await press('ArrowUp'), '/skill:use-codex');
  await list.getByRole('option', { name: '/skill:use-codex' }).waitFor();
  // The arrows are the list's now: the message stays as it is.
  assert.deepEqual([await press('ArrowUp'), await press('ArrowDown')], ['/skill:use-codex', '/skill:use-codex']);
  await box.fill('/');
  await list.getByRole('option', { name: '/mcp' }).waitFor();
  assert.deepEqual([await press('ArrowUp'), await list.locator('[data-at]').innerText()].map(text => text.split('\n')[0]), ['/', '/mcp']);
  // Closed with Esc, the list leaves them to the message again: ↑ goes on to what you said before.
  await box.fill('/skill:use-codex');
  await list.waitFor();
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  assert.equal(await press('ArrowUp'), 'message 14');
});

test('Esc in the panel beside the chat is the panel\'s: back from an agent to the list, else nothing, and the run goes on', async () => {
  const page = await open('beside');
  await run(page);
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  await page.getByRole('button', { name: 'Close the panel' }).focus();
  await goesOn(page, 'on the panel\'s Close button');
  await agent(page, 'How T3 Code reconnects').waitFor();
  // An agent is opened: the row that had the focus is gone.
  await agent(page, 'How T3 Code reconnects').click();
  await back(page).waitFor();
  await goesOn(page, 'with an agent just opened');
  await agent(page, 'How T3 Code reconnects').waitFor();
  assert.equal(await back(page).count(), 0);
  // A click on the agent's chat, which nothing in takes the focus.
  await agent(page, 'How T3 Code reconnects').click();
  await panel(page).getByText('Sequence numbers are per thread').click();
  await goesOn(page, 'after a click on the agent\'s chat');
  await agent(page, 'How T3 Code reconnects').waitFor();
  // The focus lost, as when what had it went away: the keys are still where they were.
  await agent(page, 'How T3 Code reconnects').click();
  await back(page).waitFor();
  await lose(page);
  await goesOn(page, 'with the focus lost in the panel');
  await agent(page, 'How T3 Code reconnects').waitFor();
  // The box of an agent that has ended has nothing to interrupt: the key is the panel's.
  await agent(page, 'How T3 Code reconnects').click();
  await page.getByRole('textbox', { name: 'Tell the agent' }).focus();
  await goesOn(page, 'in the box of an agent that has ended');
  await agent(page, 'How T3 Code reconnects').waitFor();
  // In the box under an agent's chat, Esc interrupts that agent: nearer than the panel, so its chat stays open.
  await agent(page, 'Draft the release notes').click();
  await page.getByRole('textbox', { name: 'Tell the agent' }).focus();
  await goesOn(page, 'in an agent\'s box');
  await panel(page).getByText('Paused ·').waitFor();
  assert.equal(await back(page).count(), 1);
  // Back in the chat, the key is the chat's again.
  await page.getByText('Started two agents.').click();
  await stops(page, 'back on the transcript');
  assert.equal(await back(page).count(), 1);
});

test('Esc in the panel as a sheet goes back from an agent to the list, then closes the sheet, and the run goes on', async () => {
  const page = await open('sheet', NARROW);
  await run(page);
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  await agent(page, 'How T3 Code reconnects').click();
  await back(page).waitFor();
  await goesOn(page, 'with an agent open');
  await agent(page, 'How T3 Code reconnects').waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 1, 'the sheet is still open');
  // In an agent's box it interrupts that agent, in the sheet as beside the chat.
  await agent(page, 'Draft the release notes').click();
  await page.getByRole('textbox', { name: 'Tell the agent' }).focus();
  await goesOn(page, 'in an agent\'s box');
  await panel(page).getByText('Paused ·').waitFor();
  await back(page).click();
  await goesOn(page, 'on the lists');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'the sheet has closed');
  assert.equal(await focused(page), 'Agents and GitHub');
});

test('Esc in the memory view does nothing to the run; in the composer under it, it stops it', async () => {
  const page = await open('memory');
  await run(page);
  await page.getByRole('radiogroup', { name: 'What the page shows' }).getByText('Memory').click();
  await page.getByRole('heading', { name: 'Memory view' }).waitFor();
  await goesOn(page, 'with the memory view just shown');
  await page.locator('[data-line]').first().click();
  await goesOn(page, 'on a line of it');
  await lose(page);
  await goesOn(page, 'with the focus lost');
  // Its search: Esc ends one, and with none on does nothing, in the box as anywhere in the view.
  const found = page.getByRole('region', { name: 'Messages found' });
  await page.keyboard.press('ControlOrMeta+f');
  assert.equal(await focused(page), 'Search the memory');
  await goesOn(page, 'in the search box, with nothing in it');
  await page.keyboard.type('message 1');
  await found.waitFor();
  await goesOn(page, 'with a search on');
  assert.equal(await found.count(), 0, 'the search has ended');
  assert.equal(await focused(page), 'Search the memory');
  await goesOn(page, 'in the search box again');
  await page.getByRole('textbox', { name: 'Message' }).focus();
  await stops(page, 'in the composer');
});

for (const [where, viewport] of [['beside the chat', WIDE], ['as a sheet', NARROW]] as const) test(`the focus stays in the panel ${where}: after Show more, after an agent is opened, and after the way back`, async () => {
  const page = await open('rows', viewport), inside = () => page.evaluate(() => document.activeElement?.closest('[aria-label="Agents and GitHub"]:not(button)') !== null);
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  // The last of them are shown, and the button that showed them is gone.
  await page.getByRole('button', { name: /^Show \d more$/ }).click();
  await agent(page, 'An older agent 5').waitFor();
  assert.equal(await inside(), true, 'after Show more');
  assert.match(await focused(page), /^An older agent/, 'on a row that was shown');
  await agent(page, 'How T3 Code reconnects').click();
  await back(page).waitFor();
  assert.equal(await focused(page), 'Back to the lists');
  await back(page).click();
  await agent(page, 'How T3 Code reconnects').waitFor();
  assert.match(await focused(page), /^.*How T3 Code reconnects/);
  assert.equal(await inside(), true, 'after the way back');
});

test('a menu that lies over the page takes Esc and gives the focus back to its button, and the run goes on', async () => {
  const page = await open('menus');
  await run(page);
  // The profiles, with the arrows through them.
  await page.getByRole('button', { name: 'Open a profile' }).click();
  await page.getByRole('listbox', { name: 'Profiles' }).waitFor();
  assert.equal(await focused(page), 'menus');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'mute'); // The next profile by name.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(page), 'memory');
  await goesOn(page, 'in the profile menu');
  assert.equal(await page.getByRole('listbox', { name: 'Profiles' }).count(), 0);
  assert.equal(await focused(page), 'Open a profile');
  // The models: a click on a row leaves the focus with the page.
  await page.getByRole('button', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await page.getByRole('button', { name: 'Model' }).getByText('Claude Sonnet 5.5').waitFor();
  await goesOn(page, 'in the model list');
  assert.equal(await page.getByRole('dialog', { name: 'Model' }).count(), 0);
  assert.equal(await focused(page), 'Model');
  // The key is the list's alone, wherever the focus went: in the box under an agent's chat it does not interrupt the agent.
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  await agent(page, 'Draft the release notes').click();
  await page.getByRole('button', { name: 'Model' }).click();
  await page.getByRole('textbox', { name: 'Tell the agent' }).focus();
  await goesOn(page, 'in the model list, with the focus in an agent\'s box');
  assert.equal(await page.getByRole('dialog', { name: 'Model' }).count(), 0);
  assert.equal(await panel(page).getByText('Working ·').count(), 1, 'the agent works on');
  assert.equal(await back(page).count(), 1, 'its chat is still open');
});

test('the windows over a narrow chat are open for one pick: a window picked, a new one and Esc close them, and that Esc does nothing else', async () => {
  const page = await open('windows', NARROW), over = page.getByRole('button', { name: 'Close the sidebar' }), beside = page.getByRole('navigation', { name: 'Windows' });
  const closes = async (how: string, act: () => Promise<unknown>) => {
    await page.keyboard.press('ControlOrMeta+b');
    await over.waitFor();
    await act();
    await over.waitFor({ state: 'detached', timeout: 3000 }).catch(() => assert.fail(`${how} left the windows open over the chat.`));
  };
  await closes('Picking the window in front', () => beside.getByText('Main chat').click());
  await run(page);
  await closes('Esc', () => goesOn(page, 'over the windows'));
  assert.equal(await focused(page), 'Toggle the sidebar');
  // With the model list open under them, a press closes one of the two, and the next the other.
  const models = page.getByRole('dialog', { name: 'Model' });
  await page.getByRole('button', { name: 'Model' }).click();
  await models.waitFor();
  await page.keyboard.press('ControlOrMeta+b');
  await over.waitFor();
  await goesOn(page, 'with the model list and the windows open');
  assert.equal(await models.count() + await over.count(), 1, 'one Esc closed one of the two');
  await goesOn(page, 'with one of the two still open');
  assert.equal(await models.count() + await over.count(), 0);
  // A search of the memory under them keeps what it found.
  const found = page.getByRole('region', { name: 'Messages found' });
  await page.getByRole('radiogroup', { name: 'What the page shows' }).getByText('Memory').click();
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('message 1');
  await found.waitFor();
  await closes('Esc over a search', () => goesOn(page, 'over the windows, with a search under them'));
  assert.equal(await found.count(), 1, 'the search under the windows is still on');
  // A new window is the one in front, and the keys are in its box.
  await closes('A new window', () => page.getByRole('button', { name: 'New window' }).click());
  await page.getByRole('heading', { name: 'New connected window' }).waitFor();
  assert.equal(await focused(page), 'Message');
  // Left open and the page made wide, they stand beside the chat; made narrow again, they are not over it.
  await page.keyboard.press('ControlOrMeta+b');
  await over.waitFor();
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(300);
  assert.equal(await beside.count(), 1);
  await page.setViewportSize(NARROW);
  await page.waitForTimeout(300);
  assert.equal(await beside.count(), 0, 'a window made narrow has the windows closed');
  await page.setViewportSize(WIDE);
  await beside.waitFor({ timeout: 3000 }).catch(() => assert.fail('The windows did not come back beside the chat in a wide window.'));
});

test('↑ in an empty composer brings back what you said, and ⌘F in the chat searches the memory', async () => {
  const page = await open('keys'), box = page.getByRole('textbox', { name: 'Message' });
  const press = async (key: string) => { await page.keyboard.press(key); return box.inputValue(); };
  assert.deepEqual([await press('ArrowUp'), await press('ArrowUp'), await press('ArrowDown'), await press('ArrowDown'), await press('ArrowDown')], ['message 14', 'message 12', 'message 14', '', '']);
  // What you are typing is yours: the keys move in it, as in any box.
  await box.fill('half a thought');
  assert.equal(await press('ArrowUp'), 'half a thought');
  // A message sent now is the first one back. It has two lines: ↑ on its second moves to its first, and goes on from there.
  await box.fill('said just now,\nin two lines');
  await page.keyboard.press('Enter');
  await page.getByRole('main').getByText('said just now').waitFor();
  assert.deepEqual([await press('ArrowUp'), await press('ArrowUp'), await press('ArrowUp'), await press('ArrowDown'), await press('ArrowDown')],
    ['said just now,\nin two lines', 'said just now,\nin two lines', 'message 14', 'said just now,\nin two lines', '']);
  // ⌘F is not the panel's key: from there the chat stays as it is.
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  await page.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.press('ControlOrMeta+f');
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('heading', { name: 'Memory view' }).count(), 0);
  await page.getByRole('button', { name: 'Close the panel' }).click();
  await box.focus();
  // From the chat it shows the memory view with the keys in its search box, and they stay there once the view has been read.
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('heading', { name: 'Memory view' }).waitFor();
  await page.locator('[data-line]').first().waitFor();
  assert.equal(await focused(page), 'Search the memory');
  await page.keyboard.type('message 1');
  await page.getByRole('region', { name: 'Messages found' }).waitFor();
  // Nor from the panel as a sheet over a narrow page: the chat under it stays the chat.
  const narrow = await open('keys', NARROW);
  await narrow.getByRole('button', { name: 'Agents and GitHub' }).click();
  await narrow.locator('dialog[open]').waitFor();
  await narrow.keyboard.press('ControlOrMeta+f');
  await narrow.waitForTimeout(300);
  assert.equal(await narrow.getByRole('heading', { name: 'Memory view' }).count(), 0);
});

test('a field keeps the focus when Enter saves it, and when what was typed is refused', async () => {
  const page = await open('fields');
  await page.getByRole('button', { name: 'Settings' }).click();
  const folder = page.getByRole('textbox', { name: 'Folder for new windows' });
  await folder.fill('/tmp');
  await page.keyboard.press('Enter');
  assert.equal(await focused(page), 'Folder for new windows');
  const most = page.getByRole('textbox', { name: 'Max active agents' });
  await most.fill('3');
  await page.keyboard.press('Enter');
  await page.getByText('Saved.').waitFor();
  assert.equal(await focused(page), 'Max active agents');
  await most.fill('0');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Max active agents' }).waitFor();
  assert.equal(await focused(page), 'Max active agents');
  // The first profile's name, refused: the button that was pressed is off while it is asked, and the focus is not lost with it.
  const first = await open();
  await first.getByRole('textbox', { name: 'Profile name' }).fill('not a name');
  await first.getByRole('button', { name: 'Create profile' }).click();
  await first.getByRole('alert').waitFor();
  assert.equal(await focused(first), 'Profile name');
});
