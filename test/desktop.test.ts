import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { awake } from '../src/desktop/awake.ts';
import { loginEnvironment, parseEnvironment } from '../src/desktop/environment.ts';
import { destination } from '../src/desktop/links.ts';
import { appMenu } from '../src/desktop/menu.ts';
import { quitter } from '../src/desktop/quit.ts';
import { contextMenu, placed, recovery } from '../src/desktop/window.ts';
import { temporaryHome } from './support.ts';

const MARK = '__OPTCHAT_APP_ENVIRONMENT__';

test('the login shell\'s environment is read from between the marks, whatever its startup files print around them', () => {
  const output = `Last login: today\nnvm is ready\n${MARK}PATH=/opt/homebrew/bin:/usr/bin\0NOTE=two\nlines = kept\0EMPTY=\0SHLVL=2\0PWD=/\0_=/usr/bin/env\0${MARK}\nbye\n`;
  // A value keeps its line breaks and its own `=`; what is the shell's own (where it stands, how deep it is) is left out.
  assert.deepEqual(parseEnvironment(output), { PATH: '/opt/homebrew/bin:/usr/bin', NOTE: 'two\nlines = kept', EMPTY: '' });
  // A shell that failed before the end, or printed something else, has said nothing: the app keeps the environment it has.
  assert.equal(parseEnvironment(`${MARK}PATH=/usr/bin\0`), undefined);
  assert.equal(parseEnvironment('zsh: command not found'), undefined);
});

test('a login shell that leaves something running, or never answers, does not keep the app from opening', async () => {
  const directory = temporaryHome();
  const shell = (name: string, script: string) => { const file = join(directory, name); writeFileSync(file, `#!/bin/sh\n${script}\n`); chmodSync(file, 0o755); return file; };
  // What a startup file left running holds the shell's output open long after the shell has answered and gone.
  const began = Date.now(), environment = await loginEnvironment(shell('leaves', 'sleep 3 &\nFROM_SHELL=yes; export FROM_SHELL\neval "$2"'), 10_000);
  assert.equal(environment?.FROM_SHELL, 'yes');
  assert.ok(Date.now() - began < 2000, 'the answer was not waited for past its end');
  // A shell that hangs is given up on, and killed with what it started.
  const marker = join(directory, 'pid');
  assert.equal(await loginEnvironment(shell('hangs', `sleep 20 &\necho $! > ${marker}\nwait`), 300), undefined);
  const alive = () => { try { return process.kill(Number(readFileSync(marker, 'utf8')), 0); } catch { return false; } };
  for (let tries = 0; alive() && tries < 50; tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(alive(), false, 'what the shell started is gone with it');
});

test('the window stays on the app\'s own page: a web link goes to the browser, and nothing else is opened', () => {
  const page = 'http://127.0.0.1:4781/';
  assert.equal(destination('http://127.0.0.1:4781/images/work/0123456789abcdef', page), 'here');
  assert.equal(destination('https://github.com/jonaslsaa/pi-optchat', page), 'web');
  assert.equal(destination('http://example.com/', page), 'web');
  // The same machine on another port is another program's page, as foreign as the web.
  assert.equal(destination('http://127.0.0.1:4780/', page), 'web');
  // An agent can write any link: a file, another app's scheme and a script are not handed to the system to open.
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://open?x', 'smb://server/share', 'not a url', '']) assert.equal(destination(url, page), 'nowhere');
});

test('the window opens where it was closed only if that is still whole on a screen there is now', () => {
  const laptop = { x: 0, y: 0, width: 1512, height: 982 }, beside = { x: 1512, y: -200, width: 2560, height: 1440 };
  const kept = { x: 1600, y: 0, width: 1400, height: 900 };
  assert.deepEqual(placed(kept, [laptop, beside]), kept);
  // What else was kept with it is not handed to the window.
  assert.deepEqual(placed({ ...kept, fullscreen: true }, [laptop, beside]), kept);
  // The second screen is unplugged: the window would open where nobody sees it, so it opens as a new one.
  assert.equal(placed(kept, [laptop]), undefined);
  // Half on one screen and half on the next is how a window can be left; it is not reopened across the two.
  assert.equal(placed({ x: 1000, y: 0, width: 1400, height: 900 }, [laptop, beside]), undefined);
  // Filling a screen, a pixel past its edge, is on it; more is not.
  assert.deepEqual(placed({ x: -1, y: 0, width: 1514, height: 982 }, [laptop]), { x: -1, y: 0, width: 1514, height: 982 });
  assert.equal(placed({ x: -2, y: 0, width: 1512, height: 982 }, [laptop]), undefined);
  // A file that is not a window's place: never written, cut off, or from another version.
  for (const saved of [undefined, null, 'x', {}, { x: 0, y: 0, width: 0, height: 900 }, { x: 0.5, y: 0, width: 800, height: 600 }, { x: '0', y: 0, width: 800, height: 600 }]) assert.equal(placed(saved, [laptop]), undefined);
});

test('a page that crashed is loaded again after a longer wait each time, and not for ever', () => {
  const recover = recovery();
  assert.deepEqual([recover('crashed', 0), recover('oom', 1000), recover('killed', 2000)], [500, 1000, 2000]);
  // A fourth time within the minute: the page crashes as it loads, and loading it again would not end.
  assert.equal(recover('crashed', 3000), undefined);
  // A minute after the first, that one no longer counts.
  assert.equal(recover('crashed', 60_500), 2000);
  // A process that ended because the page was closed, or that never started, is not a crash.
  const other = recovery();
  for (const reason of ['clean-exit', 'launch-failed', 'integrity-failure']) assert.equal(other(reason, 0), undefined);
  assert.equal(other('abnormal-exit', 0), 500, 'and counted for nothing');
});

test('a right click offers what can be done where it was made', () => {
  const page = 'http://127.0.0.1:4781/', did: string[] = [];
  const does = { replace: (word: string) => did.push(`replace ${word}`), copyLink: () => did.push('link'), copyImage: () => did.push('image') };
  const flags = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canDelete: false, canSelectAll: true, canEditRichly: false };
  const menu = (params: Partial<Parameters<typeof contextMenu>[0]>) => contextMenu({ misspelledWord: '', dictionarySuggestions: [], linkURL: '', mediaType: 'none', editFlags: flags, ...params }, page, does);
  const shown = (params: Parameters<typeof menu>[0]) => menu(params).map(item => item.type === 'separator' ? '-' : `${item.label ?? item.role}${item.enabled === false ? ' (off)' : ''}`);
  // On the page itself there is nothing to cut or paste, and the menu says so.
  assert.deepEqual(shown({}), ['cut (off)', 'copy (off)', 'paste (off)', 'selectAll']);
  // In the composer, on a word marked as wrong: its spellings, five at most, and picking one replaces the word.
  const typing = { misspelledWord: 'wrod', editFlags: { ...flags, canCut: true, canCopy: true, canPaste: true } };
  assert.deepEqual(shown({ ...typing, dictionarySuggestions: ['word', 'rod', 'wood', 'trod', 'prod', 'wrote'] }), ['word', 'rod', 'wood', 'trod', 'prod', '-', 'cut', 'copy', 'paste', 'selectAll']);
  assert.deepEqual(shown(typing).slice(0, 2), ['No suggestions (off)', '-']);
  menu({ ...typing, dictionarySuggestions: ['word'] })[0].click?.(undefined as never, undefined, undefined as never);
  // A link the app would open, to the web or to a picture of its own, can be copied; any other address an agent wrote cannot.
  for (const linkURL of ['https://github.com/jonaslsaa/pi-optchat/pull/1', `${page}images/work/0123456789abcdef`]) assert.deepEqual(shown({ linkURL }).slice(0, 2), ['Copy Link', '-']);
  for (const linkURL of ['file:///etc/passwd', 'javascript:alert(1)', '']) assert.equal(shown({ linkURL }).includes('Copy Link'), false);
  assert.deepEqual(shown({ mediaType: 'image', linkURL: 'https://example.com/' }).slice(0, 4), ['Copy Link', '-', 'Copy Image', '-']);
  for (const item of menu({ mediaType: 'image', linkURL: 'https://example.com/' }).slice(0, 3)) item.click?.(undefined as never, undefined, undefined as never);
  assert.deepEqual(did, ['replace word', 'link', 'image']);
});

test('a quit waits until everything is stopped, and asks first only while agents work', async () => {
  /** An app as far as quitting goes: what was done, in order, and the answers it is given. */
  const app = (working: number | Error, answer = true) => {
    const did: string[] = [], held: (() => void)[] = [];
    const quit = quitter({
      working: async () => { if (working instanceof Error) throw working; return working; },
      ask: working => { did.push(`ask ${working}`); return new Promise(resolve => held.push(() => resolve(answer))); },
      close: () => { did.push('close'); return new Promise(resolve => held.push(resolve)); },
      quit: () => { did.push('quit'); },
    });
    /** What is waited for now (the answer, or everything stopping) comes. */
    const next = async () => { held.shift()?.(); await new Promise(resolve => setImmediate(resolve)); };
    return { did, quit, next, settle: () => new Promise(resolve => setImmediate(resolve)) };
  };
  // Nothing works: no question. The quit is held back until everything has stopped, however often it is asked for meanwhile
  // (a Cmd+Q held), and then goes through.
  const idle = app(0);
  assert.equal(idle.quit.request(), false);
  await idle.settle();
  assert.deepEqual([idle.quit.request(), idle.quit.request(), idle.did], [false, false, ['close']]);
  await idle.next();
  assert.deepEqual([idle.did, idle.quit.request()], [['close', 'quit'], true]);

  // Agents work: one question, though the quit is asked for three times, and nothing is stopped before the answer.
  const busy = app(2);
  for (let i = 0; i < 3; i++) { assert.equal(busy.quit.request(), false); await busy.settle(); }
  assert.deepEqual(busy.did, ['ask 2']);
  await busy.next();
  assert.deepEqual(busy.did, ['ask 2', 'close']);
  await busy.next();
  assert.deepEqual([busy.did, busy.quit.request()], [['ask 2', 'close', 'quit'], true]);

  // No: everything goes on, and the next quit asks again.
  const stays = app(1, false);
  stays.quit.request();
  await stays.settle();
  await stays.next();
  assert.deepEqual([stays.did, stays.quit.request()], [['ask 1'], false]);
  await stays.settle();
  assert.deepEqual(stays.did, ['ask 1', 'ask 1']);

  // A quit that was agreed to already (a restart into an update) or a signal is not asked about, also over an open question.
  const sure = app(3);
  sure.quit.request();
  await sure.settle();
  assert.equal(sure.quit.request(true), false);
  assert.deepEqual(sure.did, ['ask 3', 'close']);
  await sure.next(); // The question's answer, which comes too late to matter: everything is stopped once.
  await sure.next();
  assert.deepEqual([sure.did, sure.quit.request()], [['ask 3', 'close', 'quit'], true]);

  // The same while the agents are still being counted: once they are, nothing is asked.
  let counted = (_count: number) => {};
  const did: string[] = [];
  const counting = quitter({ working: () => new Promise(resolve => { counted = resolve; }), ask: async working => { did.push(`ask ${working}`); return false; }, close: async () => { did.push('close'); }, quit: () => { did.push('quit'); } });
  counting.request();
  counting.request(true);
  counted(2);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([did, counting.request()], [['close', 'quit'], true]);

  // What cannot be counted is not asked about: the app still quits.
  const unknown = app(new Error('No answer.'));
  unknown.quit.request();
  await unknown.settle();
  assert.deepEqual(unknown.did, ['close']);
});

test('the Mac is kept awake while agents work, and let go a little after the last one', async () => {
  /** A Mac as far as its sleep goes: what was done to it, and what the app sees of its agents and its setting. */
  const mac = () => {
    const did: string[] = [], state = { working: 0 as number | Error, wanted: true };
    let ids = 0;
    const look = awake({
      wanted: () => state.wanted, working: async () => { if (state.working instanceof Error) throw state.working; return state.working; },
      blocker: { start: () => { did.push(`start ${++ids}`); return ids; }, stop: id => { did.push(`stop ${id}`); } },
    });
    const looks = async (times: number) => { for (let i = 0; i < times; i++) await look(); };
    return { did, state, looks };
  };
  // Nothing works: nothing is held. An agent works: held once, however often it is looked (a look every few seconds for hours).
  const one = mac();
  await one.looks(5);
  assert.deepEqual(one.did, []);
  one.state.working = 2;
  await one.looks(50);
  assert.deepEqual(one.did, ['start 1']);
  // Between an agent's end and the turn its report starts, nothing works for a moment: the Mac is not let go for that.
  one.state.working = 0;
  await one.looks(1);
  one.state.working = 1;
  await one.looks(1);
  one.state.working = 0;
  await one.looks(1);
  assert.deepEqual(one.did, ['start 1']);
  // A second look in a row with nothing at work lets it sleep again, and the next run holds it anew.
  await one.looks(1);
  assert.deepEqual(one.did, ['start 1', 'stop 1']);
  await one.looks(10);
  one.state.working = 1;
  await one.looks(1);
  assert.deepEqual(one.did, ['start 1', 'stop 1', 'start 2']);
  // Turned off in the settings, it is let go at the next look, agents at work or not, and not held while it is off.
  one.state.wanted = false;
  await one.looks(1);
  assert.deepEqual(one.did, ['start 1', 'stop 1', 'start 2', 'stop 2']);
  await one.looks(3);
  assert.equal(one.did.length, 4);
  one.state.wanted = true;
  await one.looks(1);
  assert.deepEqual(one.did.at(-1), 'start 3');
  // A count that fails is nothing at work.
  one.state.working = new Error('No answer.');
  await one.looks(3);
  assert.deepEqual(one.did.at(-1), 'stop 3');
});

test('the menu bar names the app, asks the page for what the page does, and leaves a key to the page that has it', () => {
  const did: string[] = [], state = { keys: true };
  const does = { page: (action: string) => { did.push(action); }, keys: () => state.keys, browse: (url: string) => { did.push(url); } };
  const menu = appMenu({ ...does, update: () => { did.push('update'); } });
  const under = (top: typeof menu[number]) => top.submenu instanceof Array ? top.submenu : [];
  const shown = (label: string, from = menu) => from.flatMap(top => (top.label ?? top.role) === label ? under(top) : [])
    .map(item => item.type === 'separator' ? '-' : `${item.label ?? item.role}${item.accelerator ? ` [${item.accelerator}]` : ''}${item.enabled === false ? ' (off)' : ''}`);
  assert.deepEqual(menu.map(top => top.label ?? top.role), ['OptChat', 'File', 'editMenu', 'View', 'windowMenu', 'help']);
  // Electron's own entries would name the app by its package: every one that names it is written out.
  assert.deepEqual(shown('OptChat'), ['About OptChat', 'Check for Updates…', '-', 'Settings… [Cmd+,]', '-', 'services', '-', 'Hide OptChat', 'hideOthers', 'unhide', '-', 'Quit OptChat']);
  assert.deepEqual(shown('File'), ['New Connected Window [Shift+Cmd+O]', 'New Profile…', '-', 'close']);
  assert.deepEqual(shown('View').slice(0, 6), ['Find in Chat [Cmd+F]', 'Search Memory [Shift+Cmd+F]', 'Chat or Memory', 'Usage', 'Show or Hide Sidebar [Cmd+B]', '-']);
  assert.deepEqual(shown('help'), ['Report a Problem', 'OptChat on GitHub']);
  // A key without ⌘ would go to the menu before the page, and be taken from it: no entry has one.
  assert.deepEqual(menu.flatMap(under).flatMap(item => item.accelerator && !item.accelerator.includes('Cmd') ? [item.label] : []), []);
  // Run from the checkout the app does not update itself, and the entry says so by being off.
  assert.equal(shown('OptChat', appMenu(does))[1], 'Check for Updates… (off)');

  const items = menu.flatMap(under), entry = (label: string) => items.find(item => item.label === label);
  const click = (label: string, triggeredByAccelerator = false) => entry(label)?.click?.(undefined as never, undefined, { triggeredByAccelerator });
  // A click asks the page, wherever the focus is.
  for (const label of ['Settings…', 'New Connected Window', 'New Profile…', 'Find in Chat', 'Search Memory', 'Chat or Memory', 'Usage', 'Show or Hide Sidebar']) click(label);
  assert.deepEqual(did.splice(0), ['settings', 'newWindow', 'newProfile', 'find', 'search', 'memory', 'usage', 'sidebar']);
  // A key the page had first and left, as it leaves ⇧⌘F in the panel beside the chat, is not run behind its back, and a key it
  // took never gets here: nothing runs twice. With no window, or the focus outside the page, the menu is all that hears it.
  click('Settings…', true); click('Search Memory', true);
  assert.deepEqual(did, []);
  state.keys = false;
  click('Settings…', true);
  assert.deepEqual(did.splice(0), ['settings']);
  click('Check for Updates…'); click('Report a Problem'); click('OptChat on GitHub');
  assert.deepEqual(did, ['update', 'https://github.com/jonaslsaa/optchat-app/issues/new', 'https://github.com/jonaslsaa/optchat-app']);
});
