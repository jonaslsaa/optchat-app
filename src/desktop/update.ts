import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { Updating } from '../protocol.ts';

/** How the app updates itself (docs/desktop.md). Electron's own updater and electron-updater both hand the new app to
 * Squirrel.Mac, which takes it only if it meets the running app's designated requirement. Signed ad hoc, that requirement is
 * the build's own hash, which no other build has. So the app does it itself: it asks GitHub for the latest release, downloads
 * the zip of the app, checks it, and puts it where the app is when the app quits. Nothing here is Electron's: `main.ts` says
 * when to look and what to show. */

/** Where the latest release is asked for. GitHub answers without a token for a public repository, and 404 for a private one,
 * which is "nothing newer". */
export const LATEST = 'https://api.github.com/repos/jonaslsaa/optchat-app/releases/latest';
/** Where the releases are for you to read: the only place the app opens a release's page in. */
export const RELEASES = 'https://github.com/jonaslsaa/optchat-app/releases';

/** What is read of GitHub's answer. `digest` is the sha256 GitHub takes of a file when it is uploaded. */
const Release = Type.Object({
  tag_name: Type.String(), html_url: Type.String(),
  assets: Type.Array(Type.Object({ name: Type.String(), size: Type.Number(), browser_download_url: Type.String(), digest: Type.Optional(Type.Union([Type.String(), Type.Null()])) })),
});
/** A release newer than the app: its page for you, and its zip of the app with what the zip has to be. The page is opened
 * in your browser, so it is the one the answer names only when that is a page of this repository on GitHub, and else the
 * list of releases: an answer from elsewhere does not say where your browser goes. */
export interface Update { version: string; page: string; url: string; size: number; sha256: string }

const parts = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
/** Whether `version` is after `than`, as numbers (`0.10.0` is after `0.9.0`). A version that is not three numbers, such as a
 * pre-release's, is after nothing. */
export function newer(version: string, than: string) {
  const a = parts(version), b = parts(than);
  if (!a || !b) return false;
  const at = a.findIndex((part, i) => part !== b[i]);
  return at >= 0 && a[at] > b[at];
}
/** The update a release is for an app at `current`, if it is one: a newer version, with that version's zip for this
 * machine's kind (`OptChat-<version>-arm64.zip`) that GitHub has a sha256 of. A zip that cannot be checked is not taken. */
export function offered(release: unknown, current: string, arch: string = process.arch): Update | undefined {
  if (!Value.Check(Release, release) || !newer(release.tag_name, current)) return undefined;
  const version = release.tag_name.replace(/^v/, ''), zip = release.assets.find(asset => asset.name === `OptChat-${version}-${arch}.zip`);
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(zip?.digest ?? '')?.[1];
  return zip && sha256 ? { version, page: release.html_url.startsWith('https://github.com/jonaslsaa/optchat-app/') ? release.html_url : RELEASES, url: zip.browser_download_url, size: zip.size, sha256 } : undefined;
}
/** The latest release, when it is an update for an app at `current`. None is none (a private repository, or no release yet);
 * any other refusal, as when GitHub has been asked too often, is no answer, as no network is. */
export async function latest(feed: string, current: string): Promise<Update | undefined> {
  const response = await fetch(feed, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'OptChat' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) throw new Error(`GitHub answered ${response.status}.`);
  return response.ok ? offered(await response.json(), current) : undefined;
}

/** The folder beside the app an update is made ready in, and the app it replaced is left in: on the app's own disk, so the two
 * change places by name alone. */
const beside = (bundle: string) => join(dirname(bundle), '.OptChat-update');
/** Whether the app can be replaced where it is. Not when it runs from the dmg or from where macOS put a copy it does not trust
 * (both cannot be written to), nor in a folder that is not yours to change. */
export function replaceable(bundle: string) {
  if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/')) return false;
  try { accessSync(dirname(bundle), constants.W_OK); return true; } catch { return false; }
}
const run = promisify(execFile);
/** Removes what an update left beside the app: the app it replaced, or a download that was never put in place. With `rm` and
 * not Node's own: in Electron, Node takes the `app.asar` in an app for a folder, and cannot remove the app around it. */
export async function tidy(bundle: string) { await run('/bin/rm', ['-rf', beside(bundle)]); }

/** A release's own file that no app can be made ready from: it fails the same way every time it is downloaded. */
export class Unusable extends Error {}
/** Downloads the update's zip and makes the app in it ready beside `bundle`. The zip has to be as long as the release says and
 * have its sha256, so one cut off or changed on the way is not unpacked; and the app in it has to be signed and whole, as
 * macOS wants it to start it. Neither says who made it: the sha256 comes with the same answer as the zip's address, so it
 * says the file is the one the release names, and an ad hoc signature (`codesign --verify`) that the app is as it was signed.
 * What is trusted is GitHub and the release (docs/desktop.md). Node downloads it, so macOS does not mark it as downloaded, and
 * it opens without "Open Anyway". Gives the app's path; a failure leaves nothing behind, and is `Unusable` when the file was
 * the release's. `downloaded` is told how many bytes it has, as they come. */
export async function stage(update: Update, bundle: string, downloaded: (bytes: number) => void = () => {}): Promise<string> {
  const folder = beside(bundle), zip = join(folder, 'update.zip');
  await tidy(bundle);
  mkdirSync(folder);
  try {
    // Half an hour at most: a download that stands still would keep every later look from starting.
    const response = await fetch(update.url, { headers: { 'user-agent': 'OptChat' }, signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`The download answered ${response.status}.`);
    const hash = createHash('sha256'), { body } = response;
    let size = 0;
    await pipeline(async function* () { for await (const chunk of body) { hash.update(chunk); downloaded(size += chunk.byteLength); yield chunk; } }, createWriteStream(zip));
    if (size !== update.size || hash.digest('hex') !== update.sha256) throw new Error(`The download is not the release's file (${size} of ${update.size} bytes).`);
    try {
      await run('/usr/bin/ditto', ['-x', '-k', zip, folder]);
      rmSync(zip);
      const apps = readdirSync(folder).filter(name => name.endsWith('.app'));
      if (apps.length !== 1) throw new Error('The download has no app in it.');
      const app = join(folder, apps[0]);
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      return app;
    } catch (error) { throw new Unusable(`OptChat ${update.version} cannot be installed from its release.`, { cause: error }); }
  } catch (error) { await tidy(bundle); throw error; }
}
/** Puts the ready app where `bundle` is, and `bundle` beside it until `tidy`. Two renames, so there is never half an app; if
 * the second fails, the first is undone. For when the app has stopped all it runs: what it has open stays open, but what it
 * would open next is the new app's. */
export function swap(bundle: string, app: string) {
  const old = join(dirname(app), 'replaced.app');
  renameSync(bundle, old);
  try { renameSync(app, bundle); } catch (error) { renameSync(old, bundle); throw error; }
}

export interface UpdaterOptions {
  /** The app (`OptChat.app`) and its version. */
  bundle: string; version: string;
  feed?: string;
  /** A file in which it is kept which version could not be made ready or put in place, so it is not downloaded again for nothing. */
  failed: string;
  /** An update is ready beside the app, and is installed by the next `install`. */
  ready(update: Update): void;
  /** There is an update this copy of the app cannot install itself: all there is to offer is its page. */
  manual(update: Update): void;
  /** What it is doing changed (`state`): for whatever shows it. */
  changed?: (state: Updating) => void;
}
/** Why something failed, in its own words. What `fetch` says of no network is in the error's cause, and where it tried more
 * than one address, in the first of the cause's errors; "fetch failed" is said only where neither says more. */
const words = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const { message, cause } = error;
  return message === 'fetch failed' && cause !== undefined && words(cause instanceof AggregateError ? cause.errors[0] ?? '' : cause) || message;
};
/** What a click on the update button does, by what the updater is doing: it opens the page of an update this copy cannot
 * install, and else looks, as Check for Updates… does, which for an update that is ready asks whether to restart. */
export function clicked(state: Updating | undefined, does: { open(page: string): void; look(): void }) {
  if (state?.state === 'manual') does.open(state.page); else does.look();
}
/** Looks for updates and installs them. `look` asks for the latest release and, if it is newer, makes it ready and says so
 * once (`ready`), or says that you have to get it yourself (`manual`): where the app cannot be replaced, or the same version
 * could not be installed before. A look you `asked` for says again what was said before, and every look answers what it
 * found: an update (`found`), nothing newer (`none`), or that it is looking already, which may be a download (`busy`).
 * `state` is what it is doing now, the one account of it for whatever shows it, and `changed` is told each time it changes:
 * a download says so at every percent, and a look that fails leaves its reason there until the next one.
 * `install` is for the app's end, once everything it runs has stopped: it puts the ready
 * update in place, and says whether it did. Neither restarts anything. */
export function updater({ bundle, version, feed = LATEST, failed, ready, manual, changed }: UpdaterOptions) {
  let looking = false, told: string | undefined, staged: { app: string; update: Update } | undefined, state: Updating = { state: 'idle', looked: false };
  const now = (next: Updating) => { state = next; changed?.(next); };
  const gaveUp = () => { try { return readFileSync(failed, 'utf8'); } catch { return undefined; } };
  const giveUp = (version: string) => { try { writeFileSync(failed, version); } catch { /* Then it is tried again. */ } };
  return {
    state: () => state,
    async look(asked = false): Promise<'found' | 'none' | 'busy'> {
      // One at a time, and none while an update waits for the app to quit: the next one is found by the app it becomes.
      if (looking) return 'busy';
      if (staged) { if (asked) ready(staged.update); return 'found'; }
      looking = true;
      now({ state: 'looking' });
      try {
        // The app this one replaced, when it is the first look after an update. Where nothing can be removed, nothing is.
        const can = replaceable(bundle);
        if (can) await tidy(bundle);
        const update = await latest(feed, version);
        if (!update) { now({ state: 'idle', looked: true }); return 'none'; }
        if (!can || gaveUp() === update.version) {
          now({ state: 'manual', version: update.version, page: update.page });
          if (update.version !== told || asked) { told = update.version; manual(update); }
          return 'found';
        }
        const downloading = (percent: number) => { if (state.state !== 'downloading' || state.percent !== percent) now({ state: 'downloading', version: update.version, percent }); };
        downloading(0);
        // A release that cannot be installed is not downloaded again at every look: its page is offered from the next one on.
        const app = await stage(update, bundle, bytes => downloading(Math.min(100, Math.floor(100 * bytes / update.size))))
          .catch((error: unknown) => { if (error instanceof Unusable) giveUp(update.version); throw error; });
        staged = { app, update };
        told = update.version;
        now({ state: 'ready', version: update.version });
        ready(update);
        return 'found';
      } catch (error) { now({ state: 'failed', error: words(error) }); throw error; } finally { looking = false; }
    },
    install() {
      if (!staged) return false;
      const { app, update: { version } } = staged;
      staged = undefined;
      try { swap(bundle, app); return true; } catch {
        // macOS may refuse an app that changes itself (App Management). The app goes on as it is, and offers the page next time.
        giveUp(version);
        return false;
      }
    },
  };
}
