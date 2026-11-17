import { readFileSync, statSync } from 'node:fs';
import { attachAgent, profileOwner, readRuns, resumeCutOff, type AttachedAgent, type RunInfo } from 'pi-optchat/files';
import { working } from '../agent.ts';
import type { Agent, Params, Result } from '../protocol.ts';
import { profileDirectory } from './profiles.ts';

type Message = Record<string, unknown>;
const SHOWN = 30, KEPT = 20;
const isObject = (value: unknown): value is Message => typeof value === 'object' && value !== null;
/** The tool calls of an agent's last reply that have no result yet. */
function pending(messages: Message[]): Agent['doing'] {
  const at = messages.findLastIndex(message => message.role === 'assistant'), content = messages[at]?.content;
  const done = new Set(messages.slice(at + 1).map(message => message.toolCallId));
  return (Array.isArray(content) ? content : []).flatMap(block => isObject(block) && block.type === 'toolCall' && !done.has(block.id)
    ? [{ name: String(block.name), args: isObject(block.arguments) ? block.arguments : {} }] : []);
}

/** A profile's subagents, as pi-optchat keeps them on disk: a record of each (`readRuns`), and each one's chat in a Pi session
 * file, which Pi appends to as every message ends. Nothing is asked of a Pi and nothing is written, so an agent can be followed
 * from here while it works: by message, not by word. */
export class Agents {
  /** Session files as last read, the latest few: one is read again only when it has grown. */
  private readonly read = new Map<string, { print: string; messages: Message[] }>();
  private readonly home: string;
  constructor(home: string) { this.home = home; }

  /** An agent's chat: what its session file has of the conversation, with its task alone as the first message (it was sent
   * under a view of the profile's memory, which is the main chat's and long) and images named but not carried. */
  private chat({ sessionFile: file, task }: RunInfo): Message[] {
    if (!file) return [];
    let print: string, text: string;
    // A session file can go at any moment (a run deleted in a terminal): then there is no chat, as when it never was.
    try {
      const { size, mtimeMs } = statSync(file), read = this.read.get(file);
      print = `${size}|${mtimeMs}`;
      if (read?.print === print) return read.messages;
      text = readFileSync(file, 'utf8');
    } catch { return []; }
    // A line Pi is still writing does not parse yet: it is read the next time.
    const entries = text.split('\n').flatMap((line): unknown[] => { try { return [JSON.parse(line)]; } catch { return []; } });
    const messages = entries.flatMap(entry => isObject(entry) && entry.type === 'message' && isObject(entry.message) && entry.message.role !== 'system' ? [entry.message] : [])
      .map((message, at) => at === 0 && message.role === 'user' ? { ...message, content: task }
        : Array.isArray(message.content) ? { ...message, content: message.content.map(part => isObject(part) && part.type === 'image' ? { type: 'image' } : part) } : message);
    this.read.delete(file);
    this.read.set(file, { print, messages });
    for (const oldest of this.read.keys()) { if (this.read.size <= KEPT) break; this.read.delete(oldest); }
    return messages;
  }
  /** The profile's agents: connected windows are runs to pi-optchat too, and are windows here. */
  private runs(profile: string) { return readRuns(profileDirectory(this.home, profile)).filter(run => !run.connected); }
  /** Whether a Pi has the profile open, the app's or one in a terminal. A holder that does not answer is there all the same. */
  private owned(profile: string) { return profileOwner(profileDirectory(this.home, profile)).then(owner => owner !== undefined, () => true); }
  /** How many of the profile's agents are running, by their records alone: no chat is read, so it can be asked often. */
  async running(profile: string) {
    const count = this.runs(profile).filter(run => run.state === 'running').length;
    return count > 0 && await this.owned(profile) ? count : 0;
  }

  async list({ profile, limit = SHOWN }: Params<'agents'>): Promise<Result<'agents'>> {
    const runs = this.runs(profile).sort((a, b) => b.started - a.started);
    // A run saved as working is at work only if a Pi has the profile open, the app's or one in a terminal: a Pi that died
    // corrects its runs' records only when the profile is next opened.
    const owned = !runs.some(working) || await this.owned(profile);
    const agents = runs.map((run): Agent => {
      const { id, title, task, model, started, ended, parentId, report } = run, state = working(run) && !owned ? 'interrupted' : run.state;
      const headline = report?.split('\n').find(line => line.trim())?.trim().slice(0, 200);
      return { id, ...title && { title }, task, model, state, started, ...ended !== undefined && { ended }, ...parentId && { parent: parentId },
        doing: working({ state }) ? pending(this.chat(run)) : [], ...headline && { headline } };
    });
    const ended = agents.filter(agent => !working(agent));
    return { agents: [...agents.filter(working), ...ended.slice(0, limit)], more: Math.max(0, ended.length - limit) };
  }
  one({ profile, id, after = 0 }: Params<'agent'>): Result<'agent'> {
    // A report in the chat outlives its agent's record, and a click on it asks for that agent: it has no chat, which is no error.
    const run = this.runs(profile).find(run => run.id === id), messages = run ? this.chat(run) : [];
    // What you told it and it has not read: pi-optchat keeps that in the record, and the chat has it once it is read.
    const queued = run?.guidance.flatMap(({ state, from, text }) => state === 'queued' && from === 'user' ? [text] : []) ?? [];
    return { total: messages.length, messages: messages.slice(after), ...run?.report !== undefined && { report: run.report }, ...run?.ended !== undefined && { ended: run.ended }, ...queued.length && { queued } };
  }

  /** The main chat's own agents that their Pi's close or crash cut off: pi-optchat marks them `cutOff`, but only once the
   * profile is opened again, so before that they are the ones saved as running or waiting, in a profile no Pi has open. Paused
   * and stopping ones were not working, and pi-optchat does not resume them. The agents of a cut-off agent go on through it. */
  async cutOff(profile: string): Promise<Result<'cutOff'>['profiles'][number]['agents']> {
    const own = this.runs(profile).filter(run => run.parentId === undefined), left = (run: RunInfo) => run.state === 'running' || run.state === 'waiting';
    const owned = !own.some(left) || await this.owned(profile);
    return own.filter(run => run.cutOff || !owned && left(run)).map(({ id, started }) => ({ id, started }));
  }
  /** Has the Pi that has the profile open resume its cut-off agents. */
  async resume(profile: string) { await resumeCutOff(profileDirectory(this.home, profile)); }

  /** One of the profile's agents, in the Pi that has the profile open: only that Pi reaches its agents, and pi-optchat's
   * `attachAgent` asks it. The app's own Pi or one in a terminal alike, and nothing is kept open: an agent is read from its files. */
  private async reach<T>({ profile, id }: Params<'stopAgent'>, act: (agent: AttachedAgent) => Promise<T>) {
    const agent = await attachAgent(profileDirectory(this.home, profile), id, () => {});
    try { return await act(agent); } finally { agent.close(); }
  }
  /** Your message to an agent. One at work is told (`say`), which pi-optchat does not wake an ended one with; an ended one is
   * resumed with it (`resume`), which pi-optchat refuses for one at work. Which it is, is read from pi-optchat's record of the
   * agent as it is now. Should the agent end or go on in the moment between, pi-optchat refuses and says so. */
  async tell({ text, ...agent }: Params<'tellAgent'>): Promise<Result<'tellAgent'>> {
    const run = this.runs(agent.profile).find(run => run.id === agent.id), resumed = run !== undefined && !working(run);
    await this.reach(agent, reached => resumed ? reached.resume(text) : reached.say(text));
    return { resumed };
  }
  async interrupt(agent: Params<'interruptAgent'>): Promise<Result<'interruptAgent'>> { await this.reach(agent, reached => reached.interrupt()); return {}; }
  async stop(agent: Params<'stopAgent'>): Promise<Result<'stopAgent'>> { await this.reach(agent, reached => reached.stop()); return {}; }
}
