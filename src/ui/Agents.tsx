import { ArrowLeftIcon, CheckIcon, CircleSlashIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { working } from '../agent.ts';
import type { Agent } from '../protocol.ts';
import { doing, listed, named, polled, transcript } from './agents.ts';
import { Timer } from './Rows.tsx';
import { app, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { idle, took } from './transcript.ts';
import { Button, cn, StatusDot } from './ui.tsx';

const NOTHING = idle(), SHOWN = 30, EVERY = 2000;
const iso = (time: number) => new Date(time).toISOString();
/** How long an agent has worked, counting while it does. */
const Took = ({ agent }: { agent: Agent }) => working(agent) ? <Timer from={iso(agent.started)} /> : agent.ended !== undefined ? <>{took(iso(agent.started), iso(agent.ended))}</> : null;

/** How an agent stands: a dot while it works, a mark for how it ended. */
function Mark({ agent }: { agent: Agent }) {
  if (working(agent)) return <StatusDot tone="working" pulse={agent.state !== 'paused'} />;
  const Icon = agent.state === 'completed' ? CheckIcon : agent.state === 'failed' ? XIcon : CircleSlashIcon;
  return <Icon role="img" aria-label={agent.state} className={cn('size-3.5 shrink-0 text-muted-foreground/70', agent.state === 'failed' && 'text-destructive-foreground')} />;
}
/** An agent in the list: what it is called, how long it has worked, and under that what it is doing now or how it ended. */
function Row({ agent, depth, onOpen }: { agent: Agent; depth: number; onOpen: () => void }) {
  return (
    <li style={{ paddingInlineStart: `${Math.min(depth, 4) * 0.875}rem` }}>
      <button type="button" onClick={onOpen} className="flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/70">
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

/** The agents working for the profile's main chat, read from its files: a list of them, and the chat of the one that is opened
 * in its place. It is read again when the main chat changes (`pulse`: that is when an agent starts or reports), and every two
 * seconds while one of them works, or while a Pi outside the app has the chat (`outside`), which tells the app nothing of what
 * it starts. It only shows: an agent is told, stopped and resumed by the main agent. */
export function AgentsPanel({ state, profile, agent: id, pulse, outside, onAgent, onClose }: { state: State; profile: string; agent?: string; pulse: string; outside: boolean; onAgent: (id?: string) => void; onClose: () => void }) {
  const [limit, setLimit] = useState(SHOWN);
  const list = state.agents[profile], agents = list?.agents ?? [], active = polled(agents, outside);
  const agent = agents.find(agent => agent.id === id), chat = id === undefined ? undefined : state.chats[`${profile}/${id}`];
  const items = useMemo(() => chat ? transcript(chat, !agent || !working(agent)) : [], [chat, agent?.state]);
  const read = () => { void app.readAgents(profile, limit); if (id !== undefined) void app.readAgent(profile, id); };
  // Again once the server is back, too: what was asked while it was away got no answer.
  useEffect(() => { if (state.connection === 'open') read(); }, [profile, id, limit, pulse, state.connection]);
  useEffect(() => { if (!active) return; const timer = setInterval(read, EVERY); return () => clearInterval(timer); }, [active, profile, id, limit]);
  return (
    <aside aria-label="Agents" className="flex h-full w-(--panel-width) max-w-[calc(100vw-2.5rem)] shrink-0 flex-col border-border border-l bg-background">
      <div className="flex h-(--topbar-height) shrink-0 items-center gap-1.5 ps-2.5 pe-2.5">
        {id === undefined ? <h2 className="min-w-0 flex-1 truncate ps-2 font-medium text-sm">Agents</h2> : (
          <>
            <Button variant="ghost-muted" size="icon-sm" aria-label="All agents" title="All agents" onClick={() => onAgent()}><ArrowLeftIcon /></Button>
            <h2 title={id} className="min-w-0 flex-1 truncate font-medium text-sm">{agent ? named(agent) : `Agent ${id}`}</h2>
          </>
        )}
        <Button variant="ghost-muted" size="icon-sm" aria-label="Close the agents" title="Close" onClick={onClose}><XIcon /></Button>
      </div>
      {id === undefined ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {list && agents.length === 0 && (
            <div className="px-4 pt-16 text-center text-sm"><p className="font-medium">No agents yet</p><p className="mt-1 text-balance text-muted-foreground">The main chat starts agents for work it hands out. They are listed here while they work, and after.</p></div>
          )}
          <ul className="flex flex-col gap-0.5">{listed(agents).map(({ agent, depth }) => <Row key={agent.id} agent={agent} depth={depth} onOpen={() => onAgent(agent.id)} />)}</ul>
          {list && list.more > 0 && <Button variant="ghost-muted" size="xs" className="mx-2.5 mt-2" onClick={() => setLimit(limit + SHOWN)}>Show {Math.min(list.more, SHOWN)} more</Button>}
        </div>
      ) : (
        <>
          {items.length > 0 ? <Timeline key={id} narrow items={items} live={NOTHING} running={agent !== undefined && working(agent)} profile={profile} onAgent={onAgent} />
            : <p className="flex-1 px-6 pt-16 text-center text-muted-foreground text-sm">{!chat ? '' : agent && working(agent) ? 'It has not said anything yet.' : 'There is no chat to show for this agent.'}</p>}
          {/* Where a chat has its composer, as T3 Code says of a subagent's thread: an agent is not written to from here. */}
          <p className="shrink-0 truncate border-border/70 border-t px-4 py-2.5 text-center text-muted-foreground text-xs tabular-nums">
            {!agent ? 'An agent of the main chat' : <>{working(agent) ? 'Runs on its own' : <><span className="capitalize">{agent.state}</span> · <Took agent={agent} /></>} · {agent.model.split('/').at(-1)}</>}
          </p>
        </>
      )}
    </aside>
  );
}
