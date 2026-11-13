import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginEnvironment, parseEnvironment } from '../src/desktop/environment.ts';
import { destination } from '../src/desktop/links.ts';
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
