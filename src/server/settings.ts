import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Value } from 'typebox/value';
import { Settings, type Params } from '../protocol.ts';

/** The app's own folder: its settings, and the Pi it installs. Never pi-optchat's `~/.optchat`. `OPTCHAT_APP_HOME` moves it,
 * which is how tests keep away from yours. */
export const appHome = () => whole(process.env.OPTCHAT_APP_HOME ?? '~/.optchat-app');
/** A folder as its whole path, as you would write it: `~` is your home folder. */
function whole(path: string) { return resolve(path.replace(/^~(?=$|[\\/])/, homedir())); }
const DEFAULTS: Settings = { theme: 'system' };

/** The settings as `settings.json` in the app's folder keeps them. A file that is missing or that this app cannot read counts
 * as no settings, and is left as it is until you change one. */
export function readSettings(directory: string): Settings {
  try {
    const kept: unknown = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'));
    return Value.Check(Settings, kept) ? kept : DEFAULTS;
  } catch { return DEFAULTS; }
}
export const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
/** Keeps `kept` with what `change` names changed, written whole beside the old file and then put in its place, so a crash
 * leaves one or the other. A folder is kept as its whole path, and has to be there. */
export function writeSettings(directory: string, kept: Settings, { theme = kept.theme, cwd: folder }: Params<'setSettings'>): Settings {
  const cwd = folder === undefined ? kept.cwd : folder === null ? undefined : whole(folder);
  if (folder && cwd && !isDirectory(cwd)) throw new Error(`No such directory: ${cwd}`);
  const settings: Settings = { theme, ...cwd !== undefined && { cwd } }, file = join(directory, 'settings.json');
  mkdirSync(directory, { recursive: true });
  // Two servers may share the folder: each writes a file of its own beside it.
  const written = `${file}.${process.pid}.new`;
  writeFileSync(written, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(written, file);
  return settings;
}
