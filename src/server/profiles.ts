import { Memory, type Part } from 'pi-optchat/core';
import type { Line, Params, Result } from '../protocol.ts';
import { fingerprint, listProfiles, memoryDirectory, profileDirectory, readImage, ReadOnlyStore } from './disk.ts';

const PAGE = 50;
/** A profile's memory as it is on disk now, in pi-optchat's own `Memory` over a store that never writes. It is closed before
 * its first summary could be scheduled: the app summarizes nothing, so a node the owning Pi has not built yet stays unbuilt. */
function readMemory(directory: string) {
  const store = new ReadOnlyStore(directory);
  const memory = new Memory({ store, saved: store.load() }, () => Promise.reject(new Error('The app reads memory; only Pi writes it.')), () => {});
  void memory.close();
  return memory;
}
const line = (memory: Memory, { l, i }: Part): Line => ({ id: i * 2 ** l, n: 2 ** l, text: memory.summary({ l, i }) });

/** Profiles as they are on disk. No Pi process is needed to read one, and one that is running is not disturbed: it stays the
 * only writer. */
export class Profiles {
  private readonly read = new Map<string, { print: string; memory: Memory }>();
  readonly home: string;
  constructor(home: string) { this.home = home; }

  list(): Result<'profiles'> { return { profiles: listProfiles(this.home).map(name => ({ name })) }; }
  /** The profile's memory as its files are now: read again only when they changed. */
  private memory(profile: string) {
    const directory = memoryDirectory(profileDirectory(this.home, profile)), print = fingerprint(directory), read = this.read.get(profile);
    if (read?.print === print) return read.memory;
    const memory = readMemory(directory);
    this.read.set(profile, { print, memory });
    return memory;
  }
  history({ profile, before, limit = PAGE }: Params<'history'>): Result<'history'> {
    const memory = this.memory(profile), total = memory.root.length, end = Math.min(before ?? total, total);
    return { total, messages: memory.root.slice(Math.max(0, end - limit), end).map(message => ({ ...message, text: memory.text(message.i) })) };
  }
  view({ profile }: Params<'view'>): Result<'view'> {
    const memory = this.memory(profile);
    return { total: memory.root.length, lines: memory.view.map(part => line(memory, part)) };
  }
  zoom({ profile, id, n }: Params<'zoom'>): Result<'zoom'> {
    const memory = this.memory(profile);
    memory.zoom(id, n); // Refuses a line the tree does not have, in pi-optchat's own words.
    const l = Math.log2(n) - 1, i = 2 * id / n;
    return { lines: [{ l, i }, { l, i: i + 1 }].map(part => line(memory, part)) };
  }
  /** An image a message names as `[image <name>]`, straight from its file. */
  image(profile: string, name: string) { return readImage(memoryDirectory(profileDirectory(this.home, profile)), name); }
}
