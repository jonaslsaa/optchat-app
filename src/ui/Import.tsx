import { CheckIcon, ChevronRightIcon, FileArchiveIcon, PauseIcon, PlayIcon, RefreshCwIcon, SearchIcon, Trash2Icon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Found, ImportPreview } from '../protocol.ts';
import { asks, chosen, modes, underway, foundIn, key, LOCAL, NAMES, picked, progress, projects, RANGES, standing, summary, toggled, unit, type Mode, type Project, type Range, type Scans, type Source, type Underway } from './imports.ts';
import { Mark } from './Mark.tsx';
import { app, mainOf, useApp, type State } from './store.ts';
import { Button, Choice, cn, Spinner } from './ui.tsx';

/** The Import page, in place of the chat as the settings are: other tools' histories found on this Mac, picked down to single
 * conversations, brought into the profile's memory by its own Pi ([ui.md](../../docs/ui.md#import)). What is picked and what the
 * footer says is `imports.ts`; this only draws. */

const PROVIDER: Record<Source, string | undefined> = { claude: 'anthropic', 'claude-memory': 'anthropic', codex: 'openai', chatgpt: 'openai', pi: undefined };
const bytes = (n: number) => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
const day = (date: string, now: number) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...new Date(date).getFullYear() !== new Date(now).getFullYear() && { year: 'numeric' } });
/** A project's folder, with its last part, which names it, in front. */
const folder = (project: string) => { const at = project.replace(/\/$/, '').lastIndexOf('/'); return at < 0 ? ['', project] : [project.slice(0, at + 1), project.slice(at + 1)]; };

/** The browser's own box, which can also say that part of a project is picked. */
function Box({ label, state, onChange }: { label: string; state: 'all' | 'some' | 'none'; onChange: () => void }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.indeterminate = state === 'some'; }, [state]);
  return <input ref={box} type="checkbox" aria-label={label} checked={state === 'all'} onChange={onChange} className="size-3.5 shrink-0 cursor-pointer accent-foreground" />;
}
/** A row of a long list: drawn only once it comes near the screen, so thousands scroll as smoothly as ten. */
const LONG = '[content-visibility:auto] [contain-intrinsic-size:auto_2rem]';

function Sources({ state, sources, onSources }: { state: State; sources: Source[]; onSources: Dispatch<SetStateAction<Source[]>> }) {
  const file = useRef<HTMLInputElement>(null), [refused, setRefused] = useState<string>(), [over, setOver] = useState(false);
  const toggle = (source: Source) => onSources(sources.includes(source) ? sources.filter(s => s !== source) : [...sources, source]);
  const give = async (given?: File) => {
    if (!given) return;
    setRefused(undefined);
    const why = await app.upload(given);
    // The choices as they are when it has come, which may have changed while it was sent.
    if (why) setRefused(why); else onSources(now => now.includes('chatgpt') ? now : [...now, 'chatgpt']);
  };
  const row = (source: Source) => {
    const { scan, found, status, projects } = standing(state.scans, source), n = found.length;
    const failed = scan && 'error' in scan ? scan.error : undefined, none = scan && !failed && n === 0;
    return (
      <li key={source}>
        <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', sources.includes(source) && 'bg-accent', none && 'cursor-default opacity-60 hover:bg-transparent')}>
          <input type="checkbox" className="sr-only" checked={sources.includes(source)} disabled={!n} onChange={() => toggle(source)} />
          <Mark provider={PROVIDER[source]} className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium">{NAMES[source]}</span>{n > 0 && <span className="text-muted-foreground text-xs tabular-nums">{n.toLocaleString('en-US')}</span>}</span>
            <span className="block truncate text-muted-foreground text-xs">{status ?? (source === 'chatgpt' ? unit(source, n) : `${unit(source, n)} · ${projects}`)}</span>
          </span>
          {sources.includes(source) && <CheckIcon className="mt-0.5 size-3.5 shrink-0" />}
        </label>
        {failed && <p className="px-2.5 pb-1 text-error-foreground text-xs">{failed}</p>}
        {/* What the scan could not read is left out of its count, and said. */}
        {scan && 'warnings' in scan && scan.warnings.length > 0 && <p title={scan.warnings.join('\n')} className="px-2.5 pb-1 text-warning-foreground text-xs">{scan.warnings.length} {scan.warnings.length === 1 ? 'file' : 'files'} could not be read</p>}
      </li>
    );
  };
  const uploading = state.uploading;
  return (
    <nav aria-label="Sources" className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-2.5"><h2 className="font-medium text-muted-foreground text-xs">Sources</h2>
        <Button variant="ghost-muted" size="icon-xs" aria-label="Look again" title="Look again" onClick={() => { for (const source of LOCAL) void app.scan(source, true); }}><RefreshCwIcon /></Button>
      </div>
      <ul className="grid grid-cols-2 gap-0.5 md:flex md:flex-col">{LOCAL.map(row)}{'chatgpt' in state.scans && row('chatgpt')}</ul>
      {/* A ChatGPT export is not on the Mac where the page can find it: it is given, by a drop or by choosing it. */}
      <div onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={event => { event.preventDefault(); setOver(false); void give(event.dataTransfer.files[0]); }}
        className={cn('mx-1 flex items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-dashed px-3 py-2 text-xs md:flex-col md:py-4 md:text-center', over ? 'border-foreground/40 bg-accent' : 'border-border')}>
        <FileArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
        {uploading ? <span className="text-muted-foreground">Reading {uploading.name} · {Math.floor(100 * uploading.sent / Math.max(1, uploading.size))}%</span> : <>
          <span className="flex-1 text-muted-foreground">Drop a ChatGPT export here</span>
          <Button variant="outline" size="xs" onClick={() => file.current?.click()}>Choose the ZIP…</Button>
        </>}
        <input ref={file} type="file" accept=".zip,.json" className="hidden" onChange={event => { void give(event.target.files?.[0]); event.target.value = ''; }} />
        {refused && <span role="alert" className="text-error-foreground">{refused}</span>}
      </div>
    </nav>
  );
}

function Conversation({ source, found, picks, now, onPicks }: { source: Source; found: Found; picks: Set<string>; now: number; onPicks: (picks: Set<string>) => void }) {
  const k = key(source, found.id), on = picks.has(k);
  return (
    <li className={cn('flex h-8 items-center gap-2.5 rounded-md ps-12 pe-2 text-sm hover:bg-accent/60', LONG)}>
      <input type="checkbox" aria-label={found.title} checked={on} onChange={() => { const next = new Set(picks); next[on ? 'delete' : 'add'](k); onPicks(next); }} className="size-3.5 shrink-0 cursor-pointer accent-foreground" />
      <span title={found.title} className="min-w-0 flex-1 truncate">{found.title}</span>
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{day(found.date, now)}</span>
      <span className="hidden w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums sm:block">{bytes(found.size)}</span>
    </li>
  );
}
function ProjectRow({ project, several, picks, now, onPicks }: { project: Project; several: boolean; picks: Set<string>; now: number; onPicks: (picks: Set<string>) => void }) {
  const [open, setOpen] = useState(false), [path, name] = folder(project.project), n = project.conversations.length;
  return (
    <li className={cn(!open && LONG)}>
      <div className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent/60">
        <Box label={`All of ${project.project}`} state={picked(project, picks)} onChange={() => onPicks(toggled(project, picks))} />
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span title={project.project} className="min-w-0 truncate"><span className="text-muted-foreground">{path}</span><span className="font-medium">{name}</span></span>
          {several && <Mark provider={PROVIDER[project.source]} className="size-3 shrink-0 opacity-70" />}
        </button>
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{unit(project.source, n)}</span>
        <span className="hidden w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums sm:block">{day(project.latest, now)}</span>
        <span className="hidden w-14 shrink-0 text-right text-muted-foreground text-xs tabular-nums sm:block">{bytes(project.size)}</span>
      </div>
      {open && <ul className="enter">{project.conversations.map(found => <Conversation key={found.id} source={project.source} found={found} picks={picks} now={now} onPicks={onPicks} />)}</ul>}
    </li>
  );
}
/** The projects of the chosen sources, with the filter and the range over them. */
function Projects({ scans, sources, range, picks, now, onRange, onPicks }: { scans: Scans; sources: Source[]; range: Range; picks: Set<string>; now: number; onRange: (range: Range) => void; onPicks: (picks: Set<string>) => void }) {
  const [filter, setFilter] = useState(''), typed = useDeferredValue(filter);
  const rows = useMemo(() => projects(scans, sources, range, now, typed), [scans, sources, range, now, typed]);
  const all = () => onPicks(new Set([...picks, ...rows.flatMap(row => row.conversations.map(found => key(row.source, found.id)))]));
  return (
    <section aria-label="Projects" className="flex min-w-0 flex-1 flex-col md:min-h-0">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <label className="flex h-7 min-w-40 flex-1 items-center gap-2 rounded-[var(--control-radius)] border border-input bg-popover px-2.5 text-sm focus-within:ring-2 focus-within:ring-ring dark:bg-input/32">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input aria-label="Filter projects and conversations" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter projects and conversations" spellCheck={false} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
        </label>
        <Choice label="How far back" name="import-range" options={RANGES.map(([name]) => [name, name] as const)} value={range} onChange={onRange} />
      </div>
      {!sources.length ? <p className="m-auto py-12 text-center text-muted-foreground text-sm">Choose a source to see its projects.</p>
        : !rows.length ? <p className="m-auto py-12 text-center text-muted-foreground text-sm">{typed ? `Nothing here says “${typed}”.` : `Nothing from the last ${range.toLowerCase()}.`}</p> : <>
          <div className="flex items-center gap-2 border-b px-2 pb-1.5 text-muted-foreground text-xs">
            <span className="flex-1">{rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'project' : 'projects'}, busiest first</span>
            <button type="button" onClick={all} className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Pick all shown</button>
            {picks.size > 0 && <button type="button" onClick={() => onPicks(new Set())} className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Clear</button>}
          </div>
          <ul className="py-1 md:min-h-0 md:flex-1 md:overflow-y-auto">{rows.map(row => <ProjectRow key={row.key} project={row} several={sources.length > 1} picks={picks} now={now} onPicks={onPicks} />)}</ul>
        </>}
    </section>
  );
}

function Footer({ count, preview, unread, mode, compactor, starting, refused, onMode, onStart }: { count: number; preview?: ImportPreview; unread?: string; mode: Mode; compactor: string; starting: boolean; refused?: string; onMode: (mode: Mode) => void; onStart: () => void }) {
  const [warned, setWarned] = useState(false), warnings = preview?.warnings ?? [], words = summary(count, preview, mode, compactor);
  return (
    <footer className="shrink-0 border-t bg-background/95 px-5 py-3 backdrop-blur">
      {/* Only a profile with messages has something to join them to: a new one is never asked. Append unless you say. */}
      {asks(preview) && (
        <div role="radiogroup" aria-label="How the history joins the memory" className="mx-auto mb-3 grid max-w-5xl gap-2 sm:grid-cols-2">
          {modes(preview).map(option => (
            <label key={option.mode} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', mode === option.mode ? 'border-foreground/25 bg-accent' : 'hover:bg-accent/50')}>
              <input type="radio" name="import-mode" checked={mode === option.mode} onChange={() => onMode(option.mode)} className="mt-0.5 shrink-0 accent-foreground" />
              <span className="min-w-0 text-sm"><span className="font-medium">{option.name}</span><span className="block text-muted-foreground text-xs">{option.line}</span></span>
            </label>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 basis-full md:basis-0 md:flex-1">
          <p aria-live="polite" className="flex flex-wrap text-sm">{words.map((word, at) => <span key={word} className={cn('whitespace-nowrap', at > 0 && 'text-muted-foreground', at > 0 && "before:mx-1.5 before:text-muted-foreground/50 before:content-['·']")}>{word}</span>)}</p>
          {unread && <p role="alert" className="text-error-foreground text-xs">{unread}</p>}
          {refused && <p role="alert" className="text-error-foreground text-xs">{refused}</p>}
          {warnings.length > 0 && (
            <button type="button" aria-expanded={warned} onClick={() => setWarned(!warned)} className="mt-0.5 flex items-center gap-1 rounded-sm text-warning-foreground text-xs focus-visible:ring-2 focus-visible:ring-ring">
              <TriangleAlertIcon className="size-3" />{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'} · what cannot be read is left out
            </button>
          )}
          {warned && <ul className="enter mt-1 max-h-28 overflow-y-auto text-muted-foreground text-xs">{warnings.map((warning, at) => <li key={at} className="break-words">{warning}</li>)}</ul>}
        </div>
        <Button className="ms-auto" disabled={!preview?.added || starting} onClick={onStart}>{starting ? <Spinner /> : <PlayIcon />}Start import</Button>
      </div>
    </footer>
  );
}

/** A card in the middle of the page, for an import under way, paused or done. */
const Card = ({ children }: { children: ReactNode }) => <div className="enter m-auto flex w-full max-w-lg flex-col gap-4 rounded-2xl border bg-card p-6 shadow-xs">{children}</div>;
const Bar = ({ share, moving }: { share: number; moving: boolean }) => (
  <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-foreground/10">
    <div className={cn('h-full rounded-full transition-[width] duration-500', moving ? 'bg-sky-500 dark:bg-sky-400' : 'bg-foreground/40')} style={{ width: `${Math.max(2, 100 * share)}%` }} />
  </div>
);
function Underway({ profile, status }: { profile: string; status: Underway }) {
  const [refused, setRefused] = useState<string>(), [sure, setSure] = useState(false), [asking, setAsking] = useState(false), { share, text, percent } = progress(status);
  const act = async (action: 'pause' | 'resume' | 'discard') => { setAsking(true); setRefused(await app.controlImport(profile, action)); setAsking(false); setSure(false); };
  const title = { running: `Importing into ${profile}`, paused: 'Import paused', failed: 'Import stopped' }[status.state];
  return (
    <Card>
      <div>
        <h2 className="font-medium text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">{status.mode === 'append' ? 'Appended to the memory' : 'Rebuilt in date order'} · {status.added.toLocaleString('en-US')} new messages{status.skipped ? ` · ${status.skipped.toLocaleString('en-US')} already there` : ''}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Bar share={share} moving={status.state === 'running'} />
        <p className="flex justify-between text-muted-foreground text-xs tabular-nums"><span>{text} messages · {status.summaries.toLocaleString('en-US')} summaries</span><span>{percent}</span></p>
      </div>
      {status.error && <p role="status" className={cn('rounded-md px-3 py-2 text-sm', status.state === 'failed' ? 'bg-error-surface text-error-foreground' : 'bg-warning-surface text-warning-foreground')}>{status.state === 'failed' ? status.error : `Retrying: ${status.error}`}</p>}
      <p className="text-muted-foreground text-xs">{status.state === 'running' ? `The chat in ${profile} waits until this is done; other profiles go on. The memory it had stays as it was until the end.` : `The chat in ${profile} takes messages again once you resume and it finishes, or discard it. The memory it had is untouched.`}</p>
      {refused && <p role="alert" className="text-error-foreground text-xs">{refused}</p>}
      <div className="flex justify-end gap-2">
        {status.state === 'running' ? <Button variant="outline" disabled={asking} onClick={() => void act('pause')}><PauseIcon />Pause</Button> : <>
          <Button variant="ghost-muted" disabled={asking} onClick={() => sure ? void act('discard') : setSure(true)}><Trash2Icon />{sure ? 'Discard it for good' : 'Discard'}</Button>
          <Button disabled={asking} onClick={() => void act('resume')}>{asking ? <Spinner /> : <PlayIcon />}{status.state === 'failed' ? 'Try again' : 'Resume'}</Button>
        </>}
      </div>
    </Card>
  );
}
/** The first thing worth asking a memory that now has another tool's history in it. */
export const FIRST_QUESTION = 'What have I worked on across the history I just imported, and what did I leave unfinished?';
function Done({ profile, added, onMemory, onAsk, onMore }: { profile: string; added: number; onMemory: () => void; onAsk: () => void; onMore: () => void }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success-foreground/12 text-success-foreground"><CheckIcon className="size-4" /></span>
        <div><h2 className="font-medium text-lg">Imported into {profile}</h2><p className="text-muted-foreground text-sm">{added.toLocaleString('en-US')} messages are in its memory now, summarized and searchable.</p></div>
      </div>
      <button type="button" onClick={onAsk} className="group rounded-xl border bg-background p-3 text-left text-sm hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block text-muted-foreground text-xs">Try asking</span>“{FIRST_QUESTION}”
        <span className="mt-1 block text-muted-foreground text-xs group-hover:text-foreground">Put it in the chat →</span>
      </button>
      <div className="flex justify-end gap-2"><Button variant="ghost-muted" onClick={onMore}>Import more</Button><Button onClick={onMemory}>Open memory</Button></div>
    </Card>
  );
}

/** A new profile's second step: what of your history there is, by source, for you to pick before the Import page opens on
 * it. Nothing is picked until you pick it, and starting empty is as near as Esc. When nothing is found on this Mac it says
 * so, and the way on is the page's place for a ChatGPT export. */
export function BringHistory({ state, profile, onEmpty, onChoose }: { state: State; profile: string; onEmpty: () => void; onChoose: (from: Source[]) => void }) {
  const [from, setFrom] = useState<Source[]>([]);
  useEffect(() => { for (const source of LOCAL) if (!(source in state.scans)) void app.scan(source); }, []);
  const none = LOCAL.every(source => source in state.scans && !foundIn(state.scans, source).length);
  if (none) return (
    <form onSubmit={event => { event.preventDefault(); onChoose([]); }}>
      <p className="mt-1 text-muted-foreground text-xs">{profile} starts with an empty memory. No history from Claude Code, Codex or Pi was found on this Mac.</p>
      <p className="mt-2 text-muted-foreground text-xs">A ChatGPT export can still be brought in: the next page takes the ZIP, and shows what it would cost before anything starts.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost-muted" onClick={onEmpty}>Start empty</Button>
        <Button type="submit" autoFocus>Bring a ChatGPT export…</Button>
      </div>
    </form>
  );
  return (
    <form onSubmit={event => { event.preventDefault(); onChoose(from); }}>
      <p className="mt-1 text-muted-foreground text-xs">{profile} starts with an empty memory. Claude Code, Codex and Pi kept what you did with them on this Mac: pick some, and {profile} knows it from its first message.</p>
      <ul aria-label="Sources" className="mt-3 grid gap-2 min-[30rem]:grid-cols-2">
        {LOCAL.map(source => {
          const { scan, found, status, projects } = standing(state.scans, source), on = from.includes(source);
          return (
            <li key={source}>
              <button type="button" role="checkbox" aria-checked={on} disabled={scan !== undefined && !found.length}
                onClick={() => setFrom(on ? from.filter(s => s !== source) : [...from, source])}
                className={cn('flex h-full w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', on ? 'border-foreground/30 bg-accent' : 'enabled:hover:bg-accent/50')}>
                <Mark provider={PROVIDER[source]} className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-sm">{NAMES[source]}</span>
                  <span className="block text-muted-foreground text-xs">{status ?? <>{unit(source, found.length)}<br />in {projects}</>}</span>
                </span>
                <CheckIcon className={cn('mt-0.5 size-3.5 shrink-0', !on && 'invisible')} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-muted-foreground text-xs">A ChatGPT export can be given on the next page. You pick the projects or single conversations there, and see what it costs before anything starts.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost-muted" onClick={onEmpty}>Start empty</Button>
        <Button type="submit" autoFocus>Choose what to import…</Button>
      </div>
    </form>
  );
}

export function ImportPage({ state, profile, from = [], onClose, onMemory, onChat }: { state: State; profile: string; from?: Source[]; onClose: () => void; onMemory: () => void; onChat: () => void }) {
  const [sources, setSources] = useState<Source[]>(from), [range, setRange] = useState<Range>('All'), [picks, setPicks] = useState(() => new Set<string>());
  const [mode, setMode] = useState<Mode>('append'), [preview, setPreview] = useState<ImportPreview>(), [unread, setUnread] = useState<string>(), [starting, setStarting] = useState(false), [refused, setRefused] = useState<string>();
  const [now] = useState(() => Date.now()), status = state.imports[profile], done = state.imported[profile], config = state.config[profile];
  // Each source is looked for once a run of the server, and again with the button: the server keeps what it found.
  useEffect(() => { for (const source of LOCAL) if (!(source in state.scans)) void app.scan(source); void app.readConfig(profile); void app.readModels(mainOf(profile)); }, [profile]);
  // The chat is not under this page, so the page itself follows the import.
  useImport(profile);
  const picking = useMemo(() => chosen(state.scans, sources, range, now, picks), [state.scans, sources, range, now, picks]), asked = JSON.stringify(picking);
  // What the pick brings is asked a moment after it last changed: the server reads every conversation in it.
  useEffect(() => {
    setPreview(undefined);
    setUnread(undefined);
    if (!picking.length) return;
    let current = true;
    const timer = setTimeout(() => void app.preview(profile, picking).then(answer => { if (current) { setPreview(answer.preview); setUnread(answer.error); } }), 250);
    return () => { current = false; clearTimeout(timer); };
  }, [profile, asked]);
  const compactor = config ? state.models[mainOf(profile)]?.models.find(model => model.provider === config.compactor.provider && model.id === config.compactor.model)?.name ?? config.compactor.model : 'the compactor';
  const start = async () => {
    setStarting(true);
    const why = await app.startImport(profile, picking, asks(preview) ? mode : 'append');
    setStarting(false);
    setRefused(why);
    if (!why) setPicks(new Set());
  };
  // The question goes to the main chat, which is put in front: the page may have been opened over a connected window.
  const ask = () => { app.keep(mainOf(profile), FIRST_QUESTION); app.select(mainOf(profile)); app.seenImport(profile); onChat(); };
  const busy = underway(status);
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="window-bar window-start flex h-(--topbar-height) shrink-0 items-center gap-2 px-5">
        <h1 className="min-w-0 flex-1 truncate font-medium text-sm">Import into <span className="text-foreground">{profile}</span></h1>
        <Button variant="ghost-muted" size="icon-sm" aria-label="Close the import" onClick={onClose}><XIcon /></Button>
      </header>
      {busy ? <div className="flex min-h-0 flex-1 overflow-y-auto p-5"><Underway profile={profile} status={busy} /></div>
        : done ? <div className="flex min-h-0 flex-1 overflow-y-auto p-5"><Done profile={profile} added={done.added} onMemory={() => { app.seenImport(profile); onMemory(); }} onAsk={ask} onMore={() => app.seenImport(profile)} /></div>
        : <>
          {/* Narrow, the page scrolls as one, the sources over the projects; wide, each column scrolls by itself. */}
          <div className="enter mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-5 pt-2 md:flex-row md:gap-6 md:overflow-visible">
            <div className="shrink-0 md:w-60 md:overflow-y-auto">
              <p className="px-2.5 pb-3 text-muted-foreground text-xs max-md:hidden">What other tools kept, found on this Mac. Nothing is picked until you pick it, and a big import keeps the compactor busy for a while.</p>
              <Sources state={state} sources={sources} onSources={setSources} />
            </div>
            <Projects scans={state.scans} sources={sources} range={range} picks={picks} now={now} onRange={setRange} onPicks={setPicks} />
          </div>
          <Footer count={picking.length} preview={preview} unread={unread} mode={mode} compactor={compactor} starting={starting} refused={refused} onMode={setMode} onStart={() => void start()} />
        </>}
    </main>
  );
}

/** How a profile's import stands, read when its page or chat is shown and every second while one is under way. pi-optchat
 * writes it to the profile's files as it goes, so nothing is pushed. */
export function useImport(profile: string, pulse = '') {
  // Paused or failed too: a terminal, or another of the app's pages, may resume or discard it.
  const pending = underway(useApp().imports[profile]) !== undefined;
  useEffect(() => { void app.readImport(profile); }, [profile, pulse]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void app.readImport(profile), 1000);
    return () => clearInterval(timer);
  }, [profile, pending]);
}
/** In place of the composer while the profile has an import under way, paused or failed: pi-optchat takes no message then. */
export function ImportLine({ status, onShow }: { status: Underway; onShow: () => void }) {
  const { share, text } = progress(status), running = status.state === 'running';
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-4 sm:px-5">
      <div role="status" className="enter flex items-center gap-3 rounded-2xl border bg-card px-4 py-2.5 text-sm">
        {running ? <Spinner className="text-sky-600 dark:text-sky-400" /> : <PauseIcon className="size-3.5 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate"><span className="tabular-nums">{running ? `Importing ${text}` : `Import ${status.state === 'failed' ? 'stopped' : 'paused'} at ${text}`}</span>
          <span className="text-muted-foreground"> · {running ? 'the chat takes messages again once it is done' : 'resume or discard it to chat again'}</span></span>
        <div aria-hidden="true" className="hidden h-1 w-24 overflow-hidden rounded-full bg-foreground/10 sm:block"><div className={cn('h-full rounded-full', running ? 'bg-sky-500 dark:bg-sky-400' : 'bg-foreground/40')} style={{ width: `${Math.max(2, 100 * share)}%` }} /></div>
        <Button variant="outline" size="xs" onClick={onShow}>Show</Button>
      </div>
    </div>
  );
}
