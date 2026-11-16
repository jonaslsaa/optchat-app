import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { newer, offered, replaceable, updater, type Update } from '../src/desktop/update.ts';
import { temporaryHome } from './support.ts';

const home = temporaryHome(), mac = { skip: process.platform !== 'darwin' && 'The app is for macOS: its zip and its signature are macOS\'s.' };

test('a version is newer by its numbers, and one that is not three numbers is newer than nothing', () => {
  for (const [version, than] of [['0.10.0', '0.9.9'], ['v1.0.0', '0.99.99'], ['0.0.1', '0.0.0'], ['v2.3.4', 'v2.3.3']]) assert.equal(newer(version, than), true, `${version} > ${than}`);
  for (const [version, than] of [['0.9.0', '0.10.0'], ['1.2.3', '1.2.3'], ['v1.2.3', '1.2.3'], ['1.2.4-beta.1', '1.2.3'], ['latest', '0.0.0'], ['1.2', '1.1.0'], ['', '0.0.0']]) assert.equal(newer(version, than), false, `${version} > ${than}`);
});

test('a release is an update when it is newer and has a zip for this machine that GitHub has a sha256 of', () => {
  const sha256 = 'ab'.repeat(32), asset = (name: string, digest: string | null = `sha256:${sha256}`) => ({ name, size: 7, digest, browser_download_url: `https://example.com/${name}`, state: 'uploaded' });
  const release = (...assets: object[]) => ({ tag_name: 'v0.2.0', html_url: 'https://example.com/v0.2.0', draft: false, assets });
  const both = release(asset('OptChat-0.2.0-arm64.dmg'), asset('OptChat-0.2.0-x64.zip'), asset('OptChat-0.1.0-arm64.zip'), asset('OptChat-0.2.0-arm64.zip'));
  // The zip of this version and this machine's kind: not the dmg a person downloads, another machine's, or an older one's.
  assert.deepEqual(offered(both, '0.1.9', 'arm64'), { version: '0.2.0', page: 'https://example.com/v0.2.0', url: 'https://example.com/OptChat-0.2.0-arm64.zip', size: 7, sha256 } satisfies Update);
  assert.equal(offered(both, '0.2.0', 'arm64'), undefined, 'the same version is not an update');
  assert.equal(offered(both, '0.3.0', 'arm64'), undefined, 'an older release is not an update');
  assert.equal(offered(release(asset('OptChat-0.2.0-arm64.dmg')), '0.1.0', 'arm64'), undefined, 'a release with only a dmg cannot be installed');
  // What cannot be checked is not taken: a file GitHub has no digest of, or another kind of digest.
  for (const digest of [null, 'sha512:' + sha256, 'sha256:xyz']) assert.equal(offered(release(asset('OptChat-0.2.0-arm64.zip', digest)), '0.1.0', 'arm64'), undefined);
  // GitHub's answer for a private repository, or for one with no release.
  for (const answer of [{ message: 'Not Found', status: '404' }, null, 'no', []]) assert.equal(offered(answer, '0.1.0', 'arm64'), undefined);
});

/** An app as macOS wants one, signed ad hoc as OptChat is: a real program in it (`/usr/bin/true`), a file that says which
 * version it is, and a link, as Electron's frameworks are full of. */
function bundle(folder: string, version: string) {
  const app = join(folder, 'OptChat.app'), contents = join(app, 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(contents, 'Resources'));
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>OptChat</string><key>CFBundleIdentifier</key><string>test.optchat</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`);
  copyFileSync('/usr/bin/true', join(contents, 'MacOS', 'OptChat'));
  writeFileSync(join(contents, 'Resources', 'version'), version);
  symlinkSync('version', join(contents, 'Resources', 'current'));
  execFileSync('/usr/bin/codesign', ['--sign', '-', '--force', '--deep', app], { stdio: 'ignore' });
  return app;
}
const versionOf = (app: string) => readFileSync(join(app, 'Contents', 'Resources', 'version'), 'utf8');
/** The zip the release workflow makes of an app (`ditto`, as the Finder compresses). */
function zipped(app: string, zip: string) { execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]); return readFileSync(zip); }
/** GitHub, as far as the app asks it: the latest release at `/latest` and its zip. `served` is the zip as it is sent, which
 * may be another than the release says. */
async function feed(version: string, zip: Buffer, served: (zip: Buffer) => Buffer = zip => zip) {
  let downloads = 0;
  const server = createServer((request, response) => {
    const at = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, name = `OptChat-${version}-${process.arch}.zip`;
    if (request.url === '/latest') response.end(JSON.stringify({ tag_name: `v${version}`, html_url: `${at}/release`, assets: [
      { name: `OptChat-${version}-${process.arch}.dmg`, size: 1, digest: `sha256:${'0'.repeat(64)}`, browser_download_url: `${at}/dmg` },
      { name, size: zip.length, digest: `sha256:${createHash('sha256').update(zip).digest('hex')}`, browser_download_url: `${at}/${name}` },
    ] }));
    else if (request.url === `/${name}`) { downloads++; response.end(served(zip)); }
    else if (request.url === '/limited') response.writeHead(403).end('{"message":"API rate limit exceeded"}');
    else response.writeHead(404).end('{"message":"Not Found"}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const at = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { latest: `${at}/latest`, missing: `${at}/none`, limited: `${at}/limited`, downloads: () => downloads, close: () => new Promise(resolve => server.close(resolve)) };
}
/** A folder with the app at `version` in it, an updater for it, and what the updater said. */
function installed(name: string, version: string, feed: string) {
  const folder = join(home, name);
  mkdirSync(folder);
  const app = bundle(folder, version), said: string[] = [], failed = join(folder, 'update-failed');
  const start = () => updater({ bundle: app, version, feed, failed, ready: update => said.push(`ready ${update.version}`), manual: update => said.push(`manual ${update.version} ${update.page}`) });
  return { folder, app, said, start, beside: join(folder, '.OptChat-update') };
}
const release = (name: string, version: string) => { const folder = join(home, name); mkdirSync(folder); return zipped(bundle(folder, version), join(folder, 'app.zip')); };

test('a newer release is downloaded and made ready beside the app, and takes its place only when the app quits', mac, async () => {
  const github = await feed('0.2.0', release('new', '0.2.0')), { app, said, start, beside } = installed('installed', '0.1.0', github.latest), updates = start();
  try {
    assert.equal(updates.install(), false, 'nothing is ready, so quitting installs nothing');
    assert.equal(await updates.look(), 'found');
    assert.deepEqual(said, ['ready 0.2.0']);
    // The app that runs is untouched until it quits: it is what the agents at work run from.
    assert.equal(versionOf(app), '0.1.0');
    assert.deepEqual(readdirSync(beside), ['OptChat.app'], 'the zip is gone, and the new app waits');
    // Another look while one waits asks nobody and says nothing again.
    assert.equal(await updates.look(), 'found');
    assert.deepEqual([said.length, github.downloads()], [1, 1]);
    // A look you asked for says it again, and downloads nothing again.
    assert.equal(await updates.look(true), 'found');
    assert.deepEqual([said.splice(1), github.downloads()], [['ready 0.2.0'], 1]);

    assert.equal(updates.install(), true);
    assert.equal(versionOf(app), '0.2.0');
    // The app is whole where it now is: signed as macOS wants it, with its links still links.
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    assert.ok(lstatSync(join(app, 'Contents', 'Resources', 'current')).isSymbolicLink());
    assert.equal(versionOf(join(beside, 'replaced.app')), '0.1.0', 'the app it replaced is kept until the new one has opened');
    assert.equal(updates.install(), false, 'it is installed once');

    // The new app's first look removes the old one, and finds nothing newer than itself.
    const next = updater({ bundle: app, version: '0.2.0', feed: github.latest, failed: join(home, 'none'), ready: () => said.push('again'), manual: () => said.push('again') });
    assert.equal(await next.look(true), 'none');
    assert.equal(existsSync(beside), false);
    assert.equal(said.length, 1);
  } finally { await github.close(); }
});

test('a download that is not the release\'s file, or an app that is not whole, is never put in place', mac, async () => {
  const zip = release('whole', '0.2.0'), other = release('other', '6.6.6');
  // An app changed after it was signed, in a zip that is the release's own: the sha256 is right, the signature is not.
  const tampered = join(home, 'tampered');
  mkdirSync(tampered);
  appendFileSync(join(bundle(tampered, '0.2.0'), 'Contents', 'MacOS', 'OptChat'), 'x');
  // What went wrong on the way may go right the next time. What is wrong with the release's own file stays wrong.
  const cases: [what: string, zip: Buffer, served: (zip: Buffer) => Buffer, stays: boolean][] = [
    ['cut off', zip, zip => zip.subarray(0, zip.length >> 1), false],
    // A whole, signed app, but not the file the release names: only the sha256 tells.
    ['another file', zip, () => other, false],
    ['not a zip of an app', Buffer.from('not a zip'), zip => zip, true],
    ['changed after signing', zipped(join(tampered, 'OptChat.app'), join(tampered, 'app.zip')), zip => zip, true],
  ];
  for (const [what, zip, served, stays] of cases) {
    const github = await feed('0.2.0', zip, served), { app, said, start, beside, folder } = installed(`refused ${what}`, '0.1.0', github.latest), updates = start();
    try {
      await assert.rejects(updates.look(), Error, what);
      assert.deepEqual([said, existsSync(beside), updates.install(), versionOf(app)], [[], false, false, '0.1.0'], what);
      if (stays) {
        // The same hundred megabytes are not downloaded again at every look to fail again: the release's page is offered.
        await updates.look();
        await start().look();
        assert.deepEqual([said, github.downloads()], [Array(2).fill(`manual 0.2.0 ${github.latest.replace('/latest', '/release')}`), 1], what);
      } else {
        assert.deepEqual(readdirSync(folder), ['OptChat.app'], `${what}: nothing is left behind, and nothing is kept against the version`);
        // The next look tries again, as after a network that came back.
        await assert.rejects(updates.look());
        assert.equal(github.downloads(), 2, what);
      }
      assert.equal(versionOf(app), '0.1.0', what);
    } finally { await github.close(); }
  }
});

test('no answer is no update: a private repository, no release yet, or no network', mac, async () => {
  const github = await feed('0.2.0', Buffer.from('never asked for')), { said, start, app } = installed('quiet', '0.1.0', github.missing);
  try {
    assert.equal(await start().look(), 'none');
    // GitHub refuses, as when it was asked too often: that is no answer, and not "nothing newer", which a look you asked
    // for would say.
    await assert.rejects(updater({ bundle: app, version: '0.1.0', feed: github.limited, failed: join(home, 'none'), ready: () => {}, manual: () => {} }).look(true), /GitHub answered 403/);
    await github.close();
    // Nobody is there at all: the look fails, which the app lets pass in silence.
    await assert.rejects(start().look());
    assert.deepEqual([said, github.downloads(), versionOf(app)], [[], 0, '0.1.0']);
  } finally { await github.close(); }
});

test('an app that cannot be replaced where it is downloads nothing and offers the release\'s page, once', mac, async () => {
  const github = await feed('0.2.0', release('unwritable', '0.2.0')), { folder, app, said, start } = installed('read-only', '0.1.0', github.latest), updates = start();
  // As on the dmg it came in, or where macOS runs a copy it does not trust: the folder cannot be written to. What an earlier
  // update left there cannot be removed either, which is no reason not to say that there is a new one.
  mkdirSync(join(folder, '.OptChat-update', 'replaced.app'), { recursive: true });
  chmodSync(join(folder, '.OptChat-update'), 0o555);
  chmodSync(folder, 0o555);
  try {
    await updates.look();
    await updates.look();
    assert.deepEqual(said, [`manual 0.2.0 ${github.latest.replace('/latest', '/release')}`]);
    // Asked for, the page is offered again.
    assert.equal(await updates.look(true), 'found');
    assert.equal(said.splice(1).length, 1);
    assert.deepEqual([github.downloads(), updates.install(), versionOf(app)], [0, false, '0.1.0']);
    // An app opened from where it was downloaded runs from a copy macOS makes elsewhere, which is gone when it quits.
    const copy = join(home, 'AppTranslocation', 'd');
    mkdirSync(copy, { recursive: true });
    assert.equal(replaceable(join(copy, 'OptChat.app')), false);
    chmodSync(folder, 0o755);
    assert.equal(replaceable(app), true);
  } finally { chmodSync(folder, 0o755); chmodSync(join(folder, '.OptChat-update'), 0o755); await github.close(); }
});

test('an update that could not be put in place leaves the app as it was, and its version is offered as a page from then on', mac, async () => {
  const github = await feed('0.2.0', release('refused', '0.2.0')), { app, said, start, beside } = installed('stuck', '0.1.0', github.latest), updates = start();
  try {
    await updates.look();
    // What macOS does when it refuses the app's change of itself, as far as a test can: the second rename fails.
    rmSync(join(beside, 'OptChat.app'), { recursive: true });
    assert.equal(updates.install(), false);
    assert.equal(versionOf(app), '0.1.0', 'the app is back where it was');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    // The app as it opens next: the same version is not downloaded again to fail again.
    await start().look();
    assert.deepEqual([said, github.downloads()], [['ready 0.2.0', `manual 0.2.0 ${github.latest.replace('/latest', '/release')}`], 1]);
  } finally { await github.close(); }
});
