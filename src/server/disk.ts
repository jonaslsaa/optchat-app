import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Mime, Part, Saved, Store } from 'pi-optchat/core';

/** The one module that knows how pi-optchat lays a profile out on disk (its README's storage table). `pi-optchat/core` has the
 * memory but not Pi's file store, so the few read-only lines of it live here. Nothing in this file writes. */

export const defaultHome = () => resolve(process.env.OPTCHAT_HOME ?? join(homedir(), '.optchat'));
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EXTENSIONS: Record<string, Mime> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export function listProfiles(home: string) {
  const root = join(home, 'profiles');
  return existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter(f => f.isDirectory() && NAME.test(f.name)).map(f => f.name).sort() : [];
}
export function profileDirectory(home: string, name: string) {
  const directory = join(home, 'profiles', name);
  if (!NAME.test(name) || !existsSync(directory)) throw new Error(`No profile named ${name}.`);
  return directory;
}
/** After an import, `active-memory.json` points at the generation that holds `main/` and `tree/`. */
export function memoryDirectory(profile: string) {
  const pointer = join(profile, 'active-memory.json');
  if (!existsSync(pointer)) return profile;
  const name: unknown = JSON.parse(readFileSync(pointer, 'utf8'));
  if (name === '.') return profile;
  if (typeof name !== 'string' || !/^memories\/[a-f0-9-]{36}$/.test(name)) throw new Error('Invalid active memory pointer.');
  return join(profile, name);
}

/** An image of the memory in `directory`, which a message names as `[image <name>]`. */
export function readImage(directory: string, name: string) {
  if (!/^[0-9a-f]{16}$/.test(name)) return undefined;
  for (const [extension, mimeType] of Object.entries(EXTENSIONS)) {
    const file = join(directory, 'images', `${name}.${extension}`);
    if (existsSync(file)) return { mimeType, data: readFileSync(file) };
  }
}
const logs = (directory: string) => existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.jsonl')).sort() : [];
/** Changes whenever the memory's files do: the log and tree only grow, and the view is replaced. */
export function fingerprint(memory: string) {
  const sizes = ['main', 'tree'].flatMap(sub => logs(join(memory, sub)).map(name => `${sub}/${name}:${statSync(join(memory, sub, name)).size}`));
  const view = statSync(join(memory, 'view.json'), { throwIfNoEntry: false });
  return [memory, ...sizes, `view:${view?.size}:${view?.mtimeMs}`].join('|');
}
/** A line the owner is still writing is skipped, as is a damaged one: the next read has it whole. */
function records(directory: string) {
  return logs(directory).flatMap(name => readFileSync(join(directory, name), 'utf8').split('\n').flatMap((line): unknown[] => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  }));
}
/** The header pi-optchat's imports wrote into each message before 0.11.8, which its own store drops on load (its `LEGACY_HEADER`). */
const LEGACY_HEADER = /^\[Historical [a-z]+ · \d{4}-\d{2}-\d{2}(?:T[\d:.]+Z · conversation \S+| \d{2}:\d{2}Z · \S+) · [\s\S]*?\]\n/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A profile's memory files as a core `Store` that never writes: core's `Memory` reads the log, tree and view through it. */
export class ReadOnlyStore implements Store {
  private readonly texts: string[] = [];
  private readonly summaries = new Map<string, string>();
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  load(): Saved {
    // The owning Pi may be writing. Each file only refers to what was written before it (the view to nodes, nodes to messages),
    // so reading in this order never sees a reference to something not read yet.
    const file = join(this.directory, 'view.json'), view = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    const tree = records(join(this.directory, 'tree')), entries = records(join(this.directory, 'main'));
    for (const entry of entries) if (isRecord(entry) && typeof entry.i === 'number' && typeof entry.text === 'string')
      this.texts[entry.i] = entry.origin ? entry.text.replace(LEGACY_HEADER, '') : entry.text;
    for (const node of tree) if (isRecord(node) && typeof node.text === 'string') this.summaries.set(`${node.l}:${node.i}`, node.text);
    return { entries, tree, view };
  }
  text(i: number) { return this.texts[i]; }
  summary({ l, i }: Part) { return this.summaries.get(`${l}:${i}`)!; }
  append(): undefined {}
  appendNode(): undefined {}
  saveView(): undefined {}
  putImage(): undefined {}
  image(name: string) { return readImage(this.directory, name); }
}
