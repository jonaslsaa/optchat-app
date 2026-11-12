import { BotIcon, ChevronRightIcon, EyeIcon, GlobeIcon, HistoryIcon, SearchIcon, SquarePenIcon, StickyNoteIcon, TerminalIcon, WrenchIcon, XIcon, type LucideIcon } from 'lucide-react';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Markdown } from './Markdown.tsx';
import { took, type Part, type Step } from './transcript.ts';
import { Button, cn, Spinner } from './ui.tsx';
import { WorkLogDetails, WorkLogRow } from './WorkLog.tsx';

/** The rows of the chat. They only draw: what a row says is worked out in `parts` (transcript.ts). Each is drawn again only when
 * its part changed, so a reply that streams does not redraw the chat above it. Their class strings are T3 Code's timeline rows
 * (MIT, see THIRD_PARTY_NOTICES.md). */

type Of<T extends Part['type']> = Extract<Part, { type: T }>;
const clock = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const Time = ({ date }: { date: string }) => <time dateTime={date} title={new Date(date).toLocaleString()} className="text-muted-foreground text-xs tabular-nums">{clock(date)}</time>;
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
/** What OptChat itself put in the chat: a subagent's report or a connected window's handoff, named by its agent. */
export const ReportRow = memo(function ReportRow({ part }: { part: Of<'work'> }) {
  return (
    <div className="group pb-4">
      <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3 dark:bg-card/60">
        <div className="mb-1.5 flex items-center gap-1.5 text-secondary-label text-xs">
          <BotIcon className="size-3.5" /><span className="font-medium">{part.agent ? `Report from ${part.agent}` : 'Report'}</span><span className="flex-1" /><Time date={part.date} />
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
/** What a tool call is about, in a few words: its command, path or pattern, or else its first argument. */
function about(args: Record<string, unknown>) {
  const value = args.command ?? args.path ?? args.file_path ?? args.pattern ?? args.query ?? args.url ?? args.title ?? Object.values(args)[0];
  return typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
}
const Output = ({ children }: { children: string }) => <pre className="max-h-64 cursor-text select-text overflow-auto whitespace-pre-wrap break-words font-mono text-2xs text-secondary-label leading-relaxed">{children}</pre>;
/** A tool call as one line, which opens to its arguments and what it printed. `running` is its output so far, while Pi runs it. */
function ToolRow({ step, running }: { step: Extract<Step, { type: 'tool' }>; running?: string }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS.find(([pattern]) => pattern.test(step.name))?.[1] ?? WrenchIcon, printed = step.output ?? running;
  return (
    <WorkLogRow
      role="button" tabIndex={0} aria-expanded={open}
      onClick={() => setOpen(!open)}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setOpen(!open); } }}
      icon={<span className="flex size-4 items-center justify-center text-icon-muted"><Icon className="block size-4 shrink-0 stroke-2" /></span>}
      label={<><span className={cn('font-medium', step.failed && 'text-destructive')}>{step.name}</span> <span className="font-mono text-[0.8125rem] opacity-80">{about(step.args)}</span></>}
      trailing={<span className="flex h-6 items-center gap-1">
        {running !== undefined && step.output === undefined && <Spinner className="text-icon-muted" />}
        {step.failed && <XIcon className="size-3 shrink-0 text-tool-error-icon/60" />}
        <ChevronRightIcon className={cn('size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200', open && 'rotate-90')} />
      </span>}
    >
      {open && (
        <WorkLogDetails followLive={step.output === undefined}>
          <Output>{JSON.stringify(step.args, null, 2)}</Output>
          {printed ? <Output>{printed}</Output> : null}
        </WorkLogDetails>
      )}
    </WorkLogRow>
  );
}
function StepRow({ step, tools }: { step: Step; tools: Record<string, string> }) {
  if (step.type === 'talk') return <div className="px-1 py-1"><Markdown text={step.text} streaming={step.streaming} /></div>;
  if (step.type === 'fault') return <p className="px-1 py-0.5 text-destructive-foreground text-sm">{step.text}</p>;
  return <ToolRow step={step} running={step.call !== undefined ? tools[step.call] : undefined} />;
}
/** Counts the seconds since `from` while the agent works. */
function Timer({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <>{took(from, new Date(now).toISOString())}</>;
}
/** What the agent is doing while it works, beside the reply itself: what it thinks, what Pi does (retrying, compacting), and
 * what its tools have printed so far, by call. */
export interface Working { thinking?: string; activity?: string; tools: Record<string, string> }
const NO_TOOLS = {};
/** The agent's reply: its work, folded once it is done, and then its answer. While it works (`working`) the steps stay open, and
 * a line under them says what it is doing. */
export const ReplyRow = memo(function ReplyRow({ part, working }: { part: Of<'reply'>; working?: Working }) {
  const [open, setOpen] = useState(false);
  const { steps, answer } = part, count = steps.filter(step => step.type === 'tool').length;
  return (
    <div className="group/reply pb-2">
      {!working && steps.length > 0 && (
        <div className="border-border/60 border-b pt-1 pb-2">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex select-none items-center gap-1 rounded-md px-1 text-muted-foreground text-sm tabular-nums leading-relaxed transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70">
            <ChevronRightIcon className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
            {part.stopped ? 'Stopped after' : 'Worked for'} {took(part.from, part.to)}{count > 0 && ` · ${count} tool ${count === 1 ? 'call' : 'calls'}`}
          </button>
        </div>
      )}
      {(working || open) && steps.length > 0 && <div className="flex min-w-0 flex-col py-1">{steps.map(step => <StepRow key={step.key} step={step} tools={working?.tools ?? NO_TOOLS} />)}</div>}
      {answer && <div className="relative min-w-0 px-1 py-0.5 pt-2"><Markdown text={answer.text} streaming={answer.streaming} /></div>}
      {working && (
        <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 pt-2 text-muted-foreground text-sm tabular-nums leading-relaxed">
          <span className="shimmer shrink-0">{working.activity ?? (working.thinking !== undefined ? 'Thinking' : 'Working')}</span>
          <span className="shrink-0">for <Timer from={part.from} /></span>
          {working.thinking && <span className="min-w-0 flex-1 truncate opacity-70">{working.thinking.trim().split('\n').at(-1)}</span>}
        </div>
      )}
      {!working && answer && <div className="flex items-center gap-2 px-1 pt-1 opacity-0 transition-opacity duration-200 group-hover/reply:opacity-100"><Time date={part.to} /></div>}
    </div>
  );
});
/** The agent has your message and has not said anything yet. */
export function Waiting({ from, activity }: { from: string; activity?: string }) {
  return (
    <div className="flex h-6 items-baseline gap-2 px-1 pb-4 text-muted-foreground text-sm tabular-nums leading-relaxed">
      <span className="shimmer">{activity ?? 'Working'}</span><span>for <Timer from={from} /></span>
    </div>
  );
}
