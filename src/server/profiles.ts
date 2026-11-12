import { openMemory, type Compressor, type Memory, type Part } from 'pi-optchat/core';
import type { Line, Params, Result } from '../protocol.ts';
import { fingerprint, listProfiles, memoryDirectory, profileDirectory, ReadOnlyStore } from './disk.ts';

/** The app never summarizes: a node the owning Pi has not built yet stays unbuilt here, and shows as a line without text. */
const never: Compressor = (_input, signal) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(new Error('Memory closed.')), { once: true });
});
const PAGE = 50;

/** Profiles as they are on disk, read through pi-optchat's own `Memory` over a store that never writes. No Pi process is needed,
 * and one that is running is not disturbed: it stays the only writer. */
export class Profiles {
  private readonly opened = new Map<string, { print: string; memory: Promise<Memory> }>();
  readonly home: string;
  constructor(home: string) { this.home = home; }

  list(): Result<'profiles'> { return { profiles: listProfiles(this.home).map(name => ({ name })) }; }
  /** The profile's memory as its files are now: read again only when they changed. */
  private memory(profile: string) {
    const directory = memoryDirectory(profileDirectory(this.home, profile)), print = fingerprint(directory), opened = this.opened.get(profile);
    if (opened?.print === print) return opened.memory;
    void opened?.memory.then(memory => memory.close(), () => {});
    const memory = openMemory(new ReadOnlyStore(directory), never, { warn: () => {}, jobs: 1 });
    this.opened.set(profile, { print, memory });
    return memory;
  }
  async history({ profile, before, limit = PAGE }: Params<'history'>): Promise<Result<'history'>> {
    const memory = await this.memory(profile), total = memory.root.length, end = Math.min(before ?? total, total);
    const messages = memory.root.slice(Math.max(0, end - limit), end).map(({ i, kind, date, origin }) => ({ i, kind, date, text: memory.text(i), ...origin && { origin } }));
    return { total, messages };
  }
  async view({ profile }: Params<'view'>): Promise<Result<'view'>> {
    const memory = await this.memory(profile);
    return { total: memory.root.length, lines: memory.view.map(part => line(memory, part)) };
  }
  async zoom({ profile, id, n }: Params<'zoom'>): Promise<Result<'zoom'>> {
    const memory = await this.memory(profile);
    memory.zoom(id, n); // Refuses a line the tree does not have, in pi-optchat's own words.
    const l = Math.log2(n) - 1, i = 2 * id / n;
    return { lines: [{ l, i }, { l, i: i + 1 }].map(part => line(memory, part)) };
  }
  /** An image a message names as `[image <name>]`. */
  async image(profile: string, name: string) { return (await this.memory(profile)).store.image(name); }
  async close() {
    for (const { memory } of this.opened.values()) await memory.then(m => m.close(), () => {});
    this.opened.clear();
  }
}
const line = (memory: Memory, { l, i }: Part): Line => ({ id: i * 2 ** l, n: 2 ** l, text: memory.summary({ l, i }) });
