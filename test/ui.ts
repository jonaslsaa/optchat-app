import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { build } from 'vite';
import { agents, CHANGES, FILES, FORMULAS, GONE, NAMED, PICTURED, remember, seed, SEEN, SEEN_IMAGE, TEAM } from '../scripts/seed.ts';
import type { Launch } from '../src/server/files.ts';
import { connect } from '../src/client.ts';
import { ROW_EVENT } from '../src/menu.ts';
import { startServer } from '../src/server/server.ts';
import { cited, named } from '../src/ui/cite.ts';
import { describeOwner, lockProfile } from 'pi-optchat/files';
import { writeHistories } from './histories.ts';
import { createProfile, give, png, temporaryHome, writeMemory, writeRun, type Given } from './support.ts';

/** `npm run test:ui`: whose a key is and where the focus goes, which only a browser decides. The page is built and driven in
 * your installed Chrome, headless, against the fake Pi and throwaway profiles under /tmp: no model, no network, nothing of
 * yours is read. Each test has a profile of its own, with the agents and the chat of the screenshots' `team`. */
const home = temporaryHome(), pi = { command: process.execPath, args: [join(import.meta.dirname, 'fake-pi.ts')] };
// A machine that is set up: Pi with pi-optchat in it and two providers logged in, so there are models to pick.
process.env.FAKE_PI_HOME = join(home, 'pi');
mkdirSync(join(home, 'pi', 'pi-optchat'), { recursive: true });
writeFileSync(join(home, 'pi', 'pi-optchat', 'package.json'), JSON.stringify({ name: 'pi-optchat', version: '0.12.2' }));
writeFileSync(join(home, 'pi', 'state.json'), JSON.stringify({ version: '1.5.2', providers: ['anthropic', 'openai'], packages: { 'npm:pi-optchat': join(home, 'pi', 'pi-optchat') } }));
for (const name of ['bar', 'cold', 'colder', 'chat', 'beside', 'sheet', 'memory', 'rows', 'menus', 'fields', 'asks', 'windows', 'importing', 'into', 'keys', 'spend', 'commands', 'arrows', 'mute', 'said', 'images', 'gallery', 'tabs', 'slow', 'inline', 'held', 'unread', 'finish', 'renames']) {
  const profile = createProfile(home, name);
  if (['bar', 'cold', 'colder', 'memory', 'windows', 'keys', 'spend', 'arrows', 'unread'].includes(name)) { writeMemory(profile, 16); continue; }
  seed(profile, TEAM.length, Date.now(), TEAM);
  agents(profile, Date.now());
  // More that ended than the list shows at first.
  for (let i = 0; i < 6; i++) writeRun(profile, { id: `e000000${i}`, title: `An older agent ${i}`, state: 'completed', started: Date.now() - 9_000_000 - i * 1000, ended: Date.now() - 8_000_000, report: 'Done.' });
}
seed(createProfile(home, 'diffs'), CHANGES.length, Date.now(), CHANGES);
// A chat with its memory as pi-optchat would have left it: the last four messages a line each, and those before them folded.
const lines = createProfile(home, 'lines');
seed(lines, TEAM.length, Date.now(), TEAM);
remember(lines, 4);
writeMemory(createProfile(home, 'thinks'), 4);
seed(createProfile(home, 'formulas'), 1, Date.now(), FORMULAS);
writeFileSync(join(home, 'chart.png'), png(120, [38, 99, 235]));
seed(createProfile(home, 'pictured'), 1, Date.now(), PICTURED(join(home, 'chart.png')));
createProfile(home, 'paced');
createProfile(home, 'skills');
// Two things you said, the older with an `@` part of the way in, for ↑ to bring back.
writeMemory(createProfile(home, 'picking'), 4, i => ['please open @src/ser now', 'Done.', 'ok and what is next?', 'Done.'][i]);
// A chat to find in: a word in two cases, a line of code longer than the page is wide, and a long message of yours, which is
// shown cut short, with a word at its end. And one with more messages than the chat reads at first.
writeMemory(createProfile(home, 'finds'), 40, i => i === 3 ? 'Blåbær and BLÅBÆR' : i === 5 ? `\`\`\`\n${'x'.repeat(400)} farword\n\`\`\`` : i === 20 ? `${Array.from({ length: 40 }, (_, line) => `line ${line}`).join('\n')}\nthe needle` : `message ${i}`);
writeMemory(createProfile(home, 'paged'), 260);
// A chat that names files, and those files in the folder its windows run in.
seed(createProfile(home, 'files'), 1, Date.now(), NAMED);
seed(createProfile(home, 'linked'), 1, Date.now(), [[['user', 'Show me.'], ['talk', '[![the preview](/images/linked/0123456789abcdef)](test/pi.test.ts)']]]);
for (const file of FILES) { mkdirSync(join(home, file, '..'), { recursive: true }); writeFileSync(join(home, file), ''); }
// A reply whose work read a picture the profile keeps, one it no longer has, and one that printed nothing else.
const seen = createProfile(home, 'seen');
seed(seen, 1, Date.now(), [[...SEEN[0].slice(0, -1), ['tool', 'read {"path":"/tmp/shots/gone.png"}'], ['echo', 'read: Read image file [image/png]\n[image 00000000deadbeef]'],
  ['tool', 'read {"path":"/tmp/shots/only.png"}'], ['echo', `read: [image ${SEEN_IMAGE}]`], ...SEEN[0].slice(-1)]]);
mkdirSync(join(seen, 'images'));
writeFileSync(join(seen, 'images', `${SEEN_IMAGE}.png`), png(64, [38, 99, 235]));
mkdirSync(join(home, 'new'));
// Another tool's history on a made-up Mac, and a profile with no messages to import it into.
writeHistories(join(home, 'mac'), Date.now());
const brought = createProfile(home, 'brought');

let server: Awaited<ReturnType<typeof startServer>>, fresh: typeof server, browser: Browser;
// What would have started your editor: nothing does here. The editors found are these, whatever this machine has.
const launched: Launch[] = [], EDITORS = [['cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'], ['vscode', '/usr/local/bin/code'], ['zed', '/Applications/Zed.app/Contents/MacOS/cli'], ['finder', '/usr/bin/open']] as const;
before(async () => {
  await build({ logLevel: 'warn' });
  server = await startServer({ home, app: join(home, 'app'), cwd: home, histories: join(home, 'mac'), pi, launcher: launch => launched.push(launch), editors: () => new Map(EDITORS) });
  // A machine with no profile yet, for the first one's name.
  fresh = await startServer({ home: join(home, 'new'), app: join(home, 'new', 'app'), cwd: home, pi });
  browser = await chromium.launch({ channel: 'chrome' });
});
after(async () => { await browser?.close(); await Promise.all([server?.close(), fresh?.close()]); });

const WIDE = { width: 1280, height: 800 }, NARROW = { width: 420, height: 800 };
/** A page with one profile open, or the first run's page where there is none. */
async function open(profile?: string, viewport = WIDE, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  const context = await browser.newContext({ viewport, reducedMotion });
  if (profile) await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs: [profile], profile, selected: {} }));
  // The seeded chats have agents saved as working, which with no Pi on the profile were cut off: their lines over the page are
  // dismissed here, and have a test of their own.
  await context.addInitScript(dismissed => localStorage.setItem('optchat-app-cut-off', dismissed), JSON.stringify(Object.fromEntries(readdirSync(join(home, 'profiles')).map(name => [name, Number.MAX_SAFE_INTEGER]))));
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

test('⌥↑ takes the messages still waiting back into the box, in front of what is typed, and the run goes on', async () => {
  const page = await open('unread'), box = page.getByRole('textbox', { name: 'Message' }), waiting = page.getByLabel('Messages waiting for the agent');
  await run(page);
  await box.fill('Check the tests first');
  await page.keyboard.press('Enter');
  await waiting.getByText('Check the tests first').waitFor();
  await box.fill('Then open the pull request');
  await page.keyboard.press('ControlOrMeta+Enter');
  await waiting.getByText('Then open the pull request').waitFor();
  await box.fill('and say why');
  await page.keyboard.press('Alt+ArrowUp');
  await waiting.waitFor({ state: 'detached', timeout: 5000 }).catch(() => assert.fail('⌥↑ left the messages waiting.'));
  assert.equal(await box.inputValue(), 'Check the tests first\n\nThen open the pull request\n\nand say why');
  assert.deepEqual([await focused(page), await box.evaluate((area: HTMLTextAreaElement) => area.selectionStart === area.value.length)], ['Message', true]);
  await page.waitForTimeout(300);
  assert.ok(await page.getByRole('button', { name: 'Steer the agent' }).isVisible(), '⌥↑ stopped the run.');
  // With nothing waiting the key is the text's, as it was.
  await page.evaluate(() => addEventListener('keydown', event => { document.body.dataset.kept = String(event.defaultPrevented); }));
  await page.keyboard.press('Alt+ArrowUp');
  assert.deepEqual([await page.evaluate(() => document.body.dataset.kept), await box.inputValue()], ['false', 'Check the tests first\n\nThen open the pull request\n\nand say why']);
  // A message that only cites comes back as its chip, and the caret goes to the end of what is typed, which did not change.
  await box.fill('<cite>the line</cite>\n');
  await page.keyboard.press('Enter');
  await waiting.waitFor();
  await box.fill('abc');
  await box.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(1, 1));
  await page.keyboard.press('Alt+ArrowUp');
  await waiting.waitFor({ state: 'detached' });
  await page.getByLabel('Cited in the message').getByText('the line').waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label=Message]')?.selectionStart === 3, null, { timeout: 2000 }).catch(() => assert.fail('The caret stayed where it was.'));
  assert.equal(await box.inputValue(), 'abc');
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

test('the Import page opens from the memory view and closes on Esc, and the run goes on', async () => {
  const page = await open('into');
  await run(page);
  await page.getByRole('radiogroup', { name: 'What the page shows' }).getByText('Memory').click();
  await page.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('heading', { name: 'Import into into' }).waitFor();
  // Esc in its filter is the page's too: a box with nothing to clear has nothing else to do with it.
  await page.getByRole('textbox', { name: 'Filter projects and conversations' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Import into into' }).waitFor({ state: 'detached', timeout: 2000 });
  await page.waitForTimeout(400);
  assert.ok(await stop(page).isVisible(), 'Esc on the Import page stopped the run.');
});

test('an import runs from the Import page with the chat waiting under it, says when it is done, and a discard, here or anywhere, is not called done', async () => {
  const page = await open('brought'), heading = page.getByRole('heading', { name: 'Import into brought' });
  const pick = async () => {
    await page.getByRole('navigation', { name: 'Sources' }).getByText('Claude Code', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'All of ~/tmp/scratch' }).check();
    await page.getByText('Counting…').waitFor({ state: 'detached' });
    // A profile with no messages is not asked how the history joins them.
    assert.equal(await page.getByRole('radiogroup', { name: 'How the history joins the memory' }).count(), 0);
    await page.getByRole('button', { name: 'Start import' }).click();
    await page.getByRole('heading', { name: 'Importing into brought' }).waitFor();
  };
  await page.getByRole('button', { name: 'Open a profile' }).click();
  await page.getByRole('button', { name: 'Import history…' }).click();
  await heading.waitFor();
  await pick();
  // Closed, the chat has the import's line in place of its composer.
  await page.getByRole('button', { name: 'Close the import' }).click();
  await page.getByRole('status').getByText(/Importing/).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).count(), 0);
  await page.getByRole('button', { name: 'Show' }).click();
  // pi-optchat finishes it: the page says so, and opens the memory.
  writeFileSync(join(brought, 'import-done'), '');
  await page.getByRole('heading', { name: 'Imported into brought' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Open memory' }).click();
  await page.getByRole('heading', { name: 'Memory view' }).waitFor();
  // Paused and discarded on the page, with a second press: nothing was imported, and nothing is said to be.
  await page.getByRole('button', { name: 'Import…' }).click();
  await pick();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('heading', { name: 'Import paused' }).waitFor();
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: 'Discard it for good' }).click();
  await page.getByRole('button', { name: 'Start import' }).waitFor();
  // Discarded from another tab, where this page saw it paused: not done either.
  await page.getByRole('navigation', { name: 'Sources' }).getByText('Claude Code', { exact: true }).click();
  await pick();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('heading', { name: 'Import paused' }).waitFor();
  const other = await connect(server.url);
  try { await other.request('importControl', { profile: 'brought', action: 'discard' }); } finally { other.close(); }
  await page.getByRole('button', { name: 'Close the import' }).click();
  await page.getByRole('textbox', { name: 'Message' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Open a profile' }).click();
  await page.getByRole('button', { name: 'Import history…' }).click();
  await page.getByRole('button', { name: 'Start import' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Imported into brought' }).count(), 0);
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
  const waiting = page.getByRole('list', { name: 'Images to send' }).getByRole('listitem');
  await give(page, 'paste', [{ name: 'notes.png', type: 'image/png', data: png(64, [220, 60, 60]) }]);
  await waiting.waitFor();
  await box.fill('Summarise the release notes');
  await page.keyboard.press('Enter');
  await said.waitFor({ timeout: 5000 }).catch(() => assert.fail('Nothing says why the message was not taken.'));
  // The notice comes before Pi's answer to the message, and the message is back once that has come, with its image.
  await page.locator('textarea:text-is("Summarise the release notes")').waitFor({ timeout: 5000 }).catch(() => assert.fail('The message is not back in the box.'));
  assert.equal(await waiting.count(), 1, 'The image is not back with the message.');
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

test('an @ lists the files of the window\'s folder: a folder taken lists what is in it, and a file taken is in the message as Pi reads one', async () => {
  const control = await connect(server.url);
  await control.request('open', { profile: 'picking', cwd: home });
  control.close();
  const page = await open('picking'), box = page.getByRole('textbox', { name: 'Message' }), list = page.getByRole('listbox', { name: 'Files' });
  await box.pressSequentially('look at @sr');
  await list.waitFor({ timeout: 5000 }).catch(() => assert.fail('No list of files opened.'));
  await list.locator('[data-at]', { hasText: /^src\// }).waitFor({ timeout: 5000 });
  await page.keyboard.press('Enter');
  assert.equal(await box.inputValue(), 'look at @src/');
  await list.getByRole('option', { name: /^server\// }).waitFor({ timeout: 5000 });
  await box.pressSequentially('server/p');
  await list.locator('[data-at]', { hasText: /^pi\.ts/ }).waitFor({ timeout: 5000 });
  await page.keyboard.press('Tab');
  assert.equal(await box.inputValue(), 'look at @src/server/pi.ts ');
  await list.waitFor({ state: 'detached' });
  assert.equal(await focused(page), 'Message');
  // Esc closes it, and the message stays as it is.
  await box.pressSequentially('@');
  await list.waitFor();
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  assert.equal(await box.inputValue(), 'look at @src/server/pi.ts @');
  // What ↑ brings back has the caret at its end, which is where an `@` is read: not at the end of the message before it.
  await box.fill('');
  for (const key of ['ArrowUp', 'ArrowUp']) await page.keyboard.press(key);
  assert.equal(await box.inputValue(), 'please open @src/ser now');
  await page.waitForTimeout(400);
  assert.equal(await list.count(), 0, 'An @ the caret is not at opened its list.');
  await page.context().close();
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

test('a message is in the chat the moment it is sent, with the agent at work under it while its Pi still starts, and Pi\'s copy takes its place', async () => {
  // This Pi starts only once it is let go.
  const page = await open('slow'), box = page.getByRole('textbox', { name: 'Message' }), bubble = page.locator('.bg-message', { hasText: 'Please wait for the release' });
  await box.fill('Please wait for the release');
  await page.keyboard.press('Enter');
  await bubble.waitFor({ timeout: 5000 }).catch(() => assert.fail('The message is not in the chat while Pi starts.'));
  await page.getByText(/^Starting Pi for/).waitFor();
  assert.equal(await box.inputValue(), '');
  const drawn = await bubble.elementHandle();
  writeFileSync(join(home, 'pi', 'go'), '');
  // The run began, and its first record is Pi's copy of the message: the same row, once, and the agent is working.
  await stop(page).waitFor();
  await page.getByText(/^Working for/).waitFor();
  assert.equal(await page.getByText(/^Starting Pi for/).count(), 0);
  assert.deepEqual([await bubble.count(), await drawn?.evaluate(node => node.isConnected)], [1, true]);
});

test('a message that runs a skill shows the skill by its name over what was typed, from the moment it is sent and while it waits; its file only once the name is clicked; and it copies and comes back as it was typed', async () => {
  const page = await open('skills'), box = page.getByRole('textbox', { name: 'Message' }), bubble = page.locator('.bg-message').first(), chip = bubble.getByRole('button', { name: 'sol-loop' });
  const lines = async (of: Locator) => (await of.innerText()).split(/\n+/);
  const skill = async (key: string) => {
    await box.fill('/skill:sol-loop');
    await page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { name: '/skill:sol-loop' }).waitFor();
    await box.pressSequentially(' the last commit');
    await page.keyboard.press(key);
  };
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // The row that is there at once, before Pi's copy (whose name opens the file), already has the chip.
  await page.evaluate(() => new MutationObserver((_, observer) => {
    const first = document.querySelector<HTMLElement>('.bg-message');
    if (first) { document.body.dataset.first = JSON.stringify([...first.innerText.split(/\n+/), !!first.querySelector('[data-skill]')]); observer.disconnect(); }
  }).observe(document.body, { childList: true, subtree: true }));
  await skill('Enter');
  await chip.waitFor();
  assert.deepEqual(JSON.parse(await page.evaluate(() => document.body.dataset.first ?? 'null')), ['sol-loop', 'the last commit', false]);
  assert.deepEqual(await lines(bubble), ['sol-loop', 'the last commit']);
  // ⌘F finds the skill by its name, and not in its file, which is shut.
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('sol-loop');
  await page.getByRole('search', { name: 'Find in chat' }).locator('[aria-live]').getByText('1/1', { exact: true }).waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await chip.click();
  assert.deepEqual(await lines(bubble), ['sol-loop', 'References are relative to /home/.agents/skills/sol-loop.', '# sol-loop', 'Review a code change in a loop with an OpenAI GPT Sol subagent and fix what it finds, before (or after) opening a PR. Use when the user says "sol loop".', 'the last commit']);
  await bubble.hover();
  await page.getByRole('button', { name: 'Copy message' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/skill:sol-loop the last commit');
  // Sent in a run, it waits as Pi has it, the skill's file: shown by its name, and taken back with ⌥↑ as it was typed.
  await run(page);
  await skill('Enter');
  const waiting = page.getByLabel('Messages waiting for the agent').locator('p');
  await waiting.getByRole('button', { name: 'sol-loop' }).waitFor();
  assert.deepEqual(await lines(waiting), ['sol-loop', 'the last commit']);
  await page.keyboard.press('Alt+ArrowUp');
  await waiting.waitFor({ state: 'detached' });
  assert.equal(await box.inputValue(), '/skill:sol-loop the last commit');
  await page.context().close();
});

test('with the list of commands open ↑ and ↓ are its own, and bring back what you said only once it is closed', async () => {
  const page = await open('arrows'), box = page.getByRole('textbox', { name: 'Message' }), list = page.getByRole('listbox', { name: 'Commands' });
  const press = async (key: string) => { await page.keyboard.press(key); return box.inputValue(); };
  // A command you sent is the first message back, and being one, it opens the list.
  await box.fill('/skill:use-codex');
  await list.getByRole('option', { name: '/skill:use-codex' }).waitFor(); // Enter waits for the list, and sends a name typed in full.
  await page.keyboard.press('Enter');
  await list.waitFor({ state: 'detached' });
  await page.getByRole('main').getByRole('button', { name: 'use-codex' }).waitFor();
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

test('with the panel closed the agents a call started are under it, and over the composer while they work: a line opens one, the line over the composer opens the list, and each keeps up', async () => {
  const page = await open('inline'), profile = join(home, 'profiles', 'inline');
  const started = page.getByRole('list', { name: 'The agents it started' }), working = page.getByRole('button', { name: /agents? working/ });
  // The main agent at work holds the profile, so its agents are at work; its status line counts them, and that is when the
  // line over the composer is there.
  await run(page);
  await working.filter({ hasText: '2 agents working' }).waitFor();
  // The reply that started them is folded, and while one of them works they are under it. A line opens that agent's chat.
  await started.getByRole('button', { name: /Run the shutdown test on Windows/ }).click();
  await panel(page).getByRole('heading', { name: 'Run the shutdown test on Windows' }).waitFor();
  assert.equal(await working.count(), 0, 'the panel says it: no line over the composer while it is open');
  await page.getByRole('button', { name: 'Close the panel' }).click();
  await working.waitFor();
  // Read again every two seconds with the panel closed: an agent that ends is seen to end.
  writeRun(profile, { id: 'a41f09c2', title: 'Run the shutdown test on Windows', state: 'completed', started: Date.now() - 60_000, ended: Date.now(), report: 'Green on Windows.' });
  await working.filter({ hasText: '1 agent working' }).waitFor({ timeout: 5000 });
  // Both that call started have ended, so they are folded away with its work, and there when it is opened.
  assert.equal(await started.count(), 0);
  await page.getByRole('button', { name: /Worked for/ }).nth(1).click();
  await started.getByRole('button', { name: /completed Run the shutdown test on Windows.*Green on Windows\./ }).waitFor();
  // The line over the composer opens the list, and is the chat's like the rest of it: Esc there stops the run.
  await working.focus();
  await stops(page, 'on the line over the composer');
  await working.click();
  await agent(page, 'Draft the release notes').waitFor();
  assert.equal(await working.count(), 0);
  // On a narrow page the list is a sheet, and closing it gives the focus to the panel's button: the line that opened it is gone.
  const narrow = await open('inline', NARROW);
  await run(narrow);
  await narrow.getByRole('button', { name: /agents? working/ }).click();
  await agent(narrow, 'Draft the release notes').waitFor();
  await narrow.keyboard.press('Escape');
  assert.equal(await narrow.locator('dialog[open]').count(), 0, 'the sheet has closed');
  assert.equal(await focused(narrow), 'Agents and GitHub');
});

test('with a Pi in a terminal on the chat, which tells the app nothing, its agents are read every two seconds with the panel closed', async () => {
  const profile = join(home, 'profiles', 'held'), unlock = await lockProfile(profile, describeOwner({ profile: 'held', pid: process.pid, host: 'a-terminal', cwd: home }));
  try {
    const context = await browser.newContext({ viewport: WIDE, reducedMotion: 'reduce' });
    await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs: ['held'], profile: 'held', selected: {} }));
    const page = await context.newPage(), started = page.getByRole('list', { name: 'The agents it started' });
    await page.goto(server.page);
    await started.getByRole('button', { name: /Run the shutdown test on Windows/ }).waitFor();
    writeRun(profile, { id: 'a41f09c2', title: 'Run the shutdown test on Windows', state: 'completed', started: Date.now() - 60_000, ended: Date.now(), report: 'Green.' });
    await started.waitFor({ state: 'detached', timeout: 5000 });
  } finally { await unlock(); }
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

test('Complete moves a connected window\'s row to the shelf of those being handed off, and then to the closed shelf of those handed off, and the main chat is shown from the moment it begins', async () => {
  const page = await open('finish'), sidebar = page.getByRole('navigation', { name: 'Windows' }), box = page.getByRole('textbox', { name: 'Message' });
  const shelf = (name: string) => sidebar.getByRole('button', { name: new RegExp(`^${name} \\d+$`) });
  /** The buttons at the end of a row, which show with the pointer on it. */
  const offered = async (row: Locator) => { await row.hover(); return row.getByRole('button', { name: /^(Complete|Close window)$/ }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))); };
  const shown = () => sidebar.locator('[aria-current]').innerText();
  const remove = (row: Locator) => row.evaluate((row, type) => dispatchEvent(new CustomEvent(type, { detail: { window: row.getAttribute('data-row'), action: 'remove' } })), ROW_EVENT);
  const begin = async (text: string) => {
    await page.getByRole('button', { name: 'New window' }).click();
    await page.getByRole('heading', { name: 'New connected window' }).waitFor();
    await box.fill(text);
    await page.keyboard.press('Enter');
    await page.getByRole('main').getByRole('button', { name: 'Complete' }).waitFor(); // In the window's top row, once it has said something.
  };
  await begin('hello there');
  const done = sidebar.locator('li[data-row]').filter({ hasNotText: 'hold' });
  await begin('hello there, and hold Complete'); // Its Pi never answers Complete.
  const hung = sidebar.locator('li[data-row]').filter({ hasText: 'hold Complete' });
  assert.deepEqual(await offered(done), ['Complete'], 'an open conversation is completed, not closed');
  // Completed from its row while another window is shown, it goes on the shelf, turning; the one shown stays.
  await done.getByRole('button').first().click();
  await hung.hover();
  await hung.getByRole('button', { name: 'Complete', exact: true }).click();
  await shelf('Handing off').waitFor();
  assert.equal(await shelf('Handing off').getAttribute('aria-expanded'), 'true', 'open while something is handed off');
  assert.equal(await hung.getByLabel('Working').count(), 1);
  assert.deepEqual(await offered(hung), [], 'nothing to click on a handoff under way');
  assert.equal((await shown()).trim(), 'hello there', 'the window you are in stays');
  // Shown again, its top row says so and offers nothing, and Complete typed in it again is no error.
  await hung.getByRole('button').first().click();
  await page.getByRole('main').getByRole('button', { name: 'Handing off…' }).waitFor();
  assert.equal(await page.getByRole('main').getByRole('button', { name: 'Handing off…' }).isDisabled(), true);
  await box.fill('/complete');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  // Complete typed in the window you are in shows the main chat at once, and once the handoff is in, the window is on the
  // shelf of those handed off, closed, which shows only its count.
  await done.getByRole('button').first().click();
  await box.fill('/complete');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('nav [aria-current]')?.textContent?.includes('Main chat'), undefined, { timeout: 3000 });
  await shelf('Completed').waitFor();
  assert.equal(await shelf('Completed').getAttribute('aria-expanded'), 'false', 'closed until opened');
  assert.equal(await done.count(), 0);
  // ⌥ and a digit pick the rows in sight, top to bottom: the main chat, then the handoff under way.
  await page.keyboard.press('Alt+2');
  await page.waitForFunction(() => document.querySelector('nav [aria-current]')?.textContent?.includes('hold Complete'), undefined, { timeout: 3000 });
  await shelf('Completed').click();
  assert.equal(await done.getByLabel('Completed').count(), 1);
  assert.deepEqual(await offered(done), [], 'what is handed off stays, with nothing to click');
  // Closed again, it still shows the window you are in.
  await done.getByRole('button').first().click();
  await shelf('Completed').click();
  assert.equal(await done.count(), 1, 'the window shown never leaves the sidebar');
  // The desktop app's right click offers Rename and Remove on the row the page says it was on: a connected one, never the main chat.
  const menuRow = () => page.evaluate(() => document.documentElement.dataset.menuRow);
  await done.click({ button: 'right' });
  assert.equal(await menuRow(), await done.getAttribute('data-row'));
  await sidebar.getByRole('listitem').first().click({ button: 'right' });
  assert.equal(await menuRow(), undefined);
  await page.keyboard.press('Escape');
  // Its Remove, on either shelf: a Pi that never answers Complete is let go, and the Complete that failed for it says nothing.
  await remove(done);
  await done.waitFor({ state: 'detached' });
  assert.equal(await shelf('Completed').count(), 0, 'an empty shelf is not shown');
  await remove(hung);
  await hung.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('alert').count(), 0, 'no error for the Complete asked again, nor the one the close ended');
});

test('a connected window is renamed in place from its row or its title: Enter keeps the name, Esc what it was and the run goes on, and an empty name gives back the automatic one; the main chat keeps its own', async () => {
  const page = await open('renames'), windows = page.getByRole('navigation', { name: 'Windows' }), row = windows.getByRole('listitem').nth(1);
  const box = page.getByRole('textbox', { name: 'Window name' }), heading = page.locator('main > header h1');
  const called = async () => [await row.innerText(), await heading.innerText()];
  await windows.getByText('Main chat').dblclick();
  assert.equal(await box.count(), 0, 'the main chat cannot be renamed');
  await page.getByRole('button', { name: 'New window' }).click();
  await page.getByRole('heading', { name: 'New connected window' }).waitFor();
  await page.getByRole('textbox', { name: 'Message' }).fill('hello there');
  await page.keyboard.press('Enter');
  await row.getByText('hello there').waitFor();
  await row.getByText('hello there').dblclick();
  assert.equal(await focused(page), 'Window name');
  await page.keyboard.press('ControlOrMeta+b'); // The app's shortcuts are not the box's.
  await page.keyboard.type('Release notes');
  await page.keyboard.press('Enter');
  await row.getByText('Release notes').waitFor();
  assert.deepEqual(await called(), ['Release notes', 'Release notes']);
  // Esc in the box is the box's: the name stays and the window's run goes on.
  await run(page);
  await heading.dblclick();
  await page.keyboard.type('Something else');
  await goesOn(page, 'in the box a window is renamed in');
  assert.deepEqual(await called(), ['Release notes', 'Release notes']);
  await stops(page, 'once the box is gone');
  // From the keyboard, F2 on the row.
  await row.getByRole('button', { name: 'Release notes' }).focus();
  await page.keyboard.press('F2');
  await box.fill('');
  await page.keyboard.press('Enter');
  await row.getByText('hello there').waitFor();
  assert.deepEqual(await called(), ['hello there', 'hello there']);
  // Over a narrow chat, the desktop app's Rename (its event, as the shell sends it): Esc is the box's before it closes the windows.
  const narrow = await open('renames', NARROW), over = narrow.getByRole('button', { name: 'Close the sidebar' });
  await narrow.keyboard.press('ControlOrMeta+b');
  await over.waitFor();
  const id = await narrow.getByRole('navigation', { name: 'Windows' }).getByRole('listitem').nth(1).getAttribute('data-row') ?? '';
  await narrow.evaluate(([event, window]) => dispatchEvent(new CustomEvent(event, { detail: { window, action: 'rename' } })), [ROW_EVENT, id]);
  await narrow.getByRole('textbox', { name: 'Window name' }).fill('Not kept');
  await narrow.keyboard.press('Escape');
  assert.equal(await over.count(), 1, 'the windows are still open');
  assert.equal(await narrow.getByRole('navigation', { name: 'Windows' }).getByText('hello there').count(), 1);
});

test('⌘F finds in the chat: what is typed is marked wherever it is written and followed as the chat grows, Enter goes from one to the next, Esc closes it and the run goes on, and the same text is searched in the memory from there', async () => {
  const page = await open('finds'), bar = page.getByRole('search', { name: 'Find in chat' }), count = bar.locator('[aria-live]'), control = await connect(server.url);
  const counts = (said: string) => count.getByText(said, { exact: true }).waitFor({ timeout: 3000 }).catch(async () => assert.fail(`The bar says ${await count.textContent().catch(() => 'nothing')}, not ${said}.`));
  /** How many places are marked beside the one it is at, and whether that one is in sight: its middle is where its text is,
   * and not under what it is scrolled out of. */
  const marked = () => page.evaluate(() => {
    const [at] = CSS.highlights.get('find-at') ?? [], range = new Range();
    if (!at) return [CSS.highlights.get('find')?.size ?? 0, false] as const;
    range.setStart(at.startContainer, at.startOffset); range.setEnd(at.endContainer, at.endOffset);
    const match = range.getBoundingClientRect(), there = document.elementFromPoint(match.left + match.width / 2, match.top + match.height / 2);
    return [CSS.highlights.get('find')?.size ?? 0, at.startContainer.parentElement!.contains(there)] as const;
  });
  try {
    // The agent at work, on a reply that is held with half of it written, and again with all of it written and not yet ended.
    await page.getByRole('textbox', { name: 'Message' }).fill('wait slowly');
    await page.keyboard.press('Enter');
    await stop(page).waitFor();
    await page.keyboard.press('ControlOrMeta+f');
    assert.equal(await focused(page), 'Find in chat');
    // Eleven messages say it, all above what the chat shows at its end: it is at the nearest, which is the last, and brings it
    // into sight. ⇧Enter is the one before, and Enter the next, round the end to the first.
    await page.keyboard.type('MESSAGE 1');
    await counts('11/11');
    assert.deepEqual(await marked(), [10, true]);
    // A key an input method takes for itself, to pick or to drop what it offers, is no Enter or Esc of the bar's or the chat's.
    await bar.getByRole('searchbox').evaluate(box => { for (const key of ['Enter', 'Escape']) box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true })); });
    await page.waitForTimeout(300);
    assert.deepEqual([await count.textContent(), await bar.count(), await stop(page).isVisible()], ['11/11', 1, true]);
    await page.keyboard.press('Shift+Enter');
    await counts('10/11');
    assert.deepEqual(await marked(), [10, true]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await counts('1/11');
    assert.deepEqual(await marked(), [10, true]);
    // Any case is found, in letters English does not have too, and a text that is nowhere says so.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('blÅbær');
    await counts('1/2');
    assert.deepEqual(await marked(), [1, true]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await counts('1/2');
    // The page's own words are not the chat's: the line that says the agent is working, and what a button says.
    for (const text of ['working for', 'full message']) {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type(text);
      await counts('0/0');
    }
    // A text that is nowhere leaves the chat where it was before it was typed, though half of it was found further up.
    const end = () => page.evaluate(() => { const chat = document.querySelector('main .overflow-y-auto')!; return chat.scrollHeight - chat.scrollTop - chat.clientHeight; });
    await page.getByRole('button', { name: 'Scroll to end' }).click();
    await page.waitForFunction(() => { const chat = document.querySelector('main .overflow-y-auto')!; return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 1; });
    await bar.getByRole('searchbox').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('blåbærx');
    await counts('0/0');
    assert.ok(await end() < 1, 'the chat is not back at its end');
    // A long message is cut short over its end: found there, it opens.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('the needle');
    await counts('1/1');
    await page.getByRole('button', { name: 'Show less' }).waitFor({ timeout: 3000 }).catch(() => assert.fail('The message that is cut short did not open at what was found in it.'));
    assert.deepEqual(await marked(), [0, true]);
    // The end of a line of code that is longer than the page is wide is scrolled to, sideways.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('farword');
    await counts('1/1');
    assert.deepEqual(await marked(), [0, true]);
    // What the agent is writing is found as it comes, with no key pressed.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('reply');
    await counts('0/0');
    // Esc in the bar closes it and nothing else: the marks are gone, the keys are in the composer again, and the run goes on.
    await goesOn(page, 'in the find bar');
    assert.deepEqual([await bar.count(), await focused(page), await page.evaluate(() => CSS.highlights.size)], [0, 'Message', 0]);
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type('reply');
    await counts('0/0');
    // The rest of the reply comes into the text that is there, and is found while the agent is still writing it.
    await control.request('command', { window: 'finds/main', command: { type: 'release' } });
    await counts('1/1');
    assert.ok(await stop(page).isVisible(), 'the reply had ended');
    await control.request('command', { window: 'finds/main', command: { type: 'release' } });
    await stop(page).waitFor({ state: 'detached' });
    await counts('1/1');
    // The chat has its newest messages only. The memory has them all, and is searched for the same text from the bar.
    await bar.getByRole('button', { name: 'Search memory for “reply”' }).click();
    await page.getByRole('region', { name: 'Messages found' }).waitFor();
    assert.deepEqual([await page.getByRole('searchbox', { name: 'Search the memory' }).inputValue(), await focused(page)], ['reply', 'Search the memory']);
    // A connected window's chat is found in too, and ⇧⌘F in its bar takes what was typed to the memory, which is the main chat's.
    await page.getByRole('button', { name: 'New window' }).click();
    await page.getByRole('heading', { name: 'New connected window' }).waitFor();
    await page.getByRole('textbox', { name: 'Message' }).fill('hello there');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Copy reply' }).waitFor();
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type('HELLO');
    await counts('1/1');
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await page.getByRole('heading', { name: 'Memory view' }).waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Search the memory' }).inputValue(), 'HELLO');
    // Find looks in what the chat has: going to what its first message says reads no page above it, as reading back to the top does.
    const paged = await open('paged'), earlier = paged.getByRole('button', { name: 'Load earlier messages' });
    await paged.keyboard.press('ControlOrMeta+f');
    await paged.keyboard.type('message 60');
    await paged.getByRole('search', { name: 'Find in chat' }).getByText('1/1', { exact: true }).waitFor();
    await paged.waitForTimeout(500);
    assert.deepEqual([await earlier.isVisible(), await paged.getByText('message 59', { exact: true }).count()], [true, 0], 'find read an older page');
    // The match it is at stays the one it is at when the page above is read, which has one more before it.
    const said = paged.getByRole('search', { name: 'Find in chat' }).locator('[aria-live]'), at = () => paged.evaluate(() => [...CSS.highlights.get('find-at') ?? []][0]?.startContainer.textContent);
    await paged.keyboard.press('ControlOrMeta+a');
    await paged.keyboard.type('message 7');
    await paged.keyboard.press('Shift+Enter');
    await said.getByText('9/10', { exact: true }).waitFor();
    assert.equal(await at(), 'message 78');
    await paged.evaluate(() => { const chat = document.querySelector('main .overflow-y-auto')!; chat.scrollTop = chat.scrollTop ? 0 : 1; });
    await said.getByText('10/11', { exact: true }).waitFor({ timeout: 3000 }).catch(async () => assert.fail(`Reading back to the top read no older page, or the match it was at is another: the bar says ${await said.textContent()}.`));
    assert.equal(await at(), 'message 78');
  } finally { control.close(); }
});

test('↑ in an empty composer brings back what you said, and ⇧⌘F in the chat searches the memory', async () => {
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
  // ⌘F and ⇧⌘F are not the panel's keys: from there the chat stays as it is.
  await page.getByRole('button', { name: 'Agents and GitHub' }).click();
  await page.getByRole('button', { name: 'Close the panel' }).focus();
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('heading', { name: 'Memory view' }).count() + await page.getByRole('search', { name: 'Find in chat' }).count(), 0);
  await page.getByRole('button', { name: 'Close the panel' }).click();
  await box.focus();
  // From the chat ⇧⌘F shows the memory view with the keys in its search box, and they stay there once the view has been read.
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await page.getByRole('heading', { name: 'Memory view' }).waitFor();
  await page.locator('[data-line]').first().waitFor();
  assert.equal(await focused(page), 'Search the memory');
  await page.keyboard.type('message 1');
  await page.getByRole('region', { name: 'Messages found' }).waitFor();
  // Nor from the panel as a sheet over a narrow page: the chat under it stays the chat.
  const narrow = await open('keys', NARROW);
  await narrow.getByRole('button', { name: 'Agents and GitHub' }).click();
  await narrow.locator('dialog[open]').waitFor();
  await narrow.keyboard.press('ControlOrMeta+Shift+f');
  await narrow.waitForTimeout(300);
  assert.equal(await narrow.getByRole('heading', { name: 'Memory view' }).count(), 0);
});

test('the working line opens to what the agent has thought so far, and Esc on it still stops the run', async () => {
  const page = await open('thinks');
  await page.getByRole('textbox', { name: 'Message' }).fill('think about it, and wait');
  await page.keyboard.press('Enter');
  // The fake Pi is held halfway through its thought: the line says its last line so far, and opens to all of it.
  const line = page.getByRole('button', { name: /^Thinking for/ });
  assert.equal(await line.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByText('The user wants the shutdown path checked.').count(), 0, 'the thought is folded until it is opened');
  await line.click();
  assert.equal(await line.getAttribute('aria-expanded'), 'true');
  await page.getByText('The user wants the shutdown path checked.').waitFor();
  assert.ok(await line.evaluate(element => element === document.activeElement), 'the working line has the focus');
  // Its thought done, the agent begins to answer: the line is under the reply now, the same one, open still and with the focus.
  const control = await connect(server.url);
  await control.request('command', { window: 'thinks/main', command: { type: 'release' } });
  await page.getByText('rep', { exact: true }).waitFor(); // Half of its answer, "reply", where the fake Pi is held.
  const moved = page.getByRole('button', { name: /^Working for/ });
  assert.ok(await moved.evaluate(element => element === document.activeElement && element.getAttribute('aria-expanded') === 'true'), 'the line under the reply is open and has the focus');
  await page.keyboard.press('Enter');
  assert.equal(await moved.getAttribute('aria-expanded'), 'false');
  // It is the chat's line: Esc there stops the run, as anywhere else in the chat.
  await stops(page, 'on the working line');
  // A run with no thought has nothing to open: its line is no button.
  await run(page);
  await page.getByText(/^Working for/).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Working for/ }).count(), 0);
  await stops(page, 'in the chat');
  control.close();
  await page.context().close();
});

test('a long edit opens as its diff, which scrolls in its box and does not make the page longer', async () => {
  const page = await open('diffs');
  await page.getByRole('button', { name: /Worked/ }).click();
  const row = page.getByRole('button', { name: /Edited src\/server\/pi\.ts/ });
  assert.match(await row.innerText(), /\+23\s*−4/);
  await row.click();
  // The box the details open in is the one that scrolls: no smaller box of the diff's own inside it.
  const box = await row.evaluate(element => {
    const diff = element.querySelector('pre'), details = diff?.parentElement;
    return diff && details && { height: details.clientHeight, whole: details.scrollHeight, diff: diff.clientHeight, drawn: diff.scrollHeight, page: document.documentElement.scrollHeight - innerHeight };
  });
  assert.ok(box && box.height <= 384 && box.whole > box.height, `the details box scrolls: ${JSON.stringify(box)}`);
  assert.equal(box.diff, box.drawn, 'the diff is drawn whole inside it');
  assert.equal(box.page, 0, 'the page does not scroll');
  await page.context().close();
});

test('a tool call that returned a picture shows it small under its line, from the profile\'s file, and large on a click; one the profile no longer has says so', async () => {
  const page = await open('seen');
  await page.getByRole('button', { name: /^Worked/ }).click();
  const read = page.getByRole('button', { name: /^Read \/tmp\/shots\/11-narrow\.png/ }), picture = read.getByRole('button', { name: 'Show the image large: What the tool returned', exact: true });
  await read.click();
  const img = picture.locator('img');
  await img.evaluate(img => img instanceof HTMLImageElement && (img.complete || new Promise(done => img.addEventListener('load', done, { once: true }))));
  assert.equal(await img.evaluate(img => img instanceof HTMLImageElement ? img.naturalWidth : 0), 64);
  // What it printed is there without the name of the picture, which is drawn.
  assert.match(await read.innerText(), /Read image file \[image\/png\]/);
  assert.doesNotMatch(await read.innerText(), /\[image [0-9a-f]/);
  await page.getByRole('button', { name: /^Read \/tmp\/shots\/gone\.png/ }).click();
  await page.getByText('Image unavailable').waitFor();
  // A call that returned only a picture shows the picture, and no "No output." under it.
  const only = page.getByRole('button', { name: /^Read \/tmp\/shots\/only\.png/ });
  await only.click();
  await only.getByRole('button', { name: 'Show the image large: What the tool returned', exact: true }).waitFor();
  assert.doesNotMatch(await only.innerText(), /No output/);
  await picture.click();
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor({ state: 'detached' });
  assert.equal(await focused(page), 'Show the image large: What the tool returned');
  // A click in it, on the picture or its ×, does not fold the call it was opened from.
  await picture.click();
  await page.getByRole('dialog', { name: 'The image, large' }).locator('img').click();
  await page.getByRole('button', { name: 'Close the image' }).click();
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor({ state: 'detached' });
  assert.equal(await read.getAttribute('aria-expanded'), 'true', 'A click in the picture shown large folded its tool call.');
  // A press beside it puts it away too, though the call's details keep a press to themselves.
  await picture.click();
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor();
  await page.mouse.click(5, 5);
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor({ state: 'detached', timeout: 2000 });
  await page.context().close();
});

test('what is selected in a reply, a report or a message is cited in the message under it: a chip there, and a card once sent that opens the memory view where it is; a report and your own message can be copied', async () => {
  const page = await open('said'), box = page.getByRole('textbox', { name: 'Message' }), cite = page.getByRole('button', { name: 'Cite', exact: true });
  const chips = () => page.getByRole('list', { name: 'Cited in the message' }).getByRole('listitem').allInnerTexts(), draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('optchat-app-drafts') ?? '{}')['said/main']);
  const report = page.locator('[data-cite] li', { hasText: 'Nothing is replayed twice' }), reply = page.locator('[data-cite] p', { hasText: 'Started two agents.' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // A line of a report: it is a chip over the box, and nothing is typed for it.
  await report.click({ clickCount: 3 });
  await cite.click();
  assert.deepEqual([await chips(), await box.inputValue(), await focused(page), await cite.count()], [['Nothing is replayed twice'], '', 'Message', 0]);
  // The box has its caret too, so it is seen that the keys are in it: the selection is not taken away after they are put there.
  assert.equal(await page.evaluate(() => getSelection()?.type), 'Caret', 'the box has the keys but no caret once something is cited');
  // A reply, with something typed already. Three clicks on its last paragraph select on into the row under it: the button is
  // at the paragraph's end all the same.
  await box.fill('About the agents:');
  await reply.click({ clickCount: 3 });
  const [line, button] = [await reply.boundingBox(), await cite.boundingBox()];
  assert.ok(line && button && Math.abs(button.y - line.y - line.height) < 8, 'the Cite button is not under the last line that is selected');
  await cite.click();
  assert.deepEqual([await chips(), await box.inputValue()], [['Nothing is replayed twice', 'Started two agents. I\'ll tell you when they report.'], 'About the agents:']);
  // Backspace takes a letter while there is one, and a `/` lists no commands: the message begins with what it cites.
  await box.press('Backspace');
  assert.deepEqual([(await chips()).length, await box.inputValue()], [2, 'About the agents']);
  await box.fill('/');
  assert.equal(await page.getByRole('listbox', { name: 'Commands' }).count(), 0, 'commands are listed for a message that cites');
  // Backspace takes the last chip off once the box is empty, and a chip's own button takes that one.
  await box.fill('');
  await page.keyboard.press('Backspace');
  assert.deepEqual(await chips(), ['Nothing is replayed twice']);
  await reply.click({ clickCount: 3 });
  await cite.click();
  await page.getByRole('button', { name: 'Remove the citation' }).first().click();
  assert.deepEqual([await chips(), await focused(page)], [['Started two agents. I\'ll tell you when they report.'], 'Message']);
  // A selection that runs on into the report under the reply is cited as far as the reply goes, which is the message it names.
  const [from, to] = [await reply.boundingBox(), await report.boundingBox()];
  assert.ok(from && to);
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 100, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  await cite.click();
  const [, part = ''] = await chips();
  assert.ok(part.length > 10 && 'Started two agents. I\'ll tell you when they report.'.endsWith(part), `what is cited of a selection over two messages: ${part}`);
  await page.getByRole('button', { name: 'Remove the citation' }).last().click();
  // They are there when the page is opened again, with what is typed.
  await report.click({ clickCount: 3 });
  await cite.click();
  await page.keyboard.type('how long?');
  await page.reload();
  await box.waitFor();
  assert.deepEqual([await chips(), await box.inputValue()], [['Started two agents. I\'ll tell you when they report.', 'Nothing is replayed twice'], 'how long?']);
  // Sent, the message names the message of the log each is in, for the agent to zoom to, and the chat shows them as cards.
  const sent = '<cite zoom="11">Started two agents. I\'ll tell you when they report.</cite>\n<cite zoom="12">Nothing is replayed twice</cite>\n\nhow long?';
  await box.press('Enter');
  await page.getByText('reply', { exact: true }).waitFor();
  const { messages } = await (await connect(server.url)).request('history', { profile: 'said' });
  assert.equal(messages.findLast(message => message.kind === 'user')?.text, sent);
  assert.deepEqual(await page.locator('[data-cited]').allInnerTexts(), ['Started two agents. I\'ll tell you when they report.\nMemory · 11', 'Nothing is replayed twice\nMemory · 12']);
  assert.ok(!(await page.locator('main').innerText()).includes('<cite'), 'the chat shows a citation as it is written');
  // ⌘F finds what a card says, as it finds it in the report: a card is pressed, and its words are the chat's all the same.
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('replayed twice');
  await page.getByRole('search', { name: 'Find in chat' }).locator('[aria-live]').getByText(/^[12]\/2$/).waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  // ↑ brings the message back as it was: its chips, and what was typed.
  await box.press('ArrowUp');
  assert.deepEqual([await chips(), await box.inputValue(), await draft()], [['Started two agents. I\'ll tell you when they report.', 'Nothing is replayed twice'], 'how long?', sent]);
  await box.press('ArrowDown');
  assert.deepEqual([await chips(), await box.inputValue()], [[], '']);
  // A card opens the memory view at the message it cites, and a click on what is selected takes the button away.
  await page.locator('[data-cited]').first().click();
  assert.match(await page.locator('[data-found]').innerText(), /message 11/);
  await page.keyboard.press('Alt+m');
  await report.click({ clickCount: 3 });
  await cite.waitFor();
  await report.click();
  await cite.waitFor({ state: 'detached' });
  // A report and a message of yours are copied whole, as a reply is.
  const copied = async (name: string) => { await page.getByRole('button', { name }).first().click(); return page.evaluate(() => navigator.clipboard.readText()); };
  assert.match(await copied('Copy report'), /^\*\*T3 Code replays by sequence number\.\*\*[^]*- Nothing is replayed twice$/);
  assert.equal(await copied('Copy message'), 'The shutdown test fails on Windows. Can you fix the timeout and write down why it is different there?');
  // One that cites is copied as it was sent: pasted into the box, it is its chips and what was typed again.
  await page.getByRole('button', { name: 'Copy message' }).last().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sent);
  // Esc on the button takes it away, and is not the key that stops the run.
  await run(page);
  await report.click({ clickCount: 3 });
  await cite.focus();
  await goesOn(page, 'on the Cite button');
  assert.equal(await cite.count(), 0);
  // What the log does not have yet is cited without a place: the number it is drawn under is not the log's until the run ends.
  await page.getByText('wait', { exact: true }).click({ clickCount: 3 });
  await cite.click();
  assert.equal(await draft(), '<cite>wait</cite>\n\n');
});

test('in the memory view a line is cited whole by its button, and the words selected in a line or in an opened message with where they are', async () => {
  const page = await open('lines'), box = page.getByRole('textbox', { name: 'Message' }), cite = page.getByRole('button', { name: 'Cite', exact: true }), lines = page.locator('[data-line]');
  // What the message cites, as it is kept: where each is, and how it begins.
  const draft = async () => cited(await page.evaluate((): string => JSON.parse(localStorage.getItem('optchat-app-drafts') ?? '{}')['lines/main'] ?? '')).cites.map(({ text, at }) => [at && named(at), text.split('\n')[0]]);
  await page.keyboard.press('Alt+m');
  // The button on a line cites the line: the eight messages from the first on, by how their summary begins.
  await lines.first().hover();
  await page.getByRole('button', { name: 'Cite this line' }).first().click();
  assert.deepEqual([await page.getByRole('list', { name: 'Cited in the message' }).getByRole('listitem').allInnerTexts(), await focused(page)], [['Memory 0+8'], 'Message']);
  // Words selected in a line are cited with the line's place, and selecting them does not open it; Enter does, as a click.
  const said = await lines.nth(3).getByText('Started two agents').boundingBox();
  assert.ok(said);
  await page.mouse.move(said.x + 40, said.y + said.height / 2);
  await page.mouse.down();
  await page.mouse.move(said.x + 160, said.y + said.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.equal(await lines.nth(3).getAttribute('aria-expanded'), 'false');
  await cite.click();
  // An opened message is the chat's row, and what is selected in it is cited as that message.
  await lines.nth(4).focus();
  await page.keyboard.press('Enter');
  assert.equal(await lines.nth(4).getAttribute('aria-expanded'), 'true');
  await page.locator('[data-cite] li', { hasText: 'Nothing is replayed twice' }).click({ clickCount: 3 });
  await cite.click();
  // A message a search found is cited by its button too.
  await page.getByRole('searchbox', { name: 'Search the memory' }).fill('not enough for');
  const found = page.getByRole('region', { name: 'Messages found' });
  await found.locator('[data-line]').first().hover();
  await found.getByRole('button', { name: 'Cite this line' }).first().click();
  const cites = await draft();
  assert.deepEqual(cites.slice(0, 1), [['0+8', 'user: The shutdown test fails on Windows.']]);
  assert.deepEqual([cites[1][0], cites[2], cites[3][0]], ['11', ['12', 'Nothing is replayed twice'], '2']);
  assert.ok('talk: Started two agents. I\'ll tell you when they report.'.includes(String(cites[1][1])) && String(cites[1][1]).length > 5, `what was selected in the line: ${cites[1][1]}`);
  assert.match(String(cites[3][1]), /not enough for `taskkill`/);
  // Sent from here, the message is answered in the chat, where what it cites is cards.
  await box.press('Enter');
  await page.locator('[data-cited]').nth(3).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Memory view' }).count(), 0);
  assert.match(await page.locator('[data-cited]').first().innerText(), /^user: The shutdown test fails on Windows\.\n[^]*\nMemory · 0\+8$/);
  // The card of a line opens the memory view at that line, not at its first message.
  await page.locator('[data-cited]').first().click();
  assert.match(await page.locator('[data-found]').innerText(), /8 messages/);
});

test('the settings are in tabs: the arrows go from one to the next, the page opens again on the last one, and Esc closes it while the run goes on', async () => {
  const page = await open('tabs'), settings = page.getByRole('button', { name: 'Settings' }), theme = page.getByRole('textbox', { name: 'Folder for new windows' });
  await run(page);
  await settings.click();
  await theme.waitFor();
  await page.getByRole('tab', { name: 'General', selected: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('radiogroup', { name: 'Color scheme' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('textbox', { name: 'Max active agents' }).waitFor();
  assert.equal(await theme.count(), 0);
  assert.equal(await focused(page), 'Profile');
  assert.deepEqual(await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => (tab as HTMLElement).tabIndex)), [-1, -1, 0, -1]); // One stop for Tab.
  await page.keyboard.press('End');
  const instructions = page.getByRole('textbox', { name: 'Instructions' });
  await instructions.fill('Not saved yet.');
  await page.getByRole('tab', { name: 'Instructions' }).focus();
  // What was typed and not saved is there again on the way back.
  await page.keyboard.press('ArrowRight');
  await theme.waitFor();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await instructions.inputValue(), 'Not saved yet.');
  assert.equal(await focused(page), 'Instructions');
  await goesOn(page, 'on a tab of the settings');
  await settings.click();
  await page.getByRole('tab', { name: 'Instructions', selected: true }).waitFor();
  // While a chat still needs something, the page opens on General, where that is said.
  const optchat = join(home, 'pi', 'pi-optchat', 'package.json'), again = page.getByRole('button', { name: 'Check again' }), old = page.getByText('Older than').first();
  writeFileSync(optchat, JSON.stringify({ name: 'pi-optchat', version: '0.11.0' }));
  await page.getByRole('tab', { name: 'General' }).click();
  await again.click();
  await old.waitFor();
  await page.getByRole('tab', { name: 'Instructions' }).click();
  await page.getByRole('button', { name: 'Close the settings' }).click();
  await settings.click();
  await page.getByRole('tab', { name: 'General', selected: true }).waitFor();
  writeFileSync(optchat, JSON.stringify({ name: 'pi-optchat', version: '0.12.2' }));
  await again.click();
  await old.waitFor({ state: 'detached' });
});

test('a theme is picked in Appearance: a card for light and dark, a round for one; the sidebar art goes with it until it is turned off; a file of yours that is no theme says why', async t => {
  const folder = join(home, 'app', 'themes');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'dusk.json'), JSON.stringify({ version: 1, name: 'Dusk', appearance: 'dark', colors: { background: '#101820' } }));
  writeFileSync(join(folder, 'evil.json'), JSON.stringify({ version: 1, name: 'Evil', appearance: 'light', colors: { background: 'url(https://example.com/x)' } }));
  const client = await connect(server.url);
  t.after(async () => { await client.request('setSettings', { theme: 'system', palette: { light: null, dark: null }, art: true }); client.close(); });
  const page = await open('tabs'), background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const variable = (name: string) => page.evaluate(name => document.documentElement.style.getPropertyValue(name), name);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByText('Light', { exact: true }).click();
  const own = await background();
  // A card is used in both appearances it has: Grove in light now, and in dark once the scheme is dark.
  await page.getByRole('button', { name: 'Use Grove', exact: true }).click();
  await page.getByRole('button', { name: 'Use Grove in light mode', pressed: true }).waitFor();
  assert.equal(await variable('--background'), 'oklch(0.972369 0.005497 157.15)');
  assert.notEqual(await background(), own);
  // A round is used in its appearance only: Dusk in dark, and light stays Grove.
  await page.getByRole('button', { name: 'Use Dusk in dark mode' }).click();
  await page.getByRole('button', { name: 'Use Dusk in dark mode', pressed: true }).waitFor();
  assert.equal(await variable('--background'), 'oklch(0.972369 0.005497 157.15)');
  await page.getByText('Dark', { exact: true }).click();
  await page.locator('html.dark').waitFor();
  assert.equal(await variable('--background'), '#101820');
  // What Dusk does not name is the app's own in dark.
  assert.equal(await variable('--sidebar'), '');
  // The file that is no theme is a card that says why, and is never drawn.
  await page.getByText('Not a theme. "background" is no colour').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Use Evil' }).count(), 0);
  // Grove has a night sky at the top of the sidebar; Dusk has none, and the switch takes Grove's away.
  const art = page.locator('[data-art-drawing]');
  await page.getByText('Light', { exact: true }).click();
  await page.getByRole('button', { name: 'Close the settings' }).click();
  await art.waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  // Its thumb lies over it, in the label that turns it; it is off once the server has kept that.
  await page.getByRole('switch', { name: 'Sidebar art' }).click({ force: true });
  await page.getByRole('switch', { name: 'Sidebar art', checked: false }).waitFor();
  await page.getByRole('button', { name: 'Close the settings' }).click();
  await page.getByRole('navigation', { name: 'Windows' }).waitFor();
  assert.equal(await art.isVisible(), false);
});

/** Waits for what the server does on its own, once the page has asked. */
async function until(done: () => boolean) {
  for (let tries = 0; tries < 100 && !done(); tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(done());
}

test('the instructions open in your editor, what was typed is saved first, and the field reads the file again when you are back', async () => {
  const directory = createProfile(home, 'editing'), file = join(directory, 'AGENTS.md');
  const page = await open('editing'), instructions = page.getByRole('textbox', { name: 'Instructions' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Instructions' }).click();
  await instructions.fill('Typed here.');
  launched.length = 0;
  await page.getByRole('button', { name: 'Open in VS Code' }).click();
  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  await until(() => launched.length === 1);
  assert.equal(readFileSync(file, 'utf8'), 'Typed here.');
  assert.deepEqual(launched.pop(), { command: '/usr/local/bin/code', args: [file] });
  // The list has what was found; the one picked opens it and is the one from then on.
  const chevron = page.getByRole('button', { name: 'Open in…' }), list = page.getByRole('listbox', { name: 'Editors' });
  await chevron.click();
  assert.deepEqual(await list.getByRole('option').allInnerTexts(), ['Cursor', 'VS Code', 'Zed', 'Finder']);
  // The arrows walk it from the one in use, and Esc closes the list alone: the settings stay, and the focus is on the chevron.
  assert.equal(await focused(page), 'VS Code');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'Zed');
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  assert.equal(await focused(page), 'Open in…');
  await chevron.click();
  await page.getByRole('option', { name: 'Zed' }).click();
  await page.getByRole('button', { name: 'Open in Zed' }).waitFor();
  assert.equal(await focused(page), 'Open in Zed'); // Not the page: the option it was on is gone.
  await until(() => launched.length === 1);
  assert.deepEqual(launched.pop(), { command: '/Applications/Zed.app/Contents/MacOS/cli', args: [file] });
  // Changed in the editor: back in the window, the field has it, and typing not saved yet is never replaced.
  writeFileSync(file, 'Changed in Zed.');
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Changed in Zed.');
  await instructions.fill('Typing.');
  writeFileSync(file, 'Changed again.');
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  assert.equal(await instructions.inputValue(), 'Typing.');
  // Typed while the file is read again: the file's text, which comes after, does not replace it.
  await instructions.fill('Changed in Zed.'); // What was read last.
  writeFileSync(file, 'Changed a third time.');
  await page.evaluate(() => {
    dispatchEvent(new Event('focus'));
    const field = document.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, 'Typed meanwhile.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  assert.equal(await instructions.inputValue(), 'Typed meanwhile.');
  await page.context().close();
});

test('a field keeps the focus when Enter saves it, and when what was typed is refused', async () => {
  const page = await open('fields');
  await page.getByRole('button', { name: 'Settings' }).click();
  const folder = page.getByRole('textbox', { name: 'Folder for new windows' });
  await folder.fill('/tmp');
  await page.keyboard.press('Enter');
  assert.equal(await focused(page), 'Folder for new windows');
  await page.getByRole('tab', { name: 'Profile' }).click();
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

test('a formula is drawn by KaTeX and a price stays as written, and a table copies as Markdown or as CSV', async () => {
  const page = await open('formulas');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.katex-display').waitFor();
  assert.equal(await page.locator('.katex').count(), 4, 'Three formulas inline and one on its own line.');
  await page.getByText('last week\'s $57.89 would have been about $340 without it.').waitFor();
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole('button', { name: 'Copy as CSV' }).click();
  assert.equal(await clipboard(), 'Role,Cost,Cache read\nMain chat,$36.41,92%\nSubagents,$19.45,88%\nCompactor,$2.02,71%');
  await page.getByRole('button', { name: 'Copy as Markdown' }).click();
  assert.match(await clipboard(), /^\| Role \| Cost \| Cache read \|\n\| --- \| ---: \| ---: \|\n[^]*\| Compactor \| \$2\.02 \| 71% \|$/);
  await page.context().close();
});

test('a reply shows a picture on this machine by its path, large on a click; one that is gone says so, and one on the web stays a link', async () => {
  const page = await open('pictured');
  const picture = page.getByRole('button', { name: 'Show the image large: Cache share by day' });
  // Drawn from the file: the server sent the page its bytes.
  await picture.locator('img').evaluate(img => img instanceof HTMLImageElement && (img.complete || new Promise(done => img.addEventListener('load', done, { once: true }))));
  assert.equal(await picture.locator('img').evaluate(img => img instanceof HTMLImageElement ? img.naturalWidth : 0), 120);
  await page.getByText(`No image at ${GONE}`).waitFor();
  assert.equal(await page.getByRole('link', { name: 'pricing' }).getAttribute('href'), 'https://example.com/pricing.png');
  await picture.click();
  const large = page.getByRole('dialog', { name: 'The image, large' });
  await large.waitFor();
  // The viewer draws the same file, and the one that is gone is no picture of the reply's to step to.
  assert.equal(await large.locator('img').getAttribute('src'), await picture.locator('img').getAttribute('src'));
  assert.match(await large.locator('img').getAttribute('src') ?? '', /^\/file\?/);
  assert.equal(await large.getByRole('button', { name: 'Next image' }).count(), 0);
  await page.context().close();
});

test('an image that is pasted, dropped or chosen goes with the message, one that cannot says why, and in the chat it is shown large, where Esc is the picture\'s', async () => {
  const page = await open('images'), message = page.getByRole('textbox', { name: 'Message' });
  const red: Given = { name: 'red.png', type: 'image/png', data: png(64, [220, 60, 60]) }, blue: Given = { name: 'blue.png', type: 'image/png', data: png(64, [60, 90, 220]) };
  const waiting = page.getByRole('list', { name: 'Images to send' }).getByRole('listitem'), kept = page.locator('img[src^="/images/images/"]'), large = page.getByRole('button', { name: 'Show the image large' });
  await give(page, 'paste', [red]);
  await waiting.nth(0).waitFor();
  // Copied cells are text and a table with a picture of them: the text is what is wanted.
  await give(page, 'paste', [blue], { 'text/plain': 'a\tb', 'text/html': '<table><tr><td>a</td><td>b</td></tr></table>' });
  // A drop of two, one of them no image: the image goes along, and the other is refused in words.
  await give(page, 'drop', [blue, { name: 'notes.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }]);
  await page.getByRole('alert').filter({ hasText: 'notes.pdf is not a PNG, JPEG, GIF or WebP image. Only those can be sent.' }).waitFor();
  assert.equal(await waiting.count(), 2);
  // Chosen with the button, and too large.
  await page.locator('input[type=file]').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await page.getByRole('alert').filter({ hasText: 'huge.png is 10.0 MB. An image can be 10 MB at most.' }).waitFor();
  assert.equal(await waiting.count(), 2);
  // They wait while another window is looked at, and the one taken off does not go.
  await page.getByRole('button', { name: 'New window' }).click();
  await page.getByRole('button', { name: 'Main chat' }).click();
  assert.equal(await waiting.count(), 2);
  await waiting.nth(0).getByRole('button', { name: 'Remove the image' }).click();
  assert.equal(await waiting.count(), 1);
  await message.fill('wait');
  await page.keyboard.press('Enter');
  await stop(page).waitFor();
  assert.equal(await waiting.count(), 0);
  // What was sent is in the chat at once, before the profile has it. Large over the page, Esc puts that away and nothing else.
  await large.click();
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor();
  assert.equal(await focused(page), 'The image, large');
  // One picture is stepped through to no other.
  assert.equal(await page.getByRole('button', { name: 'Next image' }).count(), 0);
  await goesOn(page, 'with an image shown large');
  assert.equal(await page.getByRole('dialog', { name: 'The image, large' }).count(), 0);
  assert.equal(await focused(page), 'Show the image large');
  await message.focus();
  await stops(page, 'in the composer');
  // Once the run is over it is the profile's: the blue one, as it was sent.
  await kept.waitFor();
  assert.equal(await large.count(), 1);
  assert.deepEqual(Buffer.from(await (await page.request.get(new URL(await kept.getAttribute('src') ?? '', server.page).href)).body()), blue.data);
  // A file copied in Finder comes with its name, and the file is what is pasted. Enter before it is read sends nothing: the
  // message does not go without its image.
  await message.fill('and this one');
  await give(page, 'paste', [red], { 'text/plain': 'red.png' }, 'Enter');
  await waiting.nth(0).waitFor();
  assert.equal(await message.inputValue(), 'and this one');
  // An image is a message without a word.
  await message.fill('');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await kept.nth(1).waitFor();
  // An image in a reply is shown large too, when it is one the reply may draw: the profile's own.
  await give(page, 'paste', [red]);
  await waiting.nth(0).waitFor();
  await message.fill('a picture');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Show the image large: yours' }).click();
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor();
  await page.mouse.click(5, 5); // Beside the picture.
  await page.getByRole('dialog', { name: 'The image, large' }).waitFor({ state: 'detached' });
  // A reply draws no other: an address elsewhere stays a link, which is the rule of `safe.ts` (test/markdown.test.ts).
});

test('the pictures of a message are stepped through with the arrows, a zoomed one is moved with a drag that leaves it open, and a new one starts fitted', async () => {
  const page = await open('gallery'), message = page.getByRole('textbox', { name: 'Message' }), large = page.getByRole('dialog', { name: 'The image, large' });
  // A picture larger than the window, which is fitted to it, and two small ones.
  await give(page, 'paste', [{ name: 'big.png', type: 'image/png', data: png(1200, [220, 60, 60]) }, { name: 'blue.png', type: 'image/png', data: png(64, [60, 90, 220]) }, { name: 'green.png', type: 'image/png', data: png(64, [60, 180, 90]) }]);
  await page.getByRole('list', { name: 'Images to send' }).getByRole('listitem').nth(2).waitFor();
  await message.fill('a picture');
  await page.keyboard.press('Enter');
  const replied = page.getByRole('button', { name: 'Show the image large: yours' });
  await replied.nth(2).waitFor();
  const counter = (text: string) => large.getByText(text, { exact: true }).waitFor({ timeout: 2000 }).catch(() => assert.fail(`The counter does not say ${text}.`));
  // Yours are a gallery of their own, not one with the reply's.
  await page.getByRole('button', { name: 'Show the image large', exact: true }).first().click();
  await counter('1 / 3');
  await page.keyboard.press('Escape');
  await large.waitFor({ state: 'detached' });
  // The reply's, from the second on: round the end with →, back with ←, and with the buttons.
  await replied.nth(1).click();
  await counter('2 / 3');
  await page.keyboard.press('ArrowRight');
  await counter('3 / 3');
  await page.keyboard.press('ArrowRight');
  await counter('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await counter('3 / 3');
  await page.getByRole('button', { name: 'Next image' }).click();
  await counter('1 / 3');
  assert.equal(await large.locator('img').getAttribute('src'), await replied.nth(0).locator('img').getAttribute('src'));
  // The large one, zoomed with a click and moved with a drag, which closes nothing and zooms nothing again.
  const picture = large.locator('img'), view = large.locator('div:has(> img)');
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('dialog img')?.naturalWidth === 1200);
  const fitted = (await picture.boundingBox())?.width ?? 0;
  assert.ok(fitted > 0 && fitted < 1200, `Fitted to the window, not ${fitted} wide.`);
  // A drag across it while it is fitted is no click: it stays fitted.
  const over = await picture.boundingBox();
  assert.ok(over);
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2);
  await page.mouse.down();
  await page.mouse.move(over.x + over.width / 2 - 60, over.y + over.height / 2, { steps: 4 });
  await page.mouse.up();
  assert.equal(Math.round((await picture.boundingBox())?.width ?? 0), Math.round(fitted), 'A drag zoomed a fitted picture.');
  await picture.click();
  assert.equal(Math.round((await picture.boundingBox())?.width ?? 0), Math.round(fitted * 2));
  const box = await view.boundingBox();
  assert.ok(box);
  const left = await view.evaluate(here => here.scrollLeft);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  const moved = () => view.evaluate(here => Math.round(here.scrollLeft));
  assert.equal(await moved(), Math.round(left + 80));
  assert.equal(await large.count(), 1, 'A drag closed the picture.');
  assert.equal(Math.round((await picture.boundingBox())?.width ?? 0), Math.round(fitted * 2), 'A drag zoomed the picture.');
  // Zoomed, the arrows move it before they step; 0 fits it again.
  await page.keyboard.press('ArrowLeft');
  await counter('1 / 3');
  assert.equal(await moved(), Math.round(left + 40));
  // At its right edge, → steps after all.
  await view.evaluate(here => { here.scrollLeft = here.scrollWidth; });
  await page.keyboard.press('ArrowRight');
  await counter('2 / 3');
  await page.keyboard.press('ArrowLeft');
  await counter('1 / 3');
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('dialog img')?.naturalWidth === 1200);
  await picture.click();
  await page.keyboard.press('+');
  assert.equal(Math.round((await picture.boundingBox())?.width ?? 0), Math.round(fitted * 3));
  await page.keyboard.press('0');
  assert.equal(Math.round((await picture.boundingBox())?.width ?? 0), Math.round(fitted));
  // Zoomed, then another picture and back: it starts fitted.
  await picture.click();
  await page.keyboard.press('ArrowLeft');
  await counter('1 / 3');
  await page.getByRole('button', { name: 'Previous image' }).click();
  await counter('3 / 3');
  await page.getByRole('button', { name: 'Next image' }).click();
  await counter('1 / 3');
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('dialog img')?.naturalWidth === 1200);
  assert.equal(Math.round((await picture.boundingBox())?.width ?? 0), Math.round(fitted));
  // Esc puts it away and nothing else, and the focus is on the picture it was opened from.
  await page.keyboard.press('Escape');
  await large.waitFor({ state: 'detached' });
  assert.equal(await focused(page), 'Show the image large: yours');
  await page.context().close();
});

test('a file the chat names opens in your editor when it is in the window\'s folder, and one that is not stays as written', async () => {
  // Its main window runs where the files are, whatever folder another test left the settings at.
  const control = await connect(server.url);
  await control.request('open', { profile: 'files', cwd: home });
  control.close();
  const page = await open('files');
  const pi = page.getByRole('button', { name: 'src/server/pi.ts:74' });
  // A file's name is the chat's text though it is a button: find finds it, and what runs from it into the words after it.
  await page.getByRole('button', { name: 'the shutdown test' }).waitFor();
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('pi.test.ts covers it');
  await page.getByRole('search', { name: 'Find in chat' }).getByText('1/1', { exact: true }).waitFor({ timeout: 3000 }).catch(() => assert.fail('A file\'s name in a reply was not found.'));
  await page.keyboard.press('Escape');
  await pi.click();
  // A click on the code a link holds is one click on the link: the code is no button of its own, in a link to a file or not.
  await page.getByRole('button', { name: 'the shutdown test' }).locator('code').click();
  assert.equal(await page.getByRole('link', { name: 'src/server/pi.ts on GitHub' }).getByRole('button').count(), 0);
  await page.waitForTimeout(300);
  // The editor is yours (`code -g <file>:74`) or the system's text editor (`open -t <file>`): either way the file, whole.
  const named = (file: string) => launched.some(({ args }) => args.some(arg => arg.startsWith(join(realpathSync(home), file))));
  assert.ok(launched.length === 2 && named('src/server/pi.ts') && named('test/pi.test.ts'), JSON.stringify(launched));
  assert.equal(await page.getByRole('button', { name: 'src/server/wait.ts' }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'src/server/wait.ts' }).count(), 0);
  // A picture in a link to a file is the link's too: no button of its own to show it large.
  const again = await connect(server.url);
  await again.request('open', { profile: 'linked', cwd: home });
  again.close();
  const linked = await open('linked');
  await linked.locator('.file-link').waitFor();
  assert.equal(await linked.locator('.file-link button').count(), 0);
  await linked.context().close();
});

test('with motion on, a reply that streamed at a pace is all there once it has ended', async () => {
  const page = await open('paced', WIDE, 'no-preference');
  await page.getByRole('textbox', { name: 'Message' }).fill('hello');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Copy reply' }).waitFor();
  assert.equal(await page.locator('[data-cite] .chat-markdown').last().innerText(), 'reply');
  await page.context().close();
});

test('the desktop app\'s menu bar asks the page for what its keys run: each is done once, from whatever page is in front, and also when it asks before the page is ready', async () => {
  const page = await open('bar'), box = page.getByRole('textbox', { name: 'Message' }), theme = page.getByRole('textbox', { name: 'Folder for new windows' });
  const ask = (page: Page, action: string) => page.evaluate(action => { dispatchEvent(new CustomEvent('optchat-menu', { detail: action })); }, action);
  const client = await connect(server.url), memory = page.getByRole('heading', { name: 'Memory view' }), beside = page.getByRole('navigation', { name: 'Windows' });
  const connected = async () => (await client.request('windows', {})).windows.filter(window => window.profile === 'bar' && window.role === 'connected').length;
  /** What a key or the menu did is there, and is still there a moment later: done once, not undone by a second time. */
  const once = async (what: string, there: () => Promise<boolean>) => {
    for (let waited = 0; !await there(); waited += 100) { assert.ok(waited < 3000, `${what}: not done.`); await page.waitForTimeout(100); }
    await page.waitForTimeout(400);
    assert.ok(await there(), `${what}: done and undone.`);
  };
  try {
    // The settings: the menu opens them and never closes them. Their key, from a text field too, opens and closes them.
    await ask(page, 'settings');
    await once('Settings… in the menu', () => theme.isVisible());
    await ask(page, 'settings');
    await once('Settings… again', () => theme.isVisible());
    await page.keyboard.press('ControlOrMeta+,');
    await once('⌘, in the settings', async () => !await theme.isVisible());
    await box.focus();
    await page.keyboard.press('ControlOrMeta+,');
    await once('⌘, in the composer', () => theme.isVisible());
    // What is the chat's is done in the chat, which the settings give way to: one new window for one asking, and one for the key.
    await ask(page, 'newWindow');
    await page.getByRole('heading', { name: 'New connected window' }).waitFor();
    await once('New Connected Window in the menu', async () => await connected() === 1 && !await theme.isVisible());
    await page.keyboard.press('ControlOrMeta+Shift+o');
    await once('⇧⌘O', async () => await connected() === 2);
    // The memory is the main chat's: asked for from a connected window it is shown there, with the keys in its search box,
    // by the menu and by the key alike.
    await ask(page, 'search');
    await memory.waitFor();
    assert.equal(await focused(page), 'Search the memory');
    await ask(page, 'memory');
    await once('Chat or Memory in the menu', async () => !await memory.isVisible());
    await page.getByRole('button', { name: 'New window' }).click();
    await page.getByRole('heading', { name: 'New connected window' }).waitFor();
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await memory.waitFor();
    assert.equal(await focused(page), 'Search the memory');
    await page.keyboard.press('Alt+m');
    await once('⌥M in the memory view', async () => !await memory.isVisible());
    // Find in Chat is the chat's bar, by the menu and by the key alike, and once for the two.
    await ask(page, 'find');
    await once('Find in Chat in the menu', async () => await focused(page) === 'Find in chat');
    await page.keyboard.press('ControlOrMeta+f');
    await once('⌘F with the bar open', async () => await page.getByRole('search', { name: 'Find in chat' }).count() === 1 && await focused(page) === 'Find in chat');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+2');
    await page.getByText('Connected window', { exact: true }).waitFor();
    await page.keyboard.press('Alt+m');
    await once('⌥M in a connected window', () => memory.isVisible());
    await page.keyboard.press('Alt+m');
    await once('⌥M again', async () => !await memory.isVisible());
    // From the usage page, which the menu opens too, the windows at the left are hidden once, and shown once by the key.
    await ask(page, 'usage');
    await page.getByRole('button', { name: 'Close the usage' }).waitFor();
    await ask(page, 'sidebar');
    await once('Show or Hide Sidebar in the menu', async () => await box.isVisible() && !await beside.isVisible());
    await page.keyboard.press('ControlOrMeta+b');
    await once('⌘B', () => beside.isVisible());

    // The panel as a sheet lies over the chat and has the keys: ⇧⌘F does nothing there, and the menu closes it to search.
    const narrow = await open('bar', NARROW);
    await narrow.getByRole('button', { name: 'Agents and GitHub' }).click();
    await narrow.locator('dialog[open]').waitFor();
    await ask(narrow, 'search');
    await narrow.getByRole('heading', { name: 'Memory view' }).waitFor();
    assert.deepEqual([await narrow.locator('dialog[open]').count(), await focused(narrow)], [0, 'Search the memory']);

    // The menu opens the window for what it asks, and asks as soon as the page has loaded, which is before it has the
    // profile, and its chat when nothing has opened that yet: it waits, and is done when the chat is there.
    const asksEarly = async (profile: string, then: string) => {
      const context = await browser.newContext({ viewport: WIDE, reducedMotion: 'reduce' });
      await context.addInitScript(({ saved, then }) => {
        localStorage.setItem('optchat-app', saved);
        document.addEventListener('DOMContentLoaded', () => { dispatchEvent(new CustomEvent('optchat-menu', { detail: 'search' })); if (then) dispatchEvent(new KeyboardEvent(then, { key: 'Shift' })); });
      }, { saved: JSON.stringify({ tabs: [profile], profile, selected: {} }), then });
      const early = await context.newPage();
      await early.goto(server.page);
      return early;
    };
    const early = await asksEarly('cold', '');
    await early.getByRole('heading', { name: 'Memory view' }).waitFor({ timeout: 5000 }).catch(() => assert.fail('What the menu asked before the page was ready was not done.'));
    await early.locator('[data-line]').first().waitFor();
    assert.equal(await focused(early), 'Search the memory');
    // What still waits when a key is pressed is forgotten, and not done behind your back when the chat is there.
    const gone = await asksEarly('colder', 'keydown');
    await gone.getByRole('textbox', { name: 'Message' }).waitFor();
    await gone.waitForTimeout(500);
    assert.equal(await gone.getByRole('heading', { name: 'Memory view' }).count(), 0);

    // With no profile there is no chat to do it in: the keys go to where the first one is named.
    const first = await open();
    await first.getByRole('textbox', { name: 'Profile name' }).waitFor();
    await ask(first, 'newWindow');
    assert.equal(await focused(first), 'Profile name');
  } finally { client.close(); }
});

test('with motion on, what you open comes in, and with less motion it is there at once', async () => {
  for (const motion of ['no-preference', 'reduce'] as const) {
    const page = await open('sheet', NARROW, motion), cdp = await page.context().newCDPSession(page);
    // Fifty times slower, so that what is read is read while the thing comes in.
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.02 });
    const whole = motion === 'reduce', seen = (opacity: string, what: string) => assert.equal(Number(opacity) === 1, whole, `${what} is at ${opacity} of its opacity as it appears, with motion ${whole ? 'reduced' : 'on'}`);
    await page.getByRole('button', { name: 'Open a profile' }).click();
    seen(await page.getByRole('listbox', { name: 'Profiles' }).evaluate(list => getComputedStyle(list).opacity), 'the list of profiles');
    // The New Profile dialog, opened from under that list, and the shade behind it.
    await page.getByRole('button', { name: 'New profile…' }).click();
    const naming = page.locator('dialog[aria-label="New profile"]');
    seen(await naming.evaluate(dialog => getComputedStyle(dialog).opacity), 'the New Profile dialog');
    seen(await naming.evaluate(dialog => getComputedStyle(dialog, '::backdrop').opacity), 'the shade behind the New Profile dialog');
    await page.keyboard.press('Escape');
    await naming.waitFor({ state: 'detached' });
    // A sheet, and the shade behind it.
    await page.getByRole('button', { name: 'Agents and GitHub' }).click();
    const sheet = page.locator('dialog[aria-label="Agents and GitHub"]');
    seen(await sheet.evaluate(sheet => getComputedStyle(sheet).opacity), 'the sheet');
    seen(await sheet.evaluate(sheet => getComputedStyle(sheet, '::backdrop').opacity), 'the shade behind the sheet');
    // What was there does not come in again when the chat does: back from Settings, with a run going.
    await page.keyboard.press('Escape');
    await run(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor();
    await page.keyboard.press('Escape');
    await stop(page).waitFor();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[class~="enter"]')].filter(entering => getComputedStyle(entering).opacity !== '1').map(entering => entering.outerHTML.slice(0, 80))), []);
    await page.context().close();
  }
});

test('the update button says what the updater is doing in each of its states, a click does the next thing, and it is there only where the app updates itself', async () => {
  // A server no updater spoke to, as one a browser is opened on: no button, and nothing to click.
  const without = await open('chat'), plain = await connect(server.url);
  assert.equal(await without.locator('[data-update]').count(), 0);
  await assert.rejects(plain.request('updateNow', {}), /does not update itself/);
  plain.close();
  await without.context().close();
  // The desktop app's: a server with an updater, which says what it is doing.
  let clicks = 0;
  const at = join(home, 'updates');
  createProfile(at, 'updated');
  const own = await startServer({ home: at, app: join(at, 'app'), cwd: home, pi, update: () => { clicks++; } });
  const visit = async (viewport = WIDE, reducedMotion: 'reduce' | 'no-preference' = 'reduce') => {
    const context = await browser.newContext({ viewport, reducedMotion });
    await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs: ['updated'], profile: 'updated', selected: {} }));
    const page = await context.newPage();
    await page.goto(own.page);
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    return page;
  };
  try {
    own.updating({ state: 'idle', looked: false });
    const page = await visit(), sidebar = page.getByRole('navigation', { name: 'Windows' }), button = sidebar.locator('[data-update]'), top = page.locator('header [data-update]');
    /** The button says `name`, and a click on it reaches the app or, while it is busy, does nothing. */
    const shows = async (name: string, clicked: boolean, where = button) => {
      await where.and(page.getByRole('button', { name, exact: true })).waitFor({ timeout: 3000 }).catch(() => assert.fail(`No update button that says "${name}".`));
      assert.equal(await where.getAttribute('title'), name);
      const before = clicks;
      // While it is busy the button says it is not one (aria-disabled), and a click that lands on it all the same does nothing.
      assert.equal(await where.getAttribute('aria-disabled'), clicked ? null : 'true', name);
      await where.click({ force: true });
      await page.waitForTimeout(200);
      assert.equal(clicks - before, clicked ? 1 : 0, name);
    };
    await shows('Look for an update', true);
    // At the sidebar's foot, on the left.
    const [foot, bar] = [await button.boundingBox(), await sidebar.boundingBox()];
    assert.ok(foot && bar && foot.y + foot.height > bar.y + bar.height - 16 && foot.x < bar.x + 16, JSON.stringify({ foot, bar }));
    own.updating({ state: 'looking' });
    await shows('Looking for an update…', false);
    own.updating({ state: 'downloading', version: '1.1.0', percent: 40 });
    await shows('Downloading OptChat 1.1.0: 40%', false);
    // The ring is as full as the download: 40% of the way round.
    const [whole, left] = await button.locator('circle').last().evaluate(ring => [Number(ring.getAttribute('stroke-dasharray')), Number(ring.getAttribute('stroke-dashoffset'))]);
    assert.ok(Math.abs(left / whole - 0.6) < 0.001, `${left} of ${whole}`);
    own.updating({ state: 'ready', version: '1.1.0' });
    await shows('OptChat 1.1.0 is ready. Restart to install it', true);
    own.updating({ state: 'manual', version: '1.1.0', page: 'https://example.com/release' });
    await shows('OptChat 1.1.0 is out. Open its page to download it', true);
    own.updating({ state: 'failed', error: 'GitHub answered 403.' });
    await shows('Could not update: GitHub answered 403. Try again', true);
    own.updating({ state: 'idle', looked: true });
    await shows('No update found. Look again', true);
    // A double click is one click: one question asked, one page opened.
    const once = clicks;
    await button.dblclick();
    await page.waitForTimeout(200);
    assert.equal(clicks - once, 1, 'a double click');

    // With the sidebar closed, the button is in the top row while there is something to say, and not while there is nothing.
    await page.getByRole('button', { name: 'Toggle the sidebar' }).click();
    await sidebar.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-update]').count(), 0);
    own.updating({ state: 'ready', version: '1.1.0' });
    await shows('OptChat 1.1.0 is ready. Restart to install it', true, top);
    await page.context().close();
    // A page opened later is told what a page that was there heard, and where the sidebar lies over the chat the button is in it.
    const narrow = await visit(NARROW);
    await narrow.locator('header').getByRole('button', { name: 'OptChat 1.1.0 is ready. Restart to install it' }).waitFor();
    await narrow.getByRole('button', { name: 'Toggle the sidebar' }).click();
    await narrow.getByRole('navigation', { name: 'Windows' }).getByRole('button', { name: 'OptChat 1.1.0 is ready. Restart to install it' }).waitFor();
    assert.equal(await narrow.locator('[data-update]').count(), 1);
    // The narrow page's top row is full: a download is not shown there, only in the sidebar. A look that failed is.
    await narrow.keyboard.press('Escape');
    own.updating({ state: 'downloading', version: '1.1.0', percent: 40 });
    await narrow.locator('header [data-update="downloading"]').waitFor({ state: 'attached' });
    assert.equal(await narrow.locator('header [data-update]').isVisible(), false);
    own.updating({ state: 'failed', error: 'GitHub answered 403.' });
    await narrow.locator('header [data-update="failed"]').waitFor();
    own.updating({ state: 'ready', version: '1.1.0' });
    await narrow.context().close();

    // The icon turns while the app looks, finishes its turn once the look is over, and stands still for whoever asked for less motion.
    for (const motion of ['no-preference', 'reduce'] as const) {
      own.updating({ state: 'looking' });
      const moving = await visit(WIDE, motion), icon = moving.locator('[data-update="looking"] svg'), turns = () => moving.locator('[data-update] svg').evaluate(icon => getComputedStyle(icon).animationName);
      await icon.waitFor();
      assert.equal(await turns() !== 'none', motion === 'no-preference', motion);
      own.updating({ state: 'idle', looked: true });
      await moving.locator('[data-update="idle"]').waitFor();
      if (motion === 'no-preference') {
        assert.notEqual(await turns(), 'none', 'the turn it began is finished, not cut off');
        await moving.waitForFunction(() => getComputedStyle(document.querySelector('[data-update] svg')!).animationName === 'none', undefined, { timeout: 3000 });
        // A look that went on to a download which failed: nothing is left to turn.
        own.updating({ state: 'looking' });
        await icon.waitFor();
        own.updating({ state: 'downloading', version: '1.1.0', percent: 40 });
        await moving.locator('[data-update="downloading"]').waitFor();
        own.updating({ state: 'failed', error: 'terminated' });
        await moving.locator('[data-update="failed"]').waitFor();
        assert.equal(await turns(), 'none', 'the icon turns after a download that failed');
      }
      await moving.context().close();
    }
  } finally { await own.close(); }
});

test('New Profile…: the menu and the list of profiles open a dialog that makes another profile and opens it; a name that will not do is said in it, Esc and Cancel make nothing, and a run in the profile behind it goes on', async () => {
  const at = join(home, 'naming');
  createProfile(at, 'alone');
  writeHistories(join(at, 'mac'), Date.now());
  const own = await startServer({ home: at, app: join(at, 'app'), cwd: home, pi, histories: join(at, 'mac') }), client = await connect(own.url);
  const ask = (page: Page, action: string) => page.evaluate(action => { dispatchEvent(new CustomEvent('optchat-menu', { detail: action })); }, action);
  try {
    const context = await browser.newContext({ viewport: WIDE, reducedMotion: 'reduce' });
    await context.addInitScript(saved => localStorage.setItem('optchat-app', saved), JSON.stringify({ tabs: ['alone'], profile: 'alone', selected: {} }));
    const page = await context.newPage();
    await page.goto(own.page);
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    const dialog = page.getByRole('dialog', { name: 'New profile' }), field = dialog.getByRole('textbox', { name: 'Profile name' }), create = dialog.getByRole('button', { name: 'Create profile' }), refused = dialog.getByRole('alert');
    const profiles = async () => (await client.request('profiles', {})).profiles.map(profile => profile.name);
    // Gone from the page, which is a frame after it is closed: a closed dialog says so at the next one.
    const closed = async (how: string) => { await page.locator('dialog[aria-label="New profile"]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => assert.fail(`${how} did not close the dialog.`)); };
    await run(page);

    // The menu's New Profile… opens the dialog, with the keys in its name. Esc puts it away and does nothing else: nothing
    // is made, and the run behind it goes on.
    await ask(page, 'newProfile');
    await field.waitFor();
    assert.equal(await focused(page), 'Profile name');
    await field.fill('unmade');
    await goesOn(page, 'in the New Profile dialog');
    await closed('Esc');
    // Asked for by the menu while a list lies open on the page: Esc is the dialog's, which is the nearer of the two, and
    // the next one the list's.
    await page.getByRole('button', { name: 'Open a profile' }).click();
    await page.locator('[role=listbox]').waitFor();
    await ask(page, 'newProfile');
    await field.waitFor();
    await goesOn(page, 'in the New Profile dialog, over the list of profiles');
    await closed('Esc, over the list of profiles');
    assert.equal(await page.locator('[role=listbox]').count(), 1);
    await goesOn(page, 'in the list of profiles');
    assert.equal(await page.locator('[role=listbox]').count(), 0);
    // The other way in, and the only one in a browser: under the list of profiles. Cancel makes nothing either, and the focus
    // is where it was.
    await page.getByRole('button', { name: 'Open a profile' }).click();
    await page.getByRole('button', { name: 'New profile…' }).click();
    assert.equal(await field.inputValue(), '', 'what was typed and put away is not there again');
    await field.fill('unmade');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await closed('Cancel');
    assert.equal(await focused(page), 'Open a profile');
    assert.deepEqual(await profiles(), ['alone']);

    // No name, or one of spaces, is not asked for at all. One that will not do, and one there is already, are refused in
    // pi-optchat's words, in the dialog, with the focus in the name; nothing is made, and nothing is said over the page.
    await ask(page, 'newProfile');
    assert.equal(await create.isDisabled(), true);
    await field.fill('   ');
    assert.equal(await create.isDisabled(), true);
    await field.fill('Not a name');
    await page.keyboard.press('Enter');
    await refused.filter({ hasText: 'Profile names: 1–64 lowercase letters, digits, hyphens, or underscores.' }).waitFor();
    assert.equal(await focused(page), 'Profile name');
    await field.fill('alone');
    assert.equal(await refused.count(), 0, 'what was said of the last name is gone once another is typed');
    await create.click();
    await refused.filter({ hasText: 'Profile already exists: alone' }).waitFor();
    assert.equal(await focused(page), 'Profile name', 'the button that was pressed went off while it asked, and the focus is in the name again');
    assert.deepEqual([await profiles(), await page.getByRole('alert').count()], [['alone'], 1]);

    // A name that will do: the profile is made, and opened in a tab beside the first and put in front, behind the dialog's
    // second step, which asks what history it brings with the keys on the way to the Import page. The spaces around the name
    // are not part of it. Esc there starts it empty, with the keys in its chat, and does nothing else.
    const bring = page.getByRole('dialog', { name: 'Bring your history' }), brought = async (how: string) => { await page.locator('dialog[aria-label="Bring your history"]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => assert.fail(`${how} did not close the dialog.`)); };
    await field.fill(' second ');
    await page.keyboard.press('Enter');
    await bring.waitFor();
    await page.getByRole('tab', { name: 'second' }).and(page.locator('[aria-selected=true]')).waitFor();
    assert.equal(await focused(page), 'Choose what to import…');
    await page.keyboard.press('Escape');
    await brought('Esc on its second step');
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    assert.deepEqual([await profiles(), await focused(page)], [['alone', 'second'], 'Message']);
    // It is as a first profile is: pi-optchat's own settings and instructions, and nothing else.
    assert.deepEqual(readdirSync(join(at, 'profiles', 'second')).sort(), ['AGENTS.md', 'config.json']);
    // The first profile's chat was left alone: it is still at work, and is stopped from its own page.
    assert.equal((await client.request('windows', {})).windows.find(window => window.id === 'alone/main')?.status, 'running');
    await page.getByRole('tab', { name: 'alone' }).click();
    await stop(page).waitFor();
    await stops(page, 'in the first profile, after another was made');

    // From another page, the settings: the dialog lies over them, and the new profile's chat takes their place.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('textbox', { name: 'Folder for new windows' }).waitFor();
    await ask(page, 'newProfile');
    await field.fill('third');
    await create.click();
    await bring.waitFor();
    await page.getByRole('tab', { name: 'third' }).and(page.locator('[aria-selected=true]')).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Folder for new windows' }).count(), 0);
    // "Choose what to import…" opens the Import page on the new profile, with the sources whose cards were ticked picked
    // there; Esc there is the page's, and closes it.
    for (const card of ['Claude Code', 'Codex']) await bring.getByRole('checkbox', { name: new RegExp(`^${card}\\s*\\d`) }).click();
    await bring.getByRole('button', { name: 'Choose what to import…' }).click();
    await brought('Choosing what to import');
    await page.getByRole('heading', { name: 'Import into third' }).waitFor();
    const picked = page.getByRole('navigation', { name: 'Sources' }).locator('label:has(input:checked) .font-medium');
    await picked.first().waitFor();
    assert.deepEqual(await picked.allTextContents(), ['Claude Code', 'Codex']);
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Message' }).waitFor();
    await page.context().close();

    // With no profile yet the first page is where one is named: no dialog over it, and the keys in its name.
    const first = await open();
    await first.getByRole('textbox', { name: 'Profile name' }).waitFor();
    await ask(first, 'newProfile');
    await first.waitForTimeout(300);
    assert.deepEqual([await first.getByRole('dialog').count(), await focused(first)], [0, 'Profile name']);
    await first.context().close();
    // The first profile is asked what history it brings, in the dialog's second step alone, wherever it is named (the first
    // page and the settings share it: here the settings); starting empty puts the keys in its chat. With no history found on the Mac (no `histories`), it says so instead of offering cards, and its
    // way on is a ChatGPT export.
    const none = join(at, 'none');
    mkdirSync(none);
    const bare = await startServer({ home: none, app: join(none, 'app'), cwd: home, pi });
    try {
      const welcome = await (await browser.newContext({ viewport: WIDE, reducedMotion: 'reduce' })).newPage();
      await welcome.goto(bare.page);
      // Named in the settings, which have the first page's setup: they give way to the new chat and its second step.
      const theme = welcome.getByRole('textbox', { name: 'Folder for new windows' });
      await welcome.getByRole('textbox', { name: 'Profile name' }).waitFor();
      await welcome.keyboard.press('ControlOrMeta+Comma');
      await theme.waitFor();
      await welcome.getByRole('textbox', { name: 'Profile name' }).fill('first');
      await welcome.keyboard.press('Enter');
      const empty = welcome.getByRole('dialog', { name: 'Bring your history' });
      await empty.getByText('No history from Claude Code, Codex or Pi was found on this Mac.').waitFor();
      assert.deepEqual([await empty.getByText(/kept what you did/).count(), await empty.getByRole('checkbox').count(), await focused(welcome), await theme.count()], [0, 0, 'Bring a ChatGPT export…', 0]);
      // ⌘, opens no page under the dialog: started empty, the new chat is what is there.
      await welcome.keyboard.press('ControlOrMeta+Comma');
      await welcome.getByRole('button', { name: 'Start empty' }).click();
      await welcome.locator('dialog').waitFor({ state: 'detached' });
      await welcome.getByRole('textbox', { name: 'Message' }).waitFor();
      assert.deepEqual([await focused(welcome), await theme.count()], ['Message', 0]);
      await welcome.context().close();
    } finally { await bare.close(); }
    // While the setup lacks something (here no Pi at all) nothing could be imported: a profile made on the first page, or in the
    // dialog after it, is not asked what history it brings, and the dialog closes on its chat.
    const lacking = join(at, 'lacking');
    mkdirSync(lacking);
    writeHistories(join(lacking, 'mac'), Date.now());
    const unready = await startServer({ home: lacking, app: join(lacking, 'app'), cwd: home, pi: { command: join(lacking, 'no-such-pi'), args: [] }, histories: join(lacking, 'mac') });
    try {
      const welcome = await (await browser.newContext({ viewport: WIDE, reducedMotion: 'reduce' })).newPage();
      await welcome.goto(unready.page);
      await welcome.getByRole('textbox', { name: 'Profile name' }).fill('first');
      await welcome.keyboard.press('Enter');
      await welcome.getByRole('button', { name: 'Open a profile' }).waitFor();
      await ask(welcome, 'newProfile');
      await welcome.getByRole('textbox', { name: 'Profile name' }).fill('later');
      await welcome.keyboard.press('Enter');
      await welcome.locator('dialog').waitFor({ state: 'detached' });
      await welcome.getByRole('tab', { name: 'later' }).waitFor();
      assert.equal(await welcome.getByRole('dialog', { name: 'Bring your history' }).count(), 0);
      await welcome.context().close();
    } finally { await unready.close(); }
  } finally { client.close(); await own.close(); }
});

test('after a restart one bar offers to resume the agents Pi\'s close cut off, a line a profile, open or not: Resume opens the profile and resumes them, and a dismissed line stays away', async t => {
  const cut = join(home, 'restarted');
  // alpha's Pi crashed (its agent is still saved as working), beta's closed (pi-optchat marked its agents).
  writeRun(createProfile(cut, 'alpha'), { id: 'a0000001', state: 'running', started: 2000 });
  const beta = createProfile(cut, 'beta');
  for (const id of ['b0000001', 'b0000002']) writeRun(beta, { id, state: 'interrupted', started: 3000, ended: 3500, cutOff: true });
  const restarted = await startServer({ home: cut, app: join(cut, 'app'), cwd: home, pi });
  const context = await browser.newContext({ viewport: WIDE, reducedMotion: 'reduce' });
  t.after(async () => { await context.close(); await restarted.close(); });
  await context.addInitScript(() => { if (!localStorage.getItem('optchat-app')) localStorage.setItem('optchat-app', JSON.stringify({ tabs: ['alpha'], profile: 'alpha', selected: {} })); });
  const page = await context.newPage();
  await page.goto(restarted.page);
  const lines = page.getByRole('status').filter({ hasText: 'cut off when Pi closed' });
  await lines.nth(1).waitFor();
  assert.deepEqual(await lines.allTextContents(), ['alpha · An agent was cut off when Pi closed.Resume', 'beta · 2 agents were cut off when Pi closed.Resume']);
  // beta is not open: Resume opens it in front, and resumes its agents through its Pi.
  await page.getByRole('button', { name: 'Resume the agents of beta' }).click();
  await page.getByRole('tab', { name: 'beta', selected: true }).waitFor();
  await lines.nth(1).waitFor({ state: 'detached' });
  assert.deepEqual(await lines.allTextContents(), ['alpha · An agent was cut off when Pi closed.Resume']);
  assert.deepEqual(['b0000001', 'b0000002'].map(id => JSON.parse(readFileSync(join(beta, 'runs', `${id}.optchat.json`), 'utf8'))).map(({ state, cutOff }) => [state, cutOff]), [['running', undefined], ['running', undefined]]);
  await page.getByRole('button', { name: 'Dismiss: alpha' }).click();
  assert.equal(await lines.count(), 0);
  await page.reload();
  await page.getByRole('textbox', { name: 'Message' }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await lines.count(), 0, 'a dismissed line stays away when the app opens again');
});
