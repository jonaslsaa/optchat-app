import { basename } from 'node:path';
import type { Part } from 'pi-optchat/core';
import { existsSync } from 'node:fs';
import { createProfile, defaults, fingerprint, listProfiles, loadConfig, memoryDirectory, profilePath, readImage, readInstructions, readMemory, saveInstructions, SETTINGS, updateConfig, type Memory } from 'pi-optchat/files';
import type { Line, Params, Result } from '../protocol.ts';

const PAGE = 50;
/** How many messages a search answers at a time, which is the agent's own page (pi-optchat's `SEARCH_PAGE`). */
const FOUND = 20;
/** How much of a found message is shown, in characters: this much before the match and after it. */
const LEAD = 40, REST = 160;
/** The directory of a profile that exists: pi-optchat reads a missing one as an empty memory. */
export function profileDirectory(home: string, name: string) {
  const directory = profilePath(name, home);
  if (!existsSync(directory)) throw new Error(`No profile named ${name}.`);
  return directory;
}
/** A line of the tree. Imported history is not always in date order, so a line is dated by its earliest and latest message. */
function line(memory: Memory, { l, i }: Part): Line {
  const id = i * 2 ** l, n = 2 ** l;
  let first = id, last = id, low = Date.parse(memory.root[id].date), high = low;
  for (let at = id + 1; at < id + n; at++) {
    const time = Date.parse(memory.root[at].date);
    if (time < low) { first = at; low = time; } else if (time > high) { last = at; high = time; }
  }
  return { id, n, text: memory.summary({ l, i }), from: memory.root[first].date, to: memory.root[last].date };
}

/** The tool call and its result that message `id` is one of, if it is: found by pi-optchat's own rule (its `callOf`). A
 * message's calls, which stand among its text under its date, are followed by their results in the same order, and a result
 * starts with its call's tool name. One that does not (an `Agent error`) has no call. */
export function pair(memory: Memory, id: number): [call: number, result: number] | undefined {
  const { root } = memory, kind = (at: number) => root[at]?.kind;
  const calling = (at: number, date: string) => (kind(at) === 'tool' || kind(at) === 'talk') && root[at].date === date;
  if (kind(id) !== 'tool' && kind(id) !== 'echo') return;
  // Where the results begin: the run `id` is in, or what follows its message.
  let results = id;
  if (kind(id) === 'echo') while (kind(results - 1) === 'echo') results--;
  else while (calling(results, root[id].date)) results++;
  const calls: number[] = [];
  for (let at = results - 1; at >= 0 && calling(at, root[results - 1].date); at--) if (kind(at) === 'tool') calls.unshift(at);
  const nth = kind(id) === 'echo' ? id - results : calls.indexOf(id), call = calls[nth], result = results + nth;
  for (let at = results; at <= result; at++) if (kind(at) !== 'echo') return;
  return call !== undefined && memory.text(result).startsWith(`${memory.text(call).split(' ', 1)[0]}:`) ? [call, result] : undefined;
}

/** Profiles as they are on disk, read through `pi-optchat/files`, which is all the app knows of pi-optchat's files. No Pi process
 * is needed to read one, and one that is running is not disturbed: it stays the only writer of its memory, and the app
 * summarizes nothing, so a node Pi has not built yet stays unbuilt. A profile's settings and instructions are changed here,
 * by pi-optchat's own functions and under its rules. */
export class Profiles {
  private readonly read = new Map<string, { print: string; memory: Promise<Memory> }>();
  readonly home: string;
  constructor(home: string) { this.home = home; }

  list(): Result<'profiles'> { return { profiles: listProfiles(this.home).map(name => ({ name })) }; }
  /** A new, empty profile, made by pi-optchat's own hand: its name is pi-optchat's to judge, and its files pi-optchat's to write. */
  create({ name }: Params<'createProfile'>): Result<'createProfile'> { createProfile(name, this.home); return {}; }
  /** A profile's settings as pi-optchat describes them and as the profile has them. Every setting pi-optchat has is here, so
   * one it gains is in the app with nothing more than a newer pi-optchat. */
  config({ profile }: Params<'config'>): Result<'config'> {
    const directory = profileDirectory(this.home, profile), config = loadConfig(directory);
    const settings = (Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]).map(key => ({ key, ...SETTINGS[key], value: config[key] }));
    return { settings, compactor: config.compactor, standard: defaults.compactor, subagent: config.subagent, instructions: readInstructions(directory) };
  }
  /** Changes one thing of them. pi-optchat checks what the page sent (its `checkPatch`) and refuses in its own words; the Pi
   * that has the profile open applies the change at once, and with none pi-optchat writes the file under the profile's lock.
   * A Pi whose pi-optchat is from before 0.11.12 does not know the request and hangs up on it, which pi-optchat can only call
   * a lost connection: what to do about it is said with it. */
  async configure({ profile, key, value }: Params<'configure'>): Promise<Result<'configure'>> {
    await updateConfig(profileDirectory(this.home, profile), { [key]: value }).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'Connection to the original Pi window was lost') throw new Error(`${error.message}. If the Pi that has this profile open runs a pi-optchat older than 0.11.12, update it there (pi update npm:pi-optchat) and start that Pi again.`, { cause: error });
      throw error;
    });
    return this.config({ profile });
  }
  /** Keeps the profile's instructions, as pi-optchat writes them: whole, beside the old file and then in its place. */
  instruct({ profile, text }: Params<'instruct'>): Result<'instruct'> { saveInstructions(profileDirectory(this.home, profile), text); return {}; }
  /** Where the profile's memory is now. */
  private directory(profile: string) { return memoryDirectory(profileDirectory(this.home, profile)); }
  /** The profile's memory as its files are now: read again only when they changed. */
  memory(profile: string, directory = this.directory(profile)) {
    // An import moves the profile's memory to another directory, which is a change too.
    const print = `${directory}|${fingerprint(directory)}`, read = this.read.get(profile);
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
    // Which memory it is: an import moves the profile to another directory, and a log that begins otherwise is another log.
    // The directory is looked up once, so that the name is of the memory that was read.
    const directory = this.directory(profile), memory = await this.memory(profile, directory), { root } = memory;
    const name = `${basename(directory)} ${root[0]?.date ?? ''}`;
    return { memory: name, total: root.length, lines: memory.view.map(part => line(memory, part)), size: memory.size, budget: memory.budget };
  }
  async zoom({ profile, id, n }: Params<'zoom'>): Promise<Result<'zoom'>> {
    const memory = await this.memory(profile);
    memory.zoom(id, n); // Refuses a line the tree does not have, in pi-optchat's own words.
    const l = Math.log2(n) - 1, i = 2 * id / n;
    return { lines: [{ l, i }, { l, i: i + 1 }].map(part => line(memory, part)) };
  }
  /** Message `id` as it was said. A call and its result are one row of the chat, so either is answered as both. */
  async original({ profile, id }: Params<'original'>): Promise<Result<'original'>> {
    const memory = await this.memory(profile), { root } = memory;
    if (!root[id]) throw new Error(`No message ${id}: the log has ${root.length}.`);
    return { messages: (pair(memory, id) ?? [id]).map(at => ({ ...root[at], text: memory.text(at) })) };
  }
  /** The messages that say `text`, found by pi-optchat's own `search`, a page at a time, each with the stretch around where it
   * first says it. Lower case is as long as the text it is of for all but a few letters (İ): with one of those before the
   * match the place is only near, so nothing is marked. */
  async search({ profile, text, before }: Params<'search'>): Promise<Result<'search'>> {
    const memory = await this.memory(profile), found = memory.search(text, before), needle = text.toLowerCase();
    // Half of a character that is two units long is not shown.
    const whole = (cut: string) => cut.replace(/^[\udc00-\udfff]|[\ud800-\udbff]$/g, '');
    const hits = found.slice(0, FOUND).map(({ i, kind, date, origin }) => {
      const said = memory.text(i), lower = said.toLowerCase(), at = lower.indexOf(needle), exact = lower.length === said.length;
      const from = Math.max(0, at - LEAD), to = exact ? at + needle.length : at, end = Math.min(said.length, to + REST);
      return { id: i, kind, date, ...origin && { imported: true }, lead: `${from ? '…' : ''}${whole(said.slice(from, at))}`, match: said.slice(at, to), rest: `${whole(said.slice(to, end))}${end < said.length ? '…' : ''}` };
    });
    return { hits, more: found.length - hits.length };
  }
  /** An image a message names as `[image <name>]`, straight from its file. */
  image(profile: string, name: string) { return readImage(this.directory(profile), name); }
}
