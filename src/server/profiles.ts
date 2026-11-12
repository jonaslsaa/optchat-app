import type { Part } from 'pi-optchat/core';
import { existsSync } from 'node:fs';
import { fingerprint, listProfiles, memoryDirectory, profilePath, readImage, readMemory, type Memory } from 'pi-optchat/files';
import type { Line, Params, Result } from '../protocol.ts';

const PAGE = 50;
/** The directory of a profile that exists: pi-optchat reads a missing one as an empty memory. */
export function profileDirectory(home: string, name: string) {
  const directory = profilePath(name, home);
  if (!existsSync(directory)) throw new Error(`No profile named ${name}.`);
  return directory;
}
const line = (memory: Memory, { l, i }: Part): Line => ({ id: i * 2 ** l, n: 2 ** l, text: memory.summary({ l, i }) });

/** Profiles as they are on disk, read through `pi-optchat/files`, which is all the app knows of pi-optchat's files. No Pi process
 * is needed to read one, and one that is running is not disturbed: it stays the only writer, and the app summarizes nothing, so
 * a node Pi has not built yet stays unbuilt. */
export class Profiles {
  private readonly read = new Map<string, { print: string; memory: Promise<Memory> }>();
  readonly home: string;
  constructor(home: string) { this.home = home; }

  list(): Result<'profiles'> { return { profiles: listProfiles(this.home).map(name => ({ name })) }; }
  /** The profile's memory as its files are now: read again only when they changed. */
  private memory(profile: string) {
    // An import moves the profile's memory to another directory, which is a change too.
    const directory = memoryDirectory(profileDirectory(this.home, profile)), print = `${directory}|${fingerprint(directory)}`, read = this.read.get(profile);
    if (read?.print === print) return read.memory;
    const memory = readMemory(directory);
    this.read.set(profile, { print, memory });
    // A log caught mid-write, as Pi's own loading would refuse: the next request reads again, unless a newer read is kept by then.
    memory.catch(() => { if (this.read.get(profile)?.memory === memory) this.read.delete(profile); });
    return memory;
  }
  async history({ profile, before, limit = PAGE }: Params<'history'>): Promise<Result<'history'>> {
    const memory = await this.memory(profile), total = memory.root.length, end = Math.min(before ?? total, total);
    return { total, messages: memory.root.slice(Math.max(0, end - limit), end).map(message => ({ ...message, text: memory.text(message.i) })) };
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
  /** An image a message names as `[image <name>]`, straight from its file. */
  image(profile: string, name: string) { return readImage(memoryDirectory(profileDirectory(this.home, profile)), name); }
}
