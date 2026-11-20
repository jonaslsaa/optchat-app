import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** npm, as far as the app's setup uses it: `install --prefix <directory> ... <package>@<range>`, which here puts the fake Pi where
 * npm puts a package's command. FAKE_NPM_PUBLISHED is the Pis that are out, oldest first (1.5.2 alone unless said): `latest`
 * is the last, and `~1.5.2` the newest 1.5. FAKE_NPM_FAILS makes it fail as npm does without a network, or (`quietly`)
 * install nothing and say all is well. */
const prefix = process.argv[process.argv.indexOf('--prefix') + 1], bin = join(prefix, 'node_modules', '.bin');
const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
// FAKE_NPM_DELAY: an install that takes that many milliseconds, as one over a network does.
await new Promise(resolve => setTimeout(resolve, Number(process.env.FAKE_NPM_DELAY ?? 0)));
if (process.env.FAKE_NPM_FAILS === 'quietly') { console.log('\nup to date in 1s'); process.exit(0); }
if (process.env.FAKE_NPM_FAILS) {
  console.error('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/ failed\nnpm error A complete log of this run can be found in: /somewhere');
  process.exit(1);
}
const published = (process.env.FAKE_NPM_PUBLISHED ?? '1.5.2').split(','), range = process.argv.at(-1)?.split('@').at(-1) ?? 'latest';
const version = range === 'latest' ? published.at(-1) : published.findLast(version => version.startsWith(range.replace(/^~(\d+\.\d+)\..*/, '$1.')));
mkdirSync(bin, { recursive: true });
// The fake Pi's own folder says which Pi it is, as it does for any fake Pi.
const home = join(prefix, 'home'), state = join(home, 'state.json');
mkdirSync(home, { recursive: true });
writeFileSync(state, JSON.stringify({ ...existsSync(state) && JSON.parse(readFileSync(state, 'utf8')), version }));
// A Pi that is new on the machine: its own folder has nothing in it yet.
writeFileSync(join(bin, 'pi'), `#!/bin/sh\nFAKE_PI_HOME=${quoted(join(prefix, 'home'))} exec ${quoted(process.execPath)} ${quoted(join(import.meta.dirname, 'fake-pi.ts'))} "$@"\n`);
chmodSync(join(bin, 'pi'), 0o755);
console.log('\nadded 123 packages in 5s');
