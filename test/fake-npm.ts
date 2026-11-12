import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** npm, as far as the app's setup uses it: `install --prefix <directory> ... <package>`, which here puts the fake Pi where npm
 * puts a package's command. FAKE_NPM_FAILS makes it fail as npm does without a network, or (`quietly`) install nothing and
 * say all is well. */
const prefix = process.argv[process.argv.indexOf('--prefix') + 1], bin = join(prefix, 'node_modules', '.bin');
const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
if (process.env.FAKE_NPM_FAILS === 'quietly') { console.log('\nup to date in 1s'); process.exit(0); }
if (process.env.FAKE_NPM_FAILS) {
  console.error('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/ failed\nnpm error A complete log of this run can be found in: /somewhere');
  process.exit(1);
}
mkdirSync(bin, { recursive: true });
// A Pi that is new on the machine: its own folder has nothing in it yet.
writeFileSync(join(bin, 'pi'), `#!/bin/sh\nFAKE_PI_HOME=${quoted(join(prefix, 'home'))} exec ${quoted(process.execPath)} ${quoted(join(import.meta.dirname, 'fake-pi.ts'))} "$@"\n`);
chmodSync(join(bin, 'pi'), 0o755);
console.log('\nadded 123 packages in 5s');
