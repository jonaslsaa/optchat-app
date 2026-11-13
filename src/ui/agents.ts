import { working } from '../agent.ts';
import type { Agent } from '../protocol.ts';
import { act, spoken, words, type Item, type PiMessage } from './transcript.ts';

/** What the agents panel shows of a profile's agents, worked out from what the server read of them. Nothing here touches the DOM. */

/** What an agent goes by: the title it was started under, or else the first line of its task. */
export const named = ({ title, task }: Pick<Agent, 'title' | 'task'>) => title ?? task.trim().split('\n')[0];
/** Whether agents are at work, for the dot on the agents' button. pi-optchat's status line counts them (`OptChat: work · 350
 * messages · 0 pending · 2 agents`), and its count is the word on it. Only where it has none (no Pi of the app's has the chat)
 * does the list say: `listed` is the list while the panel is open, which is the only time it is kept up. */
export function busy(status = '', listed?: readonly Agent[]): boolean {
  const count = / · (\d+) agents\b/.exec(status)?.[1];
  return count === undefined ? listed?.some(working) ?? false : count !== '0';
}
/** Whether the open panel has to look for itself every two seconds: while an agent works, and while a Pi outside the app has
 * the chat (`outside`), which tells the app nothing of the agents it starts. Otherwise the main chat's changes say when. */
export const polled = (agents: readonly Agent[], outside: boolean) => outside || agents.some(working);

/** The agents in the order of the list: those at work first, then the newest, and each agent's own agents right under it, one
 * step in (`depth`). One whose parent is not among them stands on its own. */
export function listed(agents: readonly Agent[]): { agent: Agent; depth: number }[] {
  const ids = new Set(agents.map(agent => agent.id)), sorted = agents.toSorted((a, b) => Number(working(b)) - Number(working(a)) || b.started - a.started);
  const under = (parent: string | undefined, depth: number): { agent: Agent; depth: number }[] =>
    sorted.filter(agent => (agent.parent !== undefined && ids.has(agent.parent) ? agent.parent : undefined) === parent).flatMap(agent => [{ agent, depth }, ...under(agent.id, depth + 1)]);
  return under(undefined, 0);
}
/** What an agent is doing now, or how it ended, in a line: the tool call it waits on, in the words of the chat's tool rows, or
 * what its state means, or the first line of what it reported. */
export function doing({ state, doing: [call, ...more], headline: said }: Agent): string {
  // A report is Markdown, and a line of the list is not: its marks are left out.
  const headline = said?.replace(/^#+ |\*\*|`/g, '');
  if (working({ state }) && call) {
    const { verb, subject } = act({ key: 0, type: 'tool', failed: false, ...call }, true);
    return `${verb} ${subject}${more.length ? ` and ${more.length} more` : ''}`;
  }
  switch (state) {
    case 'running': return 'Thinking';
    case 'waiting': return 'Waiting for its agents';
    case 'paused': return 'Paused';
    case 'stopping': return 'Stopping';
    case 'stopped': return 'Stopped';
    case 'interrupted': return 'Cut off when its Pi closed';
    case 'failed': return headline ?? 'Failed';
    case 'completed': return headline ?? 'Done';
  }
}
/** How an agent stands, in a word or a few, and whether that is said in colour: only at work, done and failed are. */
export function stood({ state }: Pick<Agent, 'state'>): { word: string; tone?: 'working' | 'done' | 'failed' } {
  if (working({ state })) return { word: state === 'running' ? 'Working' : state === 'waiting' ? 'Waiting for its agents' : state === 'paused' ? 'Paused' : 'Stopping', tone: 'working' };
  return { word: `${state[0].toUpperCase()}${state.slice(1)}`, ...state === 'completed' ? { tone: 'done' } : state === 'failed' && { tone: 'failed' } };
}
/** What you can do to an agent from its chat, by how it stands, so that nothing is offered that pi-optchat would refuse
 * outright. `message`: it takes one, which reaches it at `work` or starts it again once it has `ended` (the server picks
 * which; this only says what to expect). `interrupt` and `stop`: while there is a step to cut, and an agent to end. One that
 * is on its way out takes nothing. An agent that has ended is resumed by the agent that started it, and you speak for the
 * main agent alone: another agent's agent takes no message then, and `owner` is the agent whose it is to resume. */
export function controls({ state, parent }: Pick<Agent, 'state' | 'parent'>): { message?: 'work' | 'ended'; interrupt: boolean; stop: boolean; owner?: string } {
  if (state === 'stopping') return { interrupt: false, stop: false };
  if (working({ state })) return { message: 'work', interrupt: state !== 'paused', stop: true };
  return { interrupt: false, stop: false, ...parent === undefined ? { message: 'ended' } : { owner: parent } };
}
/** An agent's chat as the chat's items: its task, what it did, and its answer. What it reported is its last answer, unless it
 * ended without one (it failed, or was stopped): then the report says how, and is the last item, dated when the agent ended.
 * `over` says the agent is not at work: one that was told to go on still has the report of its last time. */
export function transcript({ messages, report, ended }: { messages: readonly PiMessage[]; report?: string; ended?: number }, over: boolean): Item[] {
  const items = spoken(messages), last = messages.at(-1);
  if (!over || !report || (last?.role === 'assistant' && words(last.content).trim() === report.trim())) return items;
  return [...items, { key: items.length, kind: 'work', text: report, date: new Date(ended ?? last?.timestamp ?? 0).toISOString() }];
}
