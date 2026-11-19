import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readThemes } from '../src/server/settings.ts';
import { chosen, parseTheme, readTheme, type Theme } from '../src/ui/themes.ts';
import { temporaryHome } from './support.ts';

const FOLDER = join(import.meta.dirname, '../src/ui/themes');
const file = (colors: object, more: object = {}) => ({ version: 1, name: 'Mine', appearance: 'dark', colors, ...more });
const why = (value: unknown) => { const read = readTheme('mine.json', value); return 'error' in read ? read.error : undefined; };

test('the built-in themes are theme files: each reads, in light and dark, with its sidebar art', () => {
  const names = readdirSync(FOLDER).sort();
  assert.deepEqual(names, ['blossom.json', 'ember.json', 'grove.json', 'iris.json', 'ocean.json']);
  for (const name of names) {
    const theme = parseTheme(name, readFileSync(join(FOLDER, name), 'utf8'));
    assert.ok('name' in theme, `${name}: ${'error' in theme && theme.error}`);
    assert.ok(theme.light?.['art-top'] && theme.dark?.['art-line'], name);
  }
});

test('a theme file is read as its colours in each appearance it has, and only what it names is set', () => {
  const read = readTheme('mine.json', file({ background: ' #101418 ', 'sidebar-border': 'rgb(255 255 255 / 8%)', border: 'rgba(0, 0, 0, 0.1)' }, { variants: { light: { primary: 'oklch(0.6 0.2 260)', ring: 'hsl(210deg 40% 50%)' } } }));
  assert.deepEqual(read, { id: 'mine.json', name: 'Mine', dark: { background: '#101418', 'sidebar-border': 'rgb(255 255 255 / 8%)', border: 'rgba(0, 0, 0, 0.1)' }, light: { primary: 'oklch(0.6 0.2 260)', ring: 'hsl(210deg 40% 50%)' } });
});

test('a file that ends up in the page\'s CSS takes literal colours only, and says why it is no theme', () => {
  for (const color of ['url(https://x.test/a.png)', 'var(--primary)', 'red; background: url(x)', '#12345', 'color-mix(in srgb, red 50%, blue)', 'oklch(0.5 0.1 200) }', 'expression(alert(1))', 'red', '', 'rgb()', 'rgb(1)', 'oklch(0.5)', 'rgb(1 2 3 4 5)', 'hsl(1 2 3 / 4 / 5)']) {
    assert.match(why(file({ background: color })) ?? '', /"background" is no colour/, color);
  }
  assert.match(why(file({ backdrop: '#000' })) ?? '', /"backdrop" is no colour a theme sets/);
  assert.match(why(file({})) ?? '', /empty/);
  assert.match(why(file({ 'art-top': '#000' })) ?? '', /1 of the 7 art- colours/);
  assert.match(why(file({ background: '#000' }, { name: 'x'.repeat(49) })) ?? '', /48 characters/);
  assert.match(why(file({ background: '#000' }, { version: 2 })) ?? '', /version/);
  assert.match(why(file({ background: '#000' }, { variants: { dark: { background: '#111' } } })) ?? '', /no variant/);
  assert.match(why([]) ?? '', /no JSON object/);
  assert.deepEqual(parseTheme('mine.json', '{ "version": 1,'), { id: 'mine.json', error: 'It is not JSON.' });
});

test('the theme drawn is the one the settings name for that appearance, and the app\'s own when it has none for it', () => {
  const night: Theme = { id: 'night.json', name: 'Night', dark: { background: '#000' } };
  const themes = [night, { id: 'broken.json', error: 'It is not JSON.' }];
  assert.equal(chosen(themes, { palette: { dark: 'night.json' } }, 'dark'), night);
  // A theme with no light colours, one that is no theme, one that is gone, and none named: the app's own.
  assert.equal(chosen(themes, { palette: { light: 'night.json' } }, 'light'), undefined);
  assert.equal(chosen(themes, { palette: { dark: 'broken.json' } }, 'dark'), undefined);
  assert.equal(chosen(themes, { palette: { dark: 'gone.json' } }, 'dark'), undefined);
  assert.equal(chosen(themes, {}, 'dark'), undefined);
});

test('the server hands over only theme files it can read at once: not a pipe or a device, nor one over 64 KB', () => {
  const home = temporaryHome(), folder = join(home, 'themes');
  mkdirSync(folder);
  writeFileSync(join(folder, 'mine.JSON'), '{}');
  writeFileSync(join(folder, 'big.json'), 'x'.repeat(64 * 1024 + 1));
  writeFileSync(join(folder, 'notes.txt'), '{}');
  execFileSync('mkfifo', [join(folder, 'pipe.json')]);
  symlinkSync('/dev/zero', join(folder, 'zero.json'));
  assert.deepEqual(readThemes(home).files, [
    { file: 'big.json', error: 'It is larger than 64 KB.' },
    { file: 'mine.JSON', text: '{}' },
    { file: 'pipe.json', error: 'It is not a file.' },
    { file: 'zero.json', error: 'It is not a file.' },
  ]);
});
