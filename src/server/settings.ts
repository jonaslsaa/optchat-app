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
/** The settings before any is changed. */
const DEFAULTS: Settings = { theme: 'system', awake: true };

/** The settings as `settings.json` in the app's folder keeps them. A file that is missing or that this app cannot read counts
 * as no settings, and is left as it is until you change one. */
export function readSettings(directory: string): Settings {
  try {
    // A setting the file does not have yet, as one from before the setting was there, is as it is before it is changed.
    const read: unknown = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'));
    const kept = typeof read === 'object' && read !== null && !Array.isArray(read) ? { ...DEFAULTS, ...read } : undefined;
    return Value.Check(Settings, kept) ? kept : DEFAULTS;
  } catch { return DEFAULTS; }
}
export const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
/** Keeps `kept` with what `change` names changed, written whole beside the old file and then put in its place, so a crash
 * leaves one or the other. A folder is kept as its whole path, and has to be there. */
export function writeSettings(directory: string, kept: Settings, { theme = kept.theme, cwd: folder, awake = kept.awake }: Params<'setSettings'>): Settings {
  const cwd = folder === undefined ? kept.cwd : folder === null ? undefined : whole(folder);
  if (folder && cwd && !isDirectory(cwd)) throw new Error(`No such directory: ${cwd}`);
  const settings: Settings = { theme, ...cwd !== undefined && { cwd }, awake }, file = join(directory, 'settings.json');
  mkdirSync(directory, { recursive: true });
  // Two servers may share the folder: each writes a file of its own beside it.
  const written = `${file}.${process.pid}.new`;
  writeFileSync(written, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(written, file);
  return settings;
}
