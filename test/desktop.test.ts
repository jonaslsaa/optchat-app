import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../src/desktop/environment.ts';
import { destination } from '../src/desktop/links.ts';

const MARK = '__OPTCHAT_APP_ENVIRONMENT__';

test('the login shell\'s environment is read from between the marks, whatever its startup files print around them', () => {
  const output = `Last login: today\nnvm is ready\n${MARK}PATH=/opt/homebrew/bin:/usr/bin\0NOTE=two\nlines = kept\0EMPTY=\0SHLVL=2\0PWD=/\0_=/usr/bin/env\0${MARK}\nbye\n`;
  // A value keeps its line breaks and its own `=`; what is the shell's own (where it stands, how deep it is) is left out.
  assert.deepEqual(parseEnvironment(output), { PATH: '/opt/homebrew/bin:/usr/bin', NOTE: 'two\nlines = kept', EMPTY: '' });
  // A shell that failed before the end, or printed something else, has said nothing: the app keeps the environment it has.
  assert.equal(parseEnvironment(`${MARK}PATH=/usr/bin\0`), undefined);
  assert.equal(parseEnvironment('zsh: command not found'), undefined);
});

test('the window stays on the app\'s own page: a web link goes to the browser, and nothing else is opened', () => {
  const page = 'http://127.0.0.1:4781/';
  assert.equal(destination('http://127.0.0.1:4781/images/work/0123456789abcdef', page), 'here');
  assert.equal(destination('https://github.com/jonaslsaa/pi-optchat', page), 'browser');
  assert.equal(destination('http://example.com/', page), 'browser');
  // The same machine on another port is another program's page, as foreign as the web.
  assert.equal(destination('http://127.0.0.1:4780/', page), 'browser');
  // An agent can write any link: a file, another app's scheme and a script are not handed to the system to open.
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://open?x', 'smb://server/share', 'not a url', '']) assert.equal(destination(url, page), 'nowhere');
});
