import { BotIcon, ChevronRightIcon, EyeIcon, GlobeIcon, HistoryIcon, SearchIcon, SquarePenIcon, StickyNoteIcon, TerminalIcon, WrenchIcon, XIcon, type LucideIcon } from 'lucide-react';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Markdown } from './Markdown.tsx';
import { act, took, type Part, type Step, type Tool } from './transcript.ts';
import { Button, cn, CopyButton, Spinner } from './ui.tsx';
import { WorkLogDetails, WorkLogRow } from './WorkLog.tsx';

/** The rows of the chat. They only draw: what a row says is worked out in `parts` (transcript.ts). Each is drawn again only when
 * its part changed, so a reply that streams does not redraw the chat above it. Their class strings are T3 Code's timeline rows
 * (MIT, see THIRD_PARTY_NOTICES.md). */

type Of<T extends Part['type']> = Extract<Part, { type: T }>;
const clock = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const Time = ({ date }: { date: string }) => <time dateTime={date} title={new Date(date).toLocaleString()} className="text-muted-foreground text-xs tabular-nums">{clock(date)}</time>;
/** The line that something is folded under, which opens it. */
function Fold({ open, toggle, children }: { open: boolean; toggle: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} onClick={toggle} className="flex select-none items-center gap-1 rounded-md px-1 text-muted-foreground text-sm tabular-nums leading-relaxed transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70">
      <ChevronRightIcon className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />{children}
    </button>
  );
}
/** Shows long text a few lines high, with a button for the rest. */
function Clamp({ text, lines, children }: { text: string; lines: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (text.length <= lines * 100 && text.split('\n').length <= lines) return children;
  return (
    <>
      <div className={cn(!open && 'max-h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]')}>{children}</div>
      <Button variant="ghost-muted" size="xs" className="-ms-1.5 mt-1" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show full message'}</Button>
    </>
  );
}

/** Your message: a bubble on the right, with the images you sent. */
export const UserRow = memo(function UserRow({ part, profile }: { part: Of<'user'>; profile: string }) {
  return (
    <div className="group flex flex-col items-end gap-1 pt-2 pb-1">
      <div className="relative min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
        {part.images.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{part.images.map(name => <img key={name} src={`/images/${profile}/${name}`} alt="" className="max-h-48 rounded-lg" />)}</div>}
        <Clamp text={part.text} lines={12}><p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{part.text}</p></Clamp>
      </div>
      <div className="flex max-w-[80%] items-center pe-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"><Time date={part.date} /></div>
    </div>
  );
});
/** What OptChat itself put in the chat: a subagent's report or a connected window's handoff, named by the title its agent was
 * started under, or else by the agent's number. Where agents can be opened (`onAgent`), its name opens the agent's chat. */
export const ReportRow = memo(function ReportRow({ part, onAgent }: { part: Of<'work'>; onAgent?: (agent: string) => void }) {
  const { agent } = part, name = part.title ? `Report: ${part.title}` : agent ? `Report from ${agent}` : 'Report';
  return (
    <div className="group pb-4">
      <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3 dark:bg-card/60">
        <div className="mb-1.5 flex items-center gap-1.5 text-secondary-label text-xs">
          <BotIcon className="size-3.5 shrink-0" />
          {agent && onAgent
            ? <button type="button" title={`Open this agent's chat (${agent})`} onClick={() => onAgent(agent)} className="min-w-0 cursor-pointer truncate rounded-sm font-medium outline-none hover:text-foreground hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/70">{name}</button>
            : <span title={agent} className="min-w-0 truncate font-medium">{name}</span>}
          <span className="flex-1" /><Time date={part.date} />
        </div>
        <Clamp text={part.body} lines={14}><Markdown text={part.body} /></Clamp>
      </div>
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
const Output = ({ children }: { children: ReactNode }) => <pre className="max-h-64 cursor-text select-text overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-secondary px-2.5 py-2 font-mono text-2xs text-secondary-label leading-relaxed dark:border-transparent dark:bg-input/32">{children}</pre>;
/** A tool call as one line saying what it did. Opened, the line is there whole and can be selected, with under it what it does
 * not say of the call (the lines an edit changed, the text of a file) and what the call printed. `live`: the agent is still at work; `running` is the call's output so far, while Pi runs it. */
function ToolRow({ step, live, running }: { step: Tool; live: boolean; running?: string }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS.find(([pattern]) => pattern.test(step.name))?.[1] ?? WrenchIcon, printed = step.output ?? running, { verb, subject, detail } = act(step, live);
  return (
    <WorkLogRow
      role="button" tabIndex={0} aria-expanded={open}
      // Selecting the opened line, to copy a command, is no click on the row.
      onClick={event => { const selected = document.getSelection(); if (!selected || selected.isCollapsed || !event.currentTarget.contains(selected.anchorNode)) setOpen(!open); }}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setOpen(!open); } }}
      icon={<span className="flex size-4 items-center justify-center text-icon-muted"><Icon className="block size-4 shrink-0 stroke-2" /></span>}
      label={<><span className={cn('font-medium', step.failed && 'text-destructive')}>{verb}</span> <span className={cn('opacity-80', step.name === 'bash' && 'font-mono')}>{subject}</span></>}
      trailing={<span className="flex h-6 items-center gap-1 self-start">
        {running !== undefined && step.output === undefined && <Spinner className="text-icon-muted" />}
        {step.failed && <XIcon aria-label="Failed" className="size-3 shrink-0 text-tool-error-icon/60" />}
        <ChevronRightIcon className={cn('size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200', open && 'rotate-90')} />
      </span>}
    >
      {open && (
        <WorkLogDetails followLive={step.output === undefined}>
          {detail.length > 0 && <Output>{detail.map((shown, index) => <span key={index} className={cn('block', shown.change === 'removed' ? 'text-destructive-foreground' : shown.change === 'added' && 'text-success-foreground')}>{shown.text}</span>)}</Output>}
          {printed ? <Output>{printed}</Output> : <p className="text-2xs text-secondary-label">{live && step.output === undefined ? 'No output yet.' : 'No output.'}</p>}
        </WorkLogDetails>
      )}
    </WorkLogRow>
  );
}
function StepRow({ step, tools }: { step: Step; tools?: Record<string, string> }) {
  if (step.type === 'talk') return <div className="px-1 py-1"><Markdown text={step.text} streaming={step.streaming} /></div>;
  if (step.type === 'fault') return <p className="px-1 py-0.5 text-destructive-foreground text-sm">{step.text}</p>;
  return <ToolRow step={step} live={tools !== undefined} running={step.call !== undefined ? tools?.[step.call] : undefined} />;
}
/** Counts the seconds since `from` while the agent works. */
export function Timer({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <>{took(from, new Date(now).toISOString())}</>;
}
/** What the agent is doing while it works, beside the reply itself: what it thinks, what Pi does (retrying, compacting), and
 * what its tools have printed so far, by call. */
export interface Working { thinking?: string; activity?: string; tools: Record<string, string> }
/** "Working for 12s", as one phrase. A light passes over it only when Pi is doing something out of the ordinary (`activity`). */
function Doing({ from, activity, thinking }: { from: string; activity?: string; thinking?: string }) {
  return (
    <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-muted-foreground text-sm tabular-nums leading-relaxed">
      <span className={cn('shrink-0', activity && 'shimmer')}>{activity ?? (thinking !== undefined ? 'Thinking' : 'Working')} for <Timer from={from} /></span>
      {thinking && <span className="min-w-0 flex-1 truncate opacity-70">{thinking.trim().split('\n').at(-1)}</span>}
    </div>
  );
}
/** The agent's reply: its work, folded once it is done, and then its answer. While it works (`working`) the steps stay open, and
 * a line under them says what it is doing. The chat's `latest` reply always shows what can be done with it; the others on hover. */
export const ReplyRow = memo(function ReplyRow({ part, working, latest }: { part: Of<'reply'>; working?: Working; latest: boolean }) {
  const [open, setOpen] = useState(false);
  const { steps, answer } = part, tools = steps.filter(step => step.type === 'tool'), failed = tools.filter(step => step.failed).length;
  // Why a reply failed is said outside the fold too, or a failed turn would look like one that answered nothing.
  const faults = part.stopped ? [] : steps.filter(step => step.type === 'fault');
  return (
    <div className="group/reply pb-2">
      {!working && steps.length > 0 && (
        <div className="border-border/60 border-b pt-1 pb-2">
          <Fold open={open} toggle={() => setOpen(!open)}>
            {part.stopped ? 'Stopped after' : faults.length ? 'Failed after' : 'Worked for'} {took(part.from, part.to)}{tools.length > 0 && ` · ${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`}
            {failed > 0 && <span className="text-destructive-foreground">· {failed} failed</span>}
          </Fold>
        </div>
      )}
      {(working || open) && steps.length > 0 && <div className="flex min-w-0 flex-col py-1">{steps.map(step => <StepRow key={step.key} step={step} tools={working?.tools} />)}</div>}
      {!working && !open && faults.map(step => <StepRow key={step.key} step={step} />)}
      {answer && <div className="relative min-w-0 px-1 py-0.5 pt-2"><Markdown text={answer.text} streaming={answer.streaming} /></div>}
      {working && <div className="pt-2"><Doing from={part.from} activity={working.activity} thinking={working.thinking} /></div>}
      {!working && answer && (
        <div className={cn('-ms-0.5 flex items-center gap-1.5 px-1 pt-1 transition-opacity duration-200', !latest && 'opacity-0 focus-within:opacity-100 group-hover/reply:opacity-100')}>
          <CopyButton text={answer.text} label="Copy reply" /><Time date={part.to} />
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
      {open && <div className="mt-2 rounded-xl border border-border/70 bg-card px-3.5 py-3 dark:bg-card/60"><Markdown text={part.body} /></div>}
    </div>
  );
});
/** The agent has your message and has not said anything yet. */
export function Waiting({ from, activity }: { from: string; activity?: string }) {
  return <div className="pb-4"><Doing from={from} activity={activity} /></div>;
}
