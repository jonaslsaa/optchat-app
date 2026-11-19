import { spawn } from 'node:child_process';
import { opendir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Mention } from '../protocol.ts';
import { scoreQueryMatch } from './ranking.ts';

/** At most this many files and folders are listed of a folder, and for at most `TIME`: a folder with more, or a slow disk,
 * lists what it found by then. A listing is kept for `KEPT`, so a message's every letter does not read the disk again. */
export const CAP = 25_000;
const TIME = 3_000, KEPT = 30_000, SHOWN = 20;
const kept = new Map<string, { at: number; listed: Promise<Mention[]> }>();

/** What a message's `@` can name under `cwd`, the `SHOWN` that match `query` best. Typed up to a `/`, the query names a
 * folder, whose files are listed and matched by what follows. A folder in a git repository lists what git does, with what
 * `.gitignore` leaves out left out; one outside a repository is walked from the top, a level at a time, without dot-folders
 * and `node_modules`, so a deep file outside one is found by typing its folders. Only ever under `cwd`. */
export async function mentions(cwd: string, query: string): Promise<Mention[]> {
  if (isAbsolute(query) || query.startsWith('~') || query.includes('\\') || query.split('/').includes('..')) throw new Error('Only a file in the folder this chat runs in can be named.');
  const slash = query.lastIndexOf('/') + 1, base = query.slice(0, slash), typed = query.slice(slash).toLowerCase();
  const found = (await listing(resolve(cwd, base))).flatMap(({ path, dir }) => {
    const depth = path.split('/').length, value = path.toLowerCase(), name = value.slice(value.lastIndexOf('/') + 1);
    // With nothing typed after the folder, what is in it, its folders first. Else by how the name matches, then how the path
    // does: a match of the name's beats any of only the path's but its letters in order.
    const score = !typed ? depth * 2 + (dir ? 0 : 1) : Math.min(
      scoreQueryMatch({ value: name, query: typed, markers: ['-', '_', '.', ' '], exact: 0, prefix: 2, boundary: 3, includes: 4, fuzzy: 8 }) ?? Infinity,
      scoreQueryMatch({ value, query: typed, markers: ['/', '-', '_', '.', ' '], exact: 1, prefix: 5, boundary: 6, includes: 7, fuzzy: 9 }) ?? Infinity);
    return score < Infinity ? [{ path: base + path, dir, score, depth }] : [];
  });
  return found.toSorted((a, b) => a.score - b.score || a.depth - b.depth || a.path.localeCompare(b.path)).slice(0, SHOWN).map(({ path, dir }) => ({ path, dir }));
}

/** What is in `folder`, as `mentions` matches it: kept for a while. */
export function listing(folder: string) {
  const now = Date.now();
  for (const [at, { at: since }] of kept) if (now - since > KEPT) kept.delete(at);
  const known = kept.get(folder);
  if (known) return known.listed;
  const listed = tracked(folder).then(files => files ?? walked(folder));
  kept.set(folder, { at: now, listed });
  return listed;
}

/** What git lists in `folder`, tracked or not ignored, with the folders they are in; `undefined` outside a repository, or
 * with no git. */
function tracked(folder: string) {
  return new Promise<Mention[] | undefined>(done => {
    const found = new Map<string, boolean>();
    const git = spawn('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: folder, stdio: ['ignore', 'pipe', 'ignore'], timeout: TIME });
    let rest = '';
    git.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const files = (rest + chunk).split('\0');
      rest = files.pop() ?? '';
      for (const file of files) {
        const parts = file.split('/');
        for (let k = 1; k < parts.length; k++) found.set(parts.slice(0, k).join('/'), true);
        found.set(file, false);
        if (found.size >= CAP) { git.kill(); break; }
      }
    });
    git.on('error', () => done(undefined));
    // Cut short by the cap or the time, it is what was found by then.
    git.on('close', code => done(code === 0 || found.size ? [...found].slice(0, CAP).map(([path, dir]) => ({ path, dir })) : undefined));
  });
}

/** The files and folders under `folder`, a level at a time, to the cap or the time. */
async function walked(folder: string) {
  const found: Mention[] = [], until = Date.now() + TIME, folders = [''];
  for (let k = 0; k < folders.length && found.length < CAP && Date.now() < until; k++) {
    // A folder is read an entry at a time, so one of millions is not read whole: the cap and the time hold within it too.
    try {
      for await (const entry of await opendir(join(folder, folders[k]))) {
        if (found.length >= CAP || Date.now() >= until) break;
        const dir = entry.isDirectory(), path = folders[k] ? `${folders[k]}/${entry.name}` : entry.name;
        if (dir && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue;
        found.push({ path, dir });
        if (dir) folders.push(path);
      }
    } catch { /* A folder that cannot be read lists nothing. */ }
  }
  return found;
}
