import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Value } from 'typebox/value';
import { Settings, type Params } from '../protocol.ts';
import { isEditor } from './files.ts';

/** The app's own folder: its settings, and the Pi it installs. Never pi-optchat's `~/.optchat`. `OPTCHAT_APP_HOME` moves it,
 * which is how tests keep away from yours. */
export const appHome = () => whole(process.env.OPTCHAT_APP_HOME ?? '~/.optchat-app');
/** A folder as its whole path, as you would write it: `~` is your home folder. */
function whole(path: string) { return resolve(path.replace(/^~(?=$|[\\/])/, homedir())); }
/** The settings before any is changed. */
const DEFAULTS: Settings = { theme: 'system', art: true, awake: true };

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
 * leaves one or the other. A folder is kept as its whole path, and has to be there; an editor is one of `EDITORS`. */
export function writeSettings(directory: string, kept: Settings, { theme = kept.theme, palette = kept.palette, art = kept.art, cwd: folder, awake = kept.awake, editor = kept.editor }: Params<'setSettings'>): Settings {
  const cwd = folder === undefined ? kept.cwd : folder === null ? undefined : whole(folder);
  if (folder && cwd && !isDirectory(cwd)) throw new Error(`No such directory: ${cwd}`);
  if (editor !== undefined && !isEditor(editor)) throw new Error(`No editor ${editor}.`);
  const settings: Settings = { theme, ...palette && Object.keys(palette).length > 0 && { palette }, art, ...cwd !== undefined && { cwd }, awake, ...editor !== undefined && { editor } }, file = join(directory, 'settings.json');
  mkdirSync(directory, { recursive: true });
  // Two servers may share the folder: each writes a file of its own beside it.
  const written = `${file}.${process.pid}.new`;
  writeFileSync(written, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(written, file);
  return settings;
}

/** Your own themes: the `.json` files in the `themes` folder beside the settings, by name, each as its text. The page reads
 * them (`ui/themes.ts`), so a file that is no theme is shown there with why. One larger than a theme can be is not read. */
export function readThemes(directory: string) {
  const folder = join(directory, 'themes');
  let names: string[] = [];
  try { names = readdirSync(folder).filter(name => name.toLowerCase().endsWith('.json')).sort(); } catch { /* No folder yet: no themes. */ }
  return {
    folder, files: names.slice(0, 100).map(file => {
      try {
        if (statSync(join(folder, file)).size > 64 * 1024) return { file, error: 'It is larger than 64 KB.' };
        return { file, text: readFileSync(join(folder, file), 'utf8') };
      } catch (error) { return { file, error: `It could not be read: ${error instanceof Error ? error.message : String(error)}` }; }
    }),
  };
}
