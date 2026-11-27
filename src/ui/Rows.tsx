import { BotIcon, CheckIcon, ChevronRightIcon, CircleSlashIcon, EyeIcon, GlobeIcon, HistoryIcon, MessagesSquareIcon, SearchIcon, SquarePenIcon, StickyNoteIcon, TerminalIcon, WrenchIcon, XIcon, type LucideIcon } from 'lucide-react';
import { createContext, memo, useContext, useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { working as agentWorks } from '../agent.ts';
import type { Agent, WindowState } from '../protocol.ts';
import { among, doing, named, stood } from './agents.ts';
import { CiteButton, CiteGroup, SkillChip, type CiteMessage } from './Cite.tsx';
import { asTyped, type Place } from './cite.ts';
import { Markdown } from './Markdown.tsx';
import { act, started, thoughtLine, took, worked, type Part, type Step, type Thinking, type Tool } from './transcript.ts';
import { Button, cn, CopyButton, Spinner, StatusDot } from './ui.tsx';
import { Picture } from './Picture.tsx';
import { called } from './store.ts';
import { WorkLogDetails, WorkLogRow } from './WorkLog.tsx';

/** The rows of the chat. They only draw: what a row says is worked out in `parts` (transcript.ts). Each is drawn again only when
 * its part changed, so a reply that streams does not redraw the chat above it. Their class strings are T3 Code's timeline rows
 * (MIT, see THIRD_PARTY_NOTICES.md). */

type Of<T extends Part['type']> = Extract<Part, { type: T }>;
const clock = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const Time = ({ date }: { date: string }) => <time dateTime={date} title={new Date(date).toLocaleString()} className="select-none text-muted-foreground text-xs tabular-nums">{clock(date)}</time>;
/** The line that something is folded under, which opens it. */
function Fold({ open, toggle, children }: { open: boolean; toggle: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} onClick={toggle} className="flex max-w-full select-none items-center gap-1 rounded-md px-1 text-muted-foreground text-sm tabular-nums leading-relaxed transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70">
      <ChevronRightIcon className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />{children}
    </button>
  );
}
/** Shows long text a few lines high (`short`: fewer), with a button for the rest. Find in the chat opens it at once
 * (`beforematch`, find.ts) when what it found is in the part that is cut off. */
export function Clamp({ text, lines, short = false, children }: { text: string; lines: number; short?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (text.length <= lines * 100 && text.split('\n').length <= lines) return children;
  return (
    <>
      <div data-clamp={open ? undefined : ''} ref={cut => { const found = () => flushSync(() => setOpen(true)); cut?.addEventListener('beforematch', found); return () => cut?.removeEventListener('beforematch', found); }}
        className={cn(!open && 'overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]', !open && (short ? 'max-h-28' : 'max-h-44'))}>{children}</div>
      <Button variant="ghost-muted" size="xs" className="-ms-1.5 mt-1" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show full message'}</Button>
    </>
  );
}

/** Where the page finds an image a message or a tool's result has: the address it came with, or its file in the profile. */
const source = (profile: string, image: string) => image.startsWith('data:') ? image : `/images/${profile}/${image}`;
/** The cite card, and the images of a message that is only images, sit 6px in from the bubble's edges they meet, so their 10px
 * corners follow the bubble's 16px ones (16 = 10 + 6). Images with words keep to the words' 12px edge, and their corners to
 * 4px (16 = 4 + 12). A message that only cites is its card, which the bubble hugs. */
const BLEED = '-mx-1.5 first:-mt-1.5 last:-mb-1.5';
/** Your message: a bubble on the right, with the images you sent. Where it can be cited (`onCite`), it is cited as what you
 * typed, with the skill it runs: what it cites itself the agent finds where the citation sends it. */
export const UserRow = memo(function UserRow({ part, profile, onPlace, onCite }: { part: Of<'user'>; profile: string; onPlace?: (at: Place) => void; onCite?: CiteMessage }) {
  // The message as it was sent: copied, it is pasted into the box as it was, with what it cites and the skill as it was typed.
  const sent = asTyped(part), typed = asTyped({ ...part, cites: [] }), alone = !part.text && !part.skill && part.cites.length === 0;
  return (
    <div className="group flex flex-col items-end gap-1 pt-2 pb-1">
      <div data-gallery="" className="relative min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
        {part.images.length > 0 && <div className={cn(alone ? BLEED : 'mb-2', 'flex flex-wrap gap-2')}>{part.images.map((image, at) => <Picture key={at} src={source(profile, image)} className={cn('max-h-48', alone ? 'rounded-[10px]' : 'rounded-sm')} />)}</div>}
        {part.skill && <SkillChip skill={part.skill} className={cn((part.text || part.cites.length > 0) && 'mb-1')} />}
        {part.cites.length > 0 && <CiteGroup cites={part.cites} onOpen={onPlace} className={cn(BLEED, part.text && 'mb-2')} />}
        {part.text && <Clamp text={part.text} lines={12}><p data-cite={part.key} className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{part.text}</p></Clamp>}
      </div>
      <div className="flex max-w-[80%] items-center gap-1.5 pe-1 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">{sent && <CopyButton text={sent} label="Copy message" />}{onCite && typed && <CiteButton label="Cite message" onCite={anchor => onCite(typed, { id: part.key, n: 1 }, anchor)} />}<Time date={part.date} /></div>
    </div>
  );
});
export const NoteRow = memo(function NoteRow({ part }: { part: Of<'note'> }) {
  return (
    <div className="flex gap-2 pb-4 text-secondary-label">
      <StickyNoteIcon className="mt-0.5 size-4 shrink-0" />
      <Clamp text={part.text} lines={6}><Markdown text={part.text} className="text-secondary-label" /></Clamp>
    </div>
  );
});

const ICONS: [RegExp, LucideIcon][] = [[/bash|shell|exec/, TerminalIcon], [/read|view|cat/, EyeIcon], [/write|edit|patch/, SquarePenIcon], [/grep|find|search|ls|glob/, SearchIcon], [/web|fetch|http/, GlobeIcon], [/spawn|tell|agent/, BotIcon], [/zoom|date/, HistoryIcon]];
/** A tool's icon, by its name: the chat's rows and the memory's lines have the same. */
export const toolIcon = (name: string) => ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? WrenchIcon;
const Output = ({ children, className }: { children: ReactNode; className?: string }) => <pre className={cn('max-h-64 cursor-text select-text overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-secondary px-2.5 py-2 font-mono text-2xs text-secondary-label leading-relaxed dark:border-transparent dark:bg-input/32', className)}>{children}</pre>;
/** A line of a diff, or of what an edit was given, in the colour of its change. */
const CHANGES = { removed: 'bg-destructive/8 text-destructive-foreground dark:bg-destructive/14', added: 'bg-success-foreground/8 text-success-foreground dark:bg-success-foreground/12' };
/** A picture a tool returned, small (T3 Code's 16rem), and in its place a word that it is gone when the profile no longer has it. */
function ToolImage({ src }: { src: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return <p className="text-2xs text-secondary-label">Image unavailable</p>;
  return <Picture src={src} alt="What the tool returned" className="max-h-64 max-w-full rounded-md border border-border/60" onError={() => setGone(true)} />;
}
/** A tool call as one line saying what it did. Opened, the line is there whole and can be selected, with under it what it does
 * not say of the call (the lines an edit changed, the text of a file), the pictures it returned and what it printed. `live`: the agent is still at work; `running` is the call's output so far, while Pi runs it. */
function ToolRow({ step, live, running, profile }: { step: Tool; live: boolean; running?: string; profile: string }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(step.name), printed = step.output ?? running, { verb, subject, detail, stat } = act(step, live);
  return (
    <WorkLogRow
      role="button" tabIndex={0} aria-expanded={open}
      // Selecting the opened line, to copy a command, is no click on the row.
      onClick={event => { const selected = document.getSelection(); if (!selected || selected.isCollapsed || !event.currentTarget.contains(selected.anchorNode)) setOpen(!open); }}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setOpen(!open); } }}
      icon={<span className={cn('flex size-4 items-center justify-center', step.failed ? 'text-tool-error-icon/40' : 'text-icon-muted')}><Icon className="block size-4 shrink-0 stroke-2" /></span>}
      label={<><span className="font-medium">{verb}</span> <span className={cn('opacity-80', step.name === 'bash' && 'font-mono')}>{subject}</span>
        {stat && <span className="ms-1.5 font-mono text-xs tabular-nums">{stat.added > 0 && <span className="me-1 text-success-foreground">+{stat.added}</span>}{stat.removed > 0 && <span className="text-destructive-foreground">−{stat.removed}</span>}</span>}</>}
      trailing={<span className="flex h-6 items-center gap-1 self-start">
        {running !== undefined && step.output === undefined && <Spinner className="text-icon-muted" />}
        {step.failed && <XIcon aria-label="Failed" className="size-3 shrink-0 text-tool-error-icon/60" />}
        <ChevronRightIcon className={cn('size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200', open && 'rotate-90')} />
      </span>}
    >
      {open && (
        <WorkLogDetails followLive={step.output === undefined}>
          {/* A diff has the whole box to scroll in, its wrapped lines under their text, and what Pi printed under it ("Successfully
              replaced…") says nothing the line does not. */}
          {detail.length > 0 && <Output className={cn(stat && 'max-h-none shrink-0')}>{detail.map((shown, index) => <span key={index} className={cn('-mx-2.5 block px-2.5', stat && 'ps-[calc(0.625rem+2ch)] -indent-[2ch]', shown.change && CHANGES[shown.change])}>{shown.text}</span>)}</Output>}
          {step.images && <div className="flex flex-wrap gap-2">{step.images.map((image, at) => <ToolImage key={at} src={source(profile, image)} />)}</div>}
          {stat ? null : printed ? <Output>{printed}</Output> : step.images ? null : <p className="text-2xs text-secondary-label">{live && step.output === undefined ? 'No output yet.' : 'No output.'}</p>}
        </WorkLogDetails>
      )}
    </WorkLogRow>
  );
}
export function StepRow({ step, tools, profile }: { step: Step; tools?: Record<string, string>; profile: string }) {
  if (step.type === 'talk') return <div className="px-1 py-1"><Markdown text={step.text} streaming={step.streaming} /></div>;
  if (step.type === 'fault') return <p className="px-1 py-0.5 text-destructive-foreground text-sm">{step.text}</p>;
  return <><ToolRow step={step} live={tools !== undefined} running={step.call !== undefined ? tools?.[step.call] : undefined} profile={profile} />{step.name === 'spawn' && <Spawned ids={started(step)} />}</>;
}
/** Counts the seconds since `from` while the agent works. */
export function Timer({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <>{took(from, new Date(now).toISOString())}</>;
}
const iso = (time: number) => new Date(time).toISOString();
/** How long an agent has worked, counting while it does. */
export const Took = ({ agent }: { agent: Agent }) => agentWorks(agent) ? <Timer from={iso(agent.started)} /> : agent.ended !== undefined ? <>{took(iso(agent.started), iso(agent.ended))}</> : null;
/** The colours an agent's state is said in, and the only ones it has: at work (the dot's blue), done, failed. */
export const TONES = { working: 'text-info-foreground', done: 'text-success-foreground', failed: 'text-error-foreground' };
/** How an agent stands: a dot while it works, a mark for how it ended. */
export function Mark({ agent }: { agent: Pick<Agent, 'state'> }) {
  if (agentWorks(agent)) return <StatusDot tone="working" pulse={agent.state !== 'paused'} />;
  const Icon = agent.state === 'completed' ? CheckIcon : agent.state === 'failed' ? XIcon : CircleSlashIcon, { tone } = stood(agent);
  return <Icon role="img" aria-label={agent.state} className={cn('size-3.5 shrink-0 text-muted-foreground/70', tone && TONES[tone])} />;
}
/** The profile's agents as the panel's list has them, for the chat that started them, and the way to open one (`onAgent`). A
 * chat without them (the memory view's) has an empty list. */
export const AgentsInChat = createContext<{ agents: readonly Agent[]; onAgent?: (agent: string) => void }>({ agents: [] });
/** Under a `spawn` call, the agents it started, a line each, as the panel's list has them: how each stands, what it is called,
 * what it is doing now or how it ended, and how long it has worked. Where agents can be opened, a line opens its chat. An agent
 * the list does not have is not here, and the call says what it started as before. `folded`: the reply is folded shut, and
 * they are shown under it only while one of them works. They are the page's words, which find leaves out. */
function Spawned({ ids, folded = false }: { ids: readonly string[]; folded?: boolean }) {
  const { agents, onAgent } = useContext(AgentsInChat), shown = among(ids, agents);
  if (!shown.length || folded && !shown.some(agentWorks)) return null;
  return (
    <ul data-no-find aria-label="The agents it started" className={cn('ms-3 mb-1 flex flex-col border-border/70 border-s ps-2', folded && 'mt-1.5')}>
      {shown.map(agent => {
        const line = <>
          <Mark agent={agent} />
          <span className="max-w-1/2 shrink-0 truncate text-secondary-label">{named(agent)}</span>
          <span className={cn('min-w-0 flex-1 truncate text-muted-foreground', agent.state === 'failed' && 'text-destructive-foreground')}>{doing(agent)}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums"><Took agent={agent} /></span>
        </>, look = 'flex h-6 w-full min-w-0 select-none items-center gap-2 rounded-md px-1.5 text-left text-xs';
        return <li key={agent.id}>{onAgent
          ? <button type="button" title="Open this agent's chat" onClick={() => onAgent(agent.id)} className={cn(look, 'cursor-pointer outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/70')}>{line}</button>
          : <span className={look}>{line}</span>}</li>;
      })}
    </ul>
  );
}
/** What the agent is doing while it works, beside the reply itself: what it thinks, what Pi does (retrying, compacting), and
 * what its tools have printed so far, by call. */
export interface Working { thinking?: Thinking; activity?: string; tools: Record<string, string> }
/** "Working for 12s", as one phrase. A light passes over it only when Pi is doing something out of the ordinary (`activity`).
 * While the agent thinks it says the last line of its thought; once it has thought anything, it opens to all of it so far. The
 * chat draws it in one place, under your message and then under the reply, so what is open stays open, scrolled where it was. */
export function Doing({ from, activity, thinking }: { from: string; activity?: string; thinking?: Thinking }) {
  const [open, setOpen] = useState(false), thought = thinking?.text;
  const line = <>
    <span className={cn('shrink-0', activity && 'shimmer')}>{activity ?? (thinking?.now ? 'Thinking' : 'Working')} for <Timer from={from} /></span>
    {thinking?.now && !open && thought && <span className="min-w-0 flex-1 truncate opacity-70">{thoughtLine(thought)}</span>}
  </>;
  // The line is the page's, not the chat's: find leaves it out (`data-no-find`, find.ts), as it leaves out the button it is below.
  if (!thought) return <div data-no-find className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-muted-foreground text-sm tabular-nums leading-relaxed">{line}</div>;
  return (
    <>
      <Fold open={open} toggle={() => setOpen(!open)}><span className="flex min-w-0 items-baseline gap-2 text-start">{line}</span></Fold>
      {open && <WorkLogDetails followLive><Markdown text={thought} streaming={thinking.now} className="chat-markdown-quiet text-secondary-label text-xs" /></WorkLogDetails>}
    </>
  );
}
/** The agent's reply: its work, folded once it is done, and then its answer. While it works (`working`) the steps stay open, and
 * the chat says under them what it is doing (`Doing`). The chat's `latest` reply always shows what can be done with it; the others on hover.
 * An answer cited whole (`onCite`) is all of it, at the place of its first message. */
export const ReplyRow = memo(function ReplyRow({ part, working, latest, profile, onCite }: { part: Of<'reply'>; working?: Working; latest: boolean; profile: string; onCite?: CiteMessage }) {
  const [open, setOpen] = useState(false);
  const { steps, answer } = part, tools = steps.filter(step => step.type === 'tool'), failed = tools.filter(step => step.failed).length;
  // Why a reply failed is said outside the fold too, or a failed turn would look like one that answered nothing.
  const faults = part.stopped ? [] : steps.filter(step => step.type === 'fault'), spawned = steps.flatMap(started);
  return (
    <div data-gallery="" className="group/reply pb-2">
      {!working && steps.length > 0 && (
        <div className="border-border/60 border-b pt-1 pb-2">
          <Fold open={open} toggle={() => setOpen(!open)}>
            {worked(part)}{tools.length > 0 && ` · ${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`}
            {failed > 0 && <span className="text-destructive-foreground">· {failed} failed</span>}
          </Fold>
        </div>
      )}
      {(working || open) && steps.length > 0 && <div className={cn('flex min-w-0 flex-col py-1', !working && 'enter')}>{steps.map(step => <StepRow key={step.key} step={step} tools={working?.tools} profile={profile} />)}</div>}
      {!working && !open && spawned.length > 0 && <Spawned ids={spawned} folded />}
      {!working && !open && faults.map(step => <StepRow key={step.key} step={step} profile={profile} />)}
      {/* An answer in several blocks is a message of the log each: what is cited from one is cited as that message. */}
      {answer && <div className="relative flex min-w-0 flex-col gap-[0.65rem] px-1 py-0.5 pt-2">{answer.said.map((block, at) => <div key={block.key} data-cite={block.key}><Markdown text={block.text} streaming={answer.streaming && at === answer.said.length - 1} /></div>)}</div>}
      {!working && answer && (
        <div className={cn('-ms-0.5 flex items-center gap-1.5 px-1 pt-1 transition-opacity duration-200', !latest && 'opacity-0 focus-within:opacity-100 group-hover/reply:opacity-100')}>
          <CopyButton text={answer.text} label="Copy reply" />{onCite && <CiteButton label="Cite reply" onCite={anchor => onCite(answer.text, { id: answer.said[0].key, n: 1 }, anchor)} />}<Time date={part.to} />
        </div>
      )}
    </div>
  );
});
/** Complete's handoff, under the conversation it ends: what a connected window's agent wrote for the main chat. It is no answer
 * to you, so it stays folded. `writing`: the agent is at it. */
export const HandoffRow = memo(function HandoffRow({ part, writing }: { part: Of<'handoff'>; writing: boolean }) {
  const [open, setOpen] = useState(false);
  if (writing) return <div className="pb-4"><Doing from={part.items[0].date} activity="Writing the handoff" /></div>;
  // Without one of its own, the main chat writes the handoff from the conversation.
  if (!part.body) return <p className="px-1 pb-4 text-muted-foreground text-sm leading-relaxed">Handed to the main chat</p>;
  return (
    <div className="pb-4">
      <Fold open={open} toggle={() => setOpen(!open)}>Handed to the main chat</Fold>
      {open && <div className="enter mt-2 rounded-xl border border-border/70 bg-card px-3.5 py-3 dark:bg-card/60"><Markdown text={part.body} /></div>}
    </div>
  );
});
/** A connected window you opened, in the main chat, as one line: the line the agents a `spawn` started have, for a window. A dot
 * while you talk with it, a mark once it is handed off and how long it was open, and its name in the sidebar; the line opens it
 * (`onWindow`) while the app has it (`window`, the one whose conversation this is), and under the chevron is what pi-optchat
 * told the main chat of it, which was for its agent. Its handoff comes as a report of its own, further down. `handing`: its
 * record says the main chat's Pi is writing the handoff, which outlives the window: after a restart, the app has no other word of it. */
export const WindowRow = memo(function WindowRow({ part, window, handing: writing = false, onWindow }: { part: Of<'window'>; window?: WindowState; handing?: boolean; onWindow?: (window: string) => void }) {
  const [open, setOpen] = useState(false), toggle = () => setOpen(!open);
  const handing = !part.ended && (window?.completed || window?.completing || writing), talking = !part.ended && !handing && window && window.status !== 'stopped' && window.status !== 'closed';
  const go = window && onWindow ? () => onWindow(window.id) : undefined;
  return (
    <div className="group pt-0.5 pb-3.5">
      <div className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-xs transition-colors hover:bg-accent">
        <button type="button" onClick={go ?? toggle} title={go ? 'Open this window' : 'What the main chat was told'} aria-expanded={go ? undefined : open} tabIndex={go ? undefined : -1}
          className="flex h-7 min-w-0 flex-1 cursor-pointer select-none items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
          {part.ended ? <CheckIcon role="img" aria-label="Handed off" className="size-3.5 shrink-0 text-muted-foreground" /> : talking || handing ? <StatusDot tone="working" pulse /> : <MessagesSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="shrink-0 text-foreground/75">Window</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{window?.name ?? <span className="text-foreground/80">“{called(part.task)}”</span>}</span>
          <span data-no-find className={cn('shrink-0 text-muted-foreground tabular-nums', talking && 'text-info-foreground')}>
            {part.ended ? `Handed off · ${took(part.date, part.ended)}` : handing ? 'Handing off' : talking ? <>Talking with you · <Timer from={part.date} /></> : null}
          </span>
        </button>
        <button type="button" onClick={toggle} aria-expanded={open} aria-label="What the main chat was told" title="What the main chat was told"
          className="flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground opacity-0 outline-none transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/70 group-hover:opacity-100 aria-expanded:opacity-100">
          <ChevronRightIcon className={cn('size-3 transition-transform duration-200', open && 'rotate-90')} />
        </button>
        <Time date={part.date} />
      </div>
      {open && <div data-cite={part.key} className="enter ms-6.5 mt-1 cursor-text select-text whitespace-pre-wrap rounded-lg border border-border/60 bg-secondary px-2.5 py-2 text-muted-foreground text-xs leading-relaxed [overflow-wrap:anywhere] dark:border-transparent dark:bg-input/32">{part.items[0].text}</div>}
    </div>
  );
});
