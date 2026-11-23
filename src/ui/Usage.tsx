import { RefreshCwIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Usage } from '../protocol.ts';
import { Page, Section } from './Settings.tsx';
import { app, mainOf, profileName, type State } from './store.ts';
import { Button, Choice, cn } from './ui.tsx';
import { breakdown, chart, dollars, headline, limits, short } from './usage.ts';

/** The usage page, in place of the chat as the settings are: what the profile in front used in a range, from pi-optchat's
 * ledger ([ui.md](../../docs/ui.md#usage)). The layout is T3 Code's usage page (its totals, its share bar and its table),
 * without its providers, its prices and its limits. */

/** A figure with what it is over it, as in T3 Code's totals. */
const Metric = ({ label, value, more }: { label: string; value: string; more?: string }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="font-medium text-base tabular-nums">{value}{more && <span className="ms-1.5 font-normal text-muted-foreground text-xs">{more}</span>}</dd>
  </div>
);
type Rows = ReturnType<typeof breakdown>;
/** Whose the cost was, as one bar. The list under it has every figure: the bar's parts speak only when pointed at. */
function Shares({ rows }: { rows: Rows }) {
  // As shares of the whole, which fill the bar whatever the sum is: dollars as they are leave it part empty under one dollar.
  const total = rows.reduce((sum, row) => sum + row.dollars, 0);
  return (
    <>
      <div aria-hidden="true" className="flex h-2 gap-0.5">
        {rows.filter(row => row.dollars > 0).map(row => <div key={row.role} title={`${row.name} · ${row.cost} · ${row.share}`} className={cn('h-full min-w-1 rounded-xs first:rounded-l-full last:rounded-r-full', row.colour)} style={{ flex: `${100 * row.dollars / total} 1 0` }} />)}
      </div>
      <ul aria-label="Cost by role" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {rows.map(row => (
          <li key={row.role} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-xs', row.colour)} /><span className="text-muted-foreground">{row.name}</span>
            <span className="tabular-nums">{row.cost}</span><span className="text-muted-foreground tabular-nums">{row.share}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
/** The cost over time: a bar for every stretch from the first spending to now, its parts in the roles' colours. */
function Bars({ usage }: { usage: Usage }) {
  const { bars, peak, ends } = chart(usage);
  return (
    <figure aria-label={`Cost over time, ${ends[0]} to ${ends[1]}: at most ${peak} in one bar`}>
      <div className="flex h-28 items-end gap-px border-border/70 border-b">
        {bars.map(bar => (
          <div key={bar.start} title={bar.title} className="flex h-full min-w-0 flex-1 flex-col justify-end hover:bg-muted/70">
            {bar.height > 0 && (
              <div className="flex min-h-px flex-col-reverse overflow-hidden rounded-t-xs" style={{ height: `${bar.height * 100}%` }}>
                {bar.parts.map(part => <div key={part.role} className={part.colour} style={{ flex: `${part.share} 1 0` }} />)}
              </div>
            )}
          </div>
        ))}
      </div>
      <figcaption aria-hidden="true" className="mt-1.5 flex justify-between gap-3 text-muted-foreground text-xs tabular-nums"><span>{ends[0]}</span><span>Tallest: {peak}</span><span>{ends[1]}</span></figcaption>
    </figure>
  );
}
const CELL = 'py-2 pl-5';
/** The terminal's table: each role with its models, what each cost and its share, the tokens that came out, and how much of
 * what went in was read from the cache. */
function Table({ rows }: { rows: Rows }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-border border-b text-right text-muted-foreground text-xs">
          <th className="w-full py-2 text-left font-normal">Model</th><th className={cn(CELL, 'font-normal')}>Cost</th><th className={cn(CELL, 'hidden font-normal sm:table-cell')}>Share</th>
          <th className={cn(CELL, 'font-normal')}>Output</th><th className={cn(CELL, 'font-normal')}>Cached</th>
        </tr>
      </thead>
      {rows.map(row => (
        <tbody key={row.role} className="text-right tabular-nums">
          <tr className="border-border/50 border-b">
            {/* A role with one model is one line, which names it: its model's line would say the same again. */}
            <th scope="rowgroup" title={row.only} className="w-full max-w-0 truncate py-2 text-left font-medium">
              <span aria-hidden="true" className={cn('me-2 inline-block size-2 rounded-xs', row.colour)} />{row.name}{row.only && <span className="ms-2 font-normal text-muted-foreground">{row.only}</span>}
            </th>
            <td className={CELL}>{row.cost}</td><td className={cn(CELL, 'hidden sm:table-cell')}>{row.share}</td><td className={CELL}>{row.out}</td><td className={CELL}>{row.cached}</td>
          </tr>
          {!row.only && row.models.map(model => (
            <tr key={model.model} className="border-border/50 border-b text-muted-foreground">
              {/* A cell that may be narrower than its text, so a long name is cut and the figures stay in sight. */}
              <th scope="row" title={model.model} className="w-full max-w-0 truncate py-2 ps-4 text-left font-normal">{model.model}</th>
              <td className={CELL}>{model.cost}</td><td className={cn(CELL, 'hidden sm:table-cell')}>{model.share}</td><td className={CELL}>{model.out}</td><td className={CELL}>{model.cached}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
/** How much of the subscription is used, whatever the period: a bar for each window its provider counts in, and in plain
 * words what cannot be missed (extra usage, a limit that is reached, a request that was refused). The count is the one that
 * came with the latest answer, so it says how old it is, by a clock of the page's own: nothing is asked for it. */
function Limits({ saved }: { saved: Usage['limits'] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  if (!saved) return <Section title="Limits"><p className="text-muted-foreground text-sm">No data yet. Only an Anthropic subscription reports its limits (pi-optchat 0.11.15 or newer).</p></Section>;
  const { rows, notes, age } = limits(saved, now);
  return (
    <Section title="Limits" hint={age}>
      {notes.map(note => <p key={note} role="status" className="mb-3 rounded-md bg-warning-surface px-3 py-2 text-sm text-warning-foreground">{note}</p>)}
      <ul className="flex flex-col gap-3">
        {rows.map(row => (
          <li key={row.window}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span>{row.name}</span><span className="text-muted-foreground text-xs tabular-nums">{row.text}</span></div>
            <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10">
              <div className={cn('h-full rounded-full', row.reached || row.used >= 1 ? 'bg-destructive' : row.used >= 0.8 ? 'bg-warning' : 'bg-foreground/60')} style={{ width: `${Math.min(100, row.percent ?? 0)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
function Figures({ usage }: { usage: Usage }) {
  const total = usage.usage, rows = breakdown(usage);
  if (!rows.length) return <p className="py-8 text-center text-muted-foreground text-sm">No usage in this period.</p>;
  return (
    <>
      <section aria-label="Totals" className="border-b py-5">
        <p title={headline(usage)} className="font-medium text-3xl tabular-nums tracking-tight">{dollars(total.cost.total)}<span className="ms-2 font-normal text-muted-foreground text-sm tracking-normal">estimated</span></p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Metric label="Tokens" value={short(total.totalTokens)} />
          <Metric label="New input" value={short(total.input)} />
          <Metric label="Cache read" value={short(total.cacheRead)} more={`${usage.cached}%`} />
          <Metric label="Cache write" value={short(total.cacheWrite)} />
          <Metric label="Output" value={short(total.output)} />
        </dl>
      </section>
      {total.cost.total > 0 && <Section title="Cost by role"><Shares rows={rows} /></Section>}
      {total.cost.total > 0 && usage.bars.length > 1 && <Section title="Cost over time"><Bars usage={usage} /></Section>}
      <Section title="Breakdown"><Table rows={rows} /></Section>
    </>
  );
}
export function UsagePage({ state, profile, onClose }: { state: State; profile: string; onClose: () => void }) {
  const usage = state.usage[profile], [range, setRange] = useState(usage?.range ?? 'Today');
  const main = mainOf(profile), window = state.windows.find(window => window.id === main), live = state.live[main];
  // What the server pushes of the main chat while its ledger grows: its Pi starting and stopping, each message of its run
  // (the ledger gets a line as each answer ends), and its status line, which counts its agents and the summaries to write.
  const pulse = [window?.status, live?.messages.length, live?.status.optchat, state.logs[profile]?.total, state.connection].join(' ');
  useEffect(() => { void app.readUsage(profile, range); }, [profile, range, pulse]);
  return (
    <Page title="Usage" action={<>
      <Button variant="ghost-muted" size="icon-sm" aria-label="Read the usage again" title="Read the usage again" onClick={() => void app.readUsage(profile, range)}><RefreshCwIcon /></Button>
      <Button variant="ghost-muted" size="icon-sm" aria-label="Close the usage" onClick={onClose}><XIcon /></Button>
    </>}>
      {usage && <Limits saved={usage.limits} />}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-5">
        <p className="min-w-0 truncate text-muted-foreground text-sm">What <span className="font-medium text-foreground">{profileName(state, profile)}</span> used</p>
        {usage && <Choice label="Period" name={`usage-${profile}`} options={usage.ranges.map(range => [range, range] as const)} value={range} onChange={setRange} />}
      </div>
      {/* Figures of another period than the one picked are on their way out, or stay if the server does not answer: dimmed, so they are not taken for it. */}
      {usage ? <div aria-busy={usage.range !== range} className={cn(usage.range !== range && 'opacity-50')}><Figures usage={usage} /></div> : <p className="py-8 text-center text-muted-foreground text-sm">Reading the ledger…</p>}
      <footer className="flex flex-col gap-1 pt-4 text-muted-foreground text-xs">
        <p>Estimated at API prices, not your subscription bill.</p>
        {window?.outside && <p>A Pi in a terminal has this chat and tells the app nothing as it goes: read the usage again for what it has used since.</p>}
        {usage?.warnings.map(warning => <p key={warning} role="status" className="text-warning-foreground">{warning}</p>)}
      </footer>
    </Page>
  );
}
