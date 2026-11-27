import { BotIcon } from 'lucide-react';
import { memo, useContext, useId, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { working } from '../agent.ts';
import type { Agent } from '../protocol.ts';
import { stood } from './agents.ts';
import { CiteButton, type CiteMessage } from './Cite.tsx';
import { Markdown } from './Markdown.tsx';
import { AgentsInChat, Clamp, Mark, Time, Took, TONES } from './Rows.tsx';
import { app } from './store.ts';
import { plainly, type Part, type Report } from './transcript.ts';
import { cn, CopyButton } from './ui.tsx';

/** What OptChat itself puts in the chat: the reports of subagents. One report is a card named by the title its agent was started
 * under, or else by the agent's number. The reports of one spawn that arrive together (pi-optchat's `groupReports`) are one card,
 * drawn as the settings say (`reports`): a tab for each, one shown at a time, or a section for each, one under the other. Where
 * agents can be opened (`onAgent`), a report's name opens its agent's chat. How an agent ended and how long it worked come from
 * the agents' list where the chat has it (`AgentsInChat`), and else from what its report says. */

type Work = Extract<Part, { type: 'work' }>;
type OnAgent = ((agent: string) => void) | undefined;
/** Where a report can be cited, it is cited whole as it is copied, at its message: a report of several is one message. */
type OnCite = CiteMessage | undefined;
/** A report as it is drawn: what it says for you (`lead`, `text`), how its agent ended, the agent as the list has it, and what
 * a copy of it is. */
type Shown = Report & ReturnType<typeof plainly> & { state?: Agent['state']; from?: Agent; name: string; copy: string };
function shown(report: Report, agents: readonly Agent[]): Shown {
  // The list has an agent as it is now: one that was started again since has a later run, which is not this report's. It is this
  // report's run while the list's first line of its report is this one's (the server's `headline`).
  const said = plainly(report.body), headline = report.body.split('\n').find(line => line.trim())?.trim().slice(0, 200);
  const from = report.agent === undefined ? undefined : agents.find(agent => agent.id === report.agent && !working(agent) && agent.headline === headline);
  return {
    ...report, ...said, from, state: from?.state ?? said.ended,
    name: report.title ?? (report.agent ? `Report from ${report.agent}` : 'Report'), copy: [said.lead, said.text].filter(Boolean).join('\n\n'),
  };
}

export const ReportRow = memo(function ReportRow({ part, onAgent, onCite }: { part: Work; onAgent?: (agent: string) => void; onCite?: CiteMessage }) {
  const { agents } = useContext(AgentsInChat), layout = useSyncExternalStore(app.subscribe, () => app.state.settings?.reports ?? 'tabs');
  const reports = useMemo(() => part.reports.map(report => shown(report, agents)), [part.reports, agents]);
  if (reports.length === 1) {
    const [report] = reports;
    return (
      <Card>
        <div className="mb-1.5 flex items-center gap-1.5 text-secondary-label text-xs">
          <BotIcon className="size-3.5 shrink-0" />
          <Name report={report} onAgent={onAgent} label={report.title ? `Report: ${report.title}` : report.name} />
          <span className="flex-1" />
          <Hover><CopyButton text={report.copy} label="Copy report" /><Cites report={report} at={part.key} label="Cite report" onCite={onCite} /></Hover>
          <Time date={part.date} />
        </div>
        <Body report={report} at={part.key} />
      </Card>
    );
  }
  return layout === 'sections' ? <Sections part={part} reports={reports} onAgent={onAgent} onCite={onCite} /> : <Tabs part={part} reports={reports} onAgent={onAgent} onCite={onCite} />;
});

const Card = ({ children }: { children: ReactNode }) => <div className="group pb-4"><div className="rounded-xl border border-border/70 bg-card px-3.5 py-3 dark:bg-card/60">{children}</div></div>;
/** What shows only with the pointer on the card, or the focus in it. */
const Hover = ({ children, within = 'group-hover:opacity-100' }: { children: ReactNode; within?: string }) => <span className={cn('-my-1 flex items-center opacity-0 transition-opacity duration-200 focus-within:opacity-100', within)}>{children}</span>;
function Name({ report, onAgent, label = report.name }: { report: Shown; onAgent: OnAgent; label?: string }) {
  const { agent } = report;
  return agent && onAgent
    ? <button type="button" title={`Open this agent's chat (${agent})`} onClick={() => onAgent(agent)} className="min-w-0 cursor-pointer truncate rounded-sm font-medium outline-none hover:text-foreground hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring/70">{label}</button>
    : <span title={agent} className="min-w-0 truncate font-medium">{label}</span>;
}
const Cites = ({ report, at, label = 'Cite this report', onCite }: { report: Shown; at: number; label?: string; onCite: OnCite }) =>
  onCite && report.copy ? <CiteButton label={label} onCite={anchor => onCite(report.copy, { id: at, n: 1 }, anchor)} /> : null;
/** How a report's agent ended, where that is news: failed or stopped. */
const Ended = ({ report: { state } }: { report: Shown }) => state && state !== 'completed' ? <Mark agent={{ state }} /> : null;
function State({ report: { state } }: { report: Shown }) {
  if (!state || state === 'completed') return null;
  const { word, tone } = stood({ state });
  return <><span>·</span><span className={cn(tone && TONES[tone])}>{word}</span></>;
}
/** The report's words, cut short when long (`short`: shorter, where there are many). Its `lead` is the page's few words for how it
 * ended; the rest is the agent's, and is cited as the report's entry in the log (`at`). */
function Body({ report: { lead, text, state }, at, short = false }: { report: Shown; at: number; short?: boolean }) {
  return (
    <>
      {lead && <p className={cn('text-sm leading-relaxed', text && 'mb-1', state === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground')}>{lead}</p>}
      {text && <div data-cite={at}><Clamp text={text} lines={short ? 9 : 14} short={short}><Markdown text={text} className={cn(lead && state !== 'failed' && 'text-muted-foreground')} /></Clamp></div>}
    </>
  );
}
/** The card's head: how many reports, which of them did not end well, all of them to copy, and when they came. */
function Head({ part, reports }: { part: Work; reports: Shown[] }) {
  const failed = reports.filter(report => report.state === 'failed').length, stopped = reports.filter(report => report.state && report.state !== 'failed' && report.state !== 'completed').length;
  const all = reports.map(report => `## ${report.name}\n\n${report.copy}`).join('\n\n---\n\n');
  return (
    <div className="mb-1 flex items-center gap-1.5 text-secondary-label text-xs">
      <BotIcon className="size-3.5 shrink-0" />
      <span className="font-medium">{reports.length} reports</span>
      {failed > 0 && <span className="text-error-foreground">· {failed} failed</span>}
      {stopped > 0 && <span>· {stopped} stopped</span>}
      <span className="flex-1" />
      <Hover><CopyButton text={all} label="Copy all reports">Copy all</CopyButton></Hover>
      <Time date={part.date} />
    </div>
  );
}
/** How long the agent worked, where the list has it. */
const Worked = ({ report: { from } }: { report: Shown }) => from ? <span className="shrink-0 tabular-nums"><Took agent={from} /></span> : null;

/** A tab for each report and one shown at a time, so the card stays one report high however many there are. The arrows go from
 * tab to tab, as a tab list's do. The others are on the page all the same, hidden, so find in the chat finds in them and shows the
 * one it found in (`data-folded`, find.ts). */
function Tabs({ part, reports, onAgent, onCite }: { part: Work; reports: Shown[]; onAgent: OnAgent; onCite: OnCite }) {
  const [shownAt, setAt] = useState(0), id = useId();
  const arrow = (event: KeyboardEvent) => {
    const to = { ArrowLeft: shownAt - 1, ArrowRight: shownAt + 1, Home: 0, End: reports.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = (to + reports.length) % reports.length;
    setAt(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <Card>
      <Head part={part} reports={reports} />
      <div role="tablist" aria-label="Reports" onKeyDown={arrow} className="-mx-3.5 mb-3 flex gap-0.5 overflow-x-auto border-border/70 border-b px-2.5 [scrollbar-width:none]">
        {reports.map((report, index) => (
          <button key={index} id={`${id}-${index}`} type="button" role="tab" aria-selected={index === shownAt} aria-controls={`${id}-${index}-panel`} tabIndex={index === shownAt ? 0 : -1} title={report.name} onClick={() => setAt(index)}
            className="-mb-px flex min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-sm border-transparent border-b-2 px-2 pt-1.5 pb-2 text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset aria-selected:border-foreground aria-selected:font-medium aria-selected:text-foreground">
            <Ended report={report} /><span className="truncate">{report.name}</span>
          </button>
        ))}
      </div>
      {reports.map((report, index) => (
        <div key={index} id={`${id}-${index}-panel`} role="tabpanel" aria-labelledby={`${id}-${index}`} hidden={index !== shownAt} data-folded={index === shownAt ? undefined : ''}
          ref={pane => { const found = () => flushSync(() => setAt(index)); pane?.addEventListener('beforematch', found); return () => pane?.removeEventListener('beforematch', found); }}>
          <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
            <Name report={report} onAgent={onAgent} />
            {report.from && <span className="shrink-0">· {report.from.model.split('/').at(-1)}</span>}
            <State report={report} />
            <span className="flex-1" />
            <Hover><CopyButton text={report.copy} label="Copy this report" /><Cites report={report} at={part.key} onCite={onCite} /></Hover>
            <Worked report={report} />
          </div>
          <Body report={report} at={part.key} />
        </div>
      ))}
    </Card>
  );
}
/** A section for each report, under a hairline, all in sight. With three or more each is cut shorter, so four long reviews do
 * not fill the page. */
function Sections({ part, reports, onAgent, onCite }: { part: Work; reports: Shown[]; onAgent: OnAgent; onCite: OnCite }) {
  return (
    <Card>
      <Head part={part} reports={reports} />
      {reports.map((report, index) => (
        <section key={index} aria-label={report.name} className={cn('group/report border-border/70 border-t py-3 last:pb-0', index === 0 && 'border-t-0 pt-2')}>
          <div className="mb-1 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
            <Ended report={report} />
            <Name report={report} onAgent={onAgent} />
            <span className="flex-1" />
            <Hover within="group-hover/report:opacity-100"><CopyButton text={report.copy} label="Copy this report" /><Cites report={report} at={part.key} onCite={onCite} /></Hover>
            <Worked report={report} />
          </div>
          <Body report={report} at={part.key} short={reports.length >= 3} />
        </section>
      ))}
    </Card>
  );
}
