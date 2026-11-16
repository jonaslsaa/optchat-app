import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { working } from '../agent.ts';
import type { Agent } from '../protocol.ts';
import { atWork, controls, doing, listed, named, polled, stood, transcript } from './agents.ts';
import { Queued, SendButton } from './Composer.tsx';
import { Mark, Took, TONES } from './Rows.tsx';
import { escapes } from './keys.ts';
import { app, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { idle } from './transcript.ts';
import { Button, cn, More, Section, StatusDot } from './ui.tsx';

/** `SHOWN` is how many agents that ended are listed until more are asked for: few, because the GitHub list is under them. */
const NOTHING = idle(), SHOWN = 8, EVERY = 2000;
/** An agent in the list: what it is called, how long it has worked, and under that what it is doing now or how it ended.
 * `back`: its chat was open until now, so the focus comes back to it. */
function Row({ agent, depth, back, onOpen }: { agent: Agent; depth: number; back: boolean; onOpen: () => void }) {
  return (
    <li style={{ paddingInlineStart: `${Math.min(depth, 4) * 0.875}rem` }}>
      <button type="button" autoFocus={back} onClick={onOpen} className="flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/70">
        <span className="flex min-w-0 items-center gap-2">
          <Mark agent={agent} />
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{named(agent)}</span>
          <span className="shrink-0 text-2xs text-muted-foreground tabular-nums"><Took agent={agent} /></span>
        </span>
        <span className={cn('truncate ps-5.5 text-muted-foreground text-xs', agent.state === 'failed' && 'text-destructive-foreground')}>{doing(agent)}</span>
      </button>
    </li>
  );
}

/** What stands at the top of the panel while an agent's chat is open in it: the way back to the list, and what it is called.
 * The row that was opened is gone, and the focus it had is on the way back. */
export function AgentHead({ state, profile, id, onAgent }: { state: State; profile: string; id: string; onAgent: (id?: string) => void }) {
  const agent = state.agents[profile]?.agents.find(agent => agent.id === id);
  return (
    <>
      <Button autoFocus variant="ghost-muted" size="icon-sm" aria-label="Back to the lists" title="Back (Esc)" onClick={() => onAgent()}><ArrowLeftIcon /></Button>
      <h2 title={id} className="min-w-0 flex-1 truncate font-medium text-sm">{agent ? named(agent) : `Agent ${id}`}</h2>
    </>
  );
}
/** What you were typing to each agent, and why pi-optchat refused the last thing you asked of it, kept while you look at
 * another: an answer can come after you have left. A refusal is about the agent as it stood (`state`), and is said no longer
 * than it stands so. */
const drafts = new Map<string, string>(), refusals = new Map<string, { why: string; state: Agent['state'] }>();
/** Under an agent's chat: how it stands, and what you can do to it from here, which is only what its state allows (`controls`).
 * A message reaches an agent at work and starts one that has ended again: the server picks, so there is one box and one
 * button. Interrupt and Stop are there while they would do something. What pi-optchat refuses is said here in its words.
 * A message stays in the box until it is taken, so one that is refused is still where it was typed.
 * Esc in here is this agent's while it can be interrupted, as in Pi's view of an agent: the panel, whose Esc is the way
 * back to the lists, does not hear it then. `owner`: the agent that started this one, where only that one can resume it.
 * `onDone`: something was asked, so the agent is worth reading again. */
function Control({ profile, agent, owner, queued = [], onDone }: { profile: string; agent: Agent; owner?: Agent; queued?: readonly string[]; onDone: () => Promise<unknown> }) {
  const key = `${profile}/${agent.id}`, can = controls(agent), { word, tone } = stood(agent);
  const [text, setText] = useState(drafts.get(key) ?? ''), [asking, setAsking] = useState(false);
  const refusal = refusals.get(key), refused = refusal?.state === agent.state ? refusal.why : undefined;
  const stands = useRef(agent.state);
  useEffect(() => { stands.current = agent.state; });
  const change = (value: string) => { drafts.set(key, value); setText(value); };
  const ask = async (...asked: Parameters<typeof app.act>) => {
    setAsking(true);
    const why = await app.act(...asked);
    // It is read again first: a refusal is often that the agent had just ended, and it is kept for how it stands by now.
    await onDone();
    if (why === undefined) refusals.delete(key); else refusals.set(key, { why, state: stands.current });
    setAsking(false);
    return why === undefined;
  };
  const send = async () => {
    const message = text.trim();
    if (message && !asking && await ask('tellAgent', { profile, id: agent.id, text: message })) change('');
  };
  const interrupt = () => { if (can.interrupt && !asking) void ask('interruptAgent', { profile, id: agent.id }); };
  return (
    <div className="flex shrink-0 flex-col gap-2 border-border/70 border-t px-3 pt-2.5 pb-3" onKeyDown={event => { if (can.interrupt) escapes(event, interrupt); }}>
      <Queued messages={queued} />
      {refused && <p role="alert" className="whitespace-pre-wrap rounded-xl border border-error/24 bg-error-surface px-3 py-2 text-foreground/80 text-xs [overflow-wrap:anywhere]">{refused}</p>}
      {can.message && (
        <div className="relative isolate flex items-end gap-2 rounded-2xl bg-card py-1.5 ps-3.5 pe-1.5 shadow-composer after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-black/8 dark:bg-(--surface-raised) dark:shadow-none dark:after:border-white/8">
          <textarea value={text} rows={1} readOnly={asking} aria-label="Tell the agent" placeholder={can.message === 'ended' ? 'A message starts this agent again' : agent.state === 'paused' ? 'Tell it how to go on' : 'Tell this agent'}
            onChange={event => change(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
            className="field-sizing-content block max-h-40 min-h-[1lh] w-full resize-none self-center overflow-y-auto bg-transparent text-foreground text-sm leading-relaxed placeholder:text-placeholder focus:outline-none" />
          <SendButton steer={can.message === 'work'} disabled={!text.trim() || asking} onClick={() => void send()} />
        </div>
      )}
      <div className="flex min-h-6 min-w-0 items-center gap-1 ps-1 text-muted-foreground text-xs">
        {/* How long it has worked is said in its chat while it works, and here once it has ended. */}
        <p className="min-w-0 flex-1 truncate tabular-nums"><span className={tone && TONES[tone]}>{word}</span>{!working(agent) && <> · <Took agent={agent} /></>} · {agent.model.split('/').at(-1)}</p>
        {can.interrupt && <Button variant="ghost-muted" size="xs" disabled={asking} title="Cut what it is doing now: it goes on with your messages, or waits for one (Esc)" onClick={interrupt}>Interrupt</Button>}
        {can.stop && <Button variant="ghost-muted" size="xs" disabled={asking} title="End it, and the agents it started. A message starts it again" onClick={() => void ask('stopAgent', { profile, id: agent.id })}>Stop</Button>}
      </div>
      {can.owner !== undefined && <p className="ps-1 text-muted-foreground text-xs [overflow-wrap:anywhere]">{owner ? `"${named(owner)}" started this agent, so only it can resume it.` : 'Another agent started this one, so only that agent can resume it.'}</p>}
    </div>
  );
}
/** The agents working for the profile's main chat, read from its files: a list of them (nothing, where there are none), and
 * the chat of the one that is opened in its place.
 * It is read again when the main chat changes (`pulse`: that is when an agent starts or reports), and every two
 * seconds while one of them works, or while a Pi outside the app has the chat (`outside`), which tells the app nothing of what
 * it starts. Under an agent's chat is where you tell it, interrupt it and stop it (`Control`). */
export function Agents({ state, profile, agent: id, pulse, outside, onAgent }: { state: State; profile: string; agent?: string; pulse: string; outside: boolean; onAgent: (id?: string) => void }) {
  const [limit, setLimit] = useState(SHOWN);
  const list = state.agents[profile], agents = list?.agents ?? [], active = polled(agents, outside);
  const agent = agents.find(agent => agent.id === id), chat = id === undefined ? undefined : state.chats[`${profile}/${id}`];
  const items = useMemo(() => chat ? transcript(chat, !agent || !working(agent)) : [], [chat, agent?.state]);
  const read = () => Promise.all([app.readAgents(profile, limit), id !== undefined && app.readAgent(profile, id)]);
  // Again once the server is back, too: what was asked while it was away got no answer.
  useEffect(() => { if (state.connection === 'open') void read(); }, [profile, id, limit, pulse, state.connection]);
  useEffect(() => { if (!active) return; const timer = setInterval(read, EVERY); return () => clearInterval(timer); }, [active, profile, id, limit]);
  const running = agents.filter(working).length;
  // The agent whose chat was open until now, for the focus on the way back: once, as the list is drawn again.
  const opened = useRef(id);
  useEffect(() => { opened.current = id; }, [id]);
  if (id === undefined) return agents.length === 0 ? null : (
    <Section title={running ? `Agents · ${running} running` : 'Agents'}>
      <ul className="flex flex-col gap-0.5">{listed(agents).map(({ agent, depth }) => <Row key={agent.id} agent={agent} depth={depth} back={agent.id === opened.current} onOpen={() => onAgent(agent.id)} />)}</ul>
      {list && list.more > 0 && <More more={list.more} step={SHOWN} onMore={() => setLimit(limit + SHOWN)} />}
    </Section>
  );
  return (
    <>
      {items.length > 0 ? <Timeline key={id} narrow items={items} agents={agents} live={NOTHING} running={agent !== undefined && working(agent) && agent.state !== 'paused'} profile={profile} onAgent={onAgent} />
        : <p className="flex-1 px-6 pt-16 text-center text-muted-foreground text-sm">{!chat ? '' : agent && working(agent) ? 'It has not said anything yet.' : 'There is no chat to show for this agent.'}</p>}
      {agent ? <Control key={id} profile={profile} agent={agent} owner={agents.find(other => other.id === agent.parent)} queued={chat?.queued} onDone={read} />
        : <p className="shrink-0 truncate border-border/70 border-t px-4 py-2.5 text-center text-muted-foreground text-xs">An agent of the main chat</p>}
    </>
  );
}
/** The main chat's agents while the panel is closed: read when the chat changes (`pulse`), as the open panel reads them, and
 * every two seconds while the status line counts agents at work (`busy`), for the lines under the calls that started them and
 * the line over the composer. Then the panel is the one that reads them. */
export function useAgents(profile: string, { closed, pulse, busy, connected }: { closed: boolean; pulse: string; busy: boolean; connected: boolean }) {
  useEffect(() => { if (closed && connected) void app.readAgents(profile, SHOWN); }, [profile, closed, pulse, connected]);
  useEffect(() => {
    if (!closed || !busy || !connected) return;
    const timer = setInterval(() => void app.readAgents(profile, SHOWN), EVERY);
    return () => clearInterval(timer);
  }, [profile, closed, busy, connected]);
}
/** Over the composer while the main chat's agents work and the panel is closed: how many, and each one's title and how long it
 * has worked, on one line, cut short where it is full. A click opens the panel's list. Quiet, as the line under the box is. */
export function AtWork({ agents, onOpen }: { agents: readonly Agent[]; onOpen: () => void }) {
  const shown = atWork(agents);
  if (!shown.length) return null;
  return (
    <div data-no-find className="shrink-0 px-3 sm:px-12">
      <button type="button" title="Open the agents" onClick={onOpen}
        className="enter mx-auto flex h-6 w-full min-w-0 max-w-(--chat-content-max-width) cursor-pointer items-center gap-2 rounded-md px-2 text-left text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70">
        <StatusDot tone="working" pulse />
        <span className="min-w-0 flex-1 truncate tabular-nums">
          <span className="text-secondary-label">{shown.length === 1 ? '1 agent working' : `${shown.length} agents working`}</span>
          {shown.map(agent => <span key={agent.id}> · {named(agent)} <Took agent={agent} /></span>)}
        </span>
      </button>
    </div>
  );
}
