import { SOURCES, type Found, type ImportPreview, type ImportStatus, type Params, type Result } from '../protocol.ts';
import { short } from './usage.ts';

/** The Import page as data, with no DOM: which conversations a pick is, how projects are listed and filtered, and what the
 * footer and the progress say ([ui.md](../../docs/ui.md#import)). */

export type Source = typeof SOURCES[number];
export type Mode = Params<'importStart'>['mode'];
/** The sources a scan of this machine finds, in the order they are listed; a ChatGPT export is given, not found. */
export const LOCAL = SOURCES.filter(source => source !== 'chatgpt');
export const NAMES: Record<Source, string> = { claude: 'Claude Code', 'claude-memory': 'Claude Code memories', codex: 'Codex', pi: 'Pi / OMP', chatgpt: 'ChatGPT export' };
/** A source's things, as many: a memory of Claude Code's is one note, not a conversation. */
export const unit = (source: Source, n: number) => `${n.toLocaleString('en-US')} ${source === 'claude-memory' ? n === 1 ? 'memory' : 'memories' : n === 1 ? 'conversation' : 'conversations'}`;

/** How far back a pick reaches, in days; `All` has no end. */
export const RANGES = [['30 days', 30], ['3 months', 91], ['A year', 365], ['All', undefined]] as const;
export type Range = typeof RANGES[number][0];
const DAY = 86_400_000;
const within = (range: Range, now: number) => {
  const days = RANGES.find(([name]) => name === range)?.[1];
  return days === undefined ? () => true : (found: Found) => Date.parse(found.date) >= now - days * DAY;
};

/** What each source's scan found, once it has: `undefined` while it is read. */
export type Scans = Partial<Record<Source, Result<'importScan'> | { error: string }>>;
export const foundIn = (scans: Scans, source: Source) => { const scan = scans[source]; return scan && 'found' in scan ? scan.found : []; };
/** How a source stands, for its row and its card: what it found and in how many projects, and `status` in place of a count
 * while it is looked for, when it could not be read and when it found nothing. */
export const standing = (scans: Scans, source: Source) => {
  const scan = scans[source], found = foundIn(scans, source), groups = new Set(found.map(f => f.project)).size;
  const status = !scan ? 'Looking…' : 'error' in scan ? 'Could not be read' : !found.length ? source === 'chatgpt' ? 'Not given yet' : 'None on this Mac' : undefined;
  return { scan, found, status, projects: `${groups} ${groups === 1 ? 'project' : 'projects'}` };
};
/** A conversation's name in a pick: its source and its id, which is unique only within the source. */
export const key = (source: Source, id: string) => `${source}\n${id}`;

export interface Project { key: string; source: Source; project: string; conversations: Found[]; latest: string; size: number }
/** The projects of the chosen sources, busiest first: each with its conversations in the range, newest first, and none that
 * has none. The filter keeps a project whose name has it, with all of them, or one with conversations whose title has it,
 * with those; it is plain text in any case. */
export function projects(scans: Scans, sources: readonly Source[], range: Range, now: number, filter = ''): Project[] {
  const shown = within(range, now), needle = filter.trim().toLowerCase(), rows: Project[] = [];
  for (const source of sources) {
    const by = new Map<string, Found[]>();
    for (const found of foundIn(scans, source)) {
      if (!shown(found)) continue;
      const all = by.get(found.project);
      if (all) all.push(found); else by.set(found.project, [found]);
    }
    for (const [project, all] of by) {
      const conversations = !needle || project.toLowerCase().includes(needle) ? all : all.filter(found => found.title.toLowerCase().includes(needle));
      if (conversations.length) rows.push({ key: key(source, project), source, project, conversations, latest: conversations.reduce((a, b) => a > b.date ? a : b.date, ''), size: conversations.reduce((sum, found) => sum + found.size, 0) });
    }
  }
  return rows.sort((a, b) => b.conversations.length - a.conversations.length || b.latest.localeCompare(a.latest) || a.project.localeCompare(b.project));
}
/** How much of a project is picked: all, some or none of what it lists. */
export function picked(project: Project, picks: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const n = project.conversations.filter(found => picks.has(key(project.source, found.id))).length;
  return n === 0 ? 'none' : n === project.conversations.length ? 'all' : 'some';
}
/** A press on a project's box: it picks all it lists, or, when all were picked, none. */
export function toggled(project: Project, picks: ReadonlySet<string>) {
  const next = new Set(picks), all = picked(project, picks) === 'all';
  for (const found of project.conversations) next[all ? 'delete' : 'add'](key(project.source, found.id));
  return next;
}
/** What is imported: what was picked of the chosen sources, in the range. The filter only hides: what it hides stays picked. */
export function chosen(scans: Scans, sources: readonly Source[], range: Range, now: number, picks: ReadonlySet<string>): Params<'importStart'>['picked'] {
  const shown = within(range, now);
  return sources.flatMap(source => foundIn(scans, source).filter(found => shown(found) && picks.has(key(source, found.id))).map(({ id }) => ({ source, id })));
}

const count = (n: number) => n.toLocaleString('en-US');
/** The footer's line: what is picked and what it brings, by pi-optchat's preview, and what the compactor would read for it.
 * pi-optchat says a summary reads about three times the text it summarizes (its docs/import.md, "Cost"). */
export function summary(picks: number, preview: ImportPreview | undefined, mode: Mode, compactor: string) {
  if (!picks) return ['Nothing picked yet'];
  if (!preview) return [`${count(picks)} picked`, 'Counting…'];
  return [
    `${count(preview.conversations)} ${preview.conversations === 1 ? 'conversation' : 'conversations'}`,
    `${count(preview.added)} new ${preview.added === 1 ? 'message' : 'messages'}`,
    ...preview.skipped ? [`${count(preview.skipped)} already in memory`] : [],
    ...preview.added ? [`about ${short(3 * preview[mode].tokens)} tokens through ${compactor}`] : [],
  ];
}
/** The two ways history joins a memory that has messages, each in one line with what it costs, from pi-optchat's estimate
 * for each. */
export function modes(preview: ImportPreview): { mode: Mode; name: string; line: string }[] {
  const { summaries } = preview.memory;
  return [
    { mode: 'append', name: 'Append', line: `${summaries ? `Keeps its ${count(summaries)} ${summaries === 1 ? 'summary' : 'summaries'}` : 'Keeps the memory as it is'} and summarizes only what is new · about ${short(3 * preview.append.tokens)} tokens` },
    { mode: 'rebuild', name: 'Rebuild from scratch', line: `Puts everything in order by when each conversation began and summarizes the whole memory again · about ${short(3 * preview.rebuild.tokens)} tokens` },
  ];
}
/** Whether to ask how the history joins the memory: only a profile that has messages has a choice. */
export const asks = (preview: ImportPreview | undefined): preview is ImportPreview => (preview?.memory.messages ?? 0) > 0;

export type Underway = Exclude<ImportStatus, { state: 'idle' }>;
/** An import that is under way, paused or failed: what takes the profile's chat. */
export const underway = (status: ImportStatus | undefined): Underway | undefined => status?.state === 'idle' ? undefined : status;
/** How far an import is: the messages indexed of all the memory will have, as a share and in words. */
export function progress(status: Underway) {
  const share = status.total ? Math.min(1, status.messages / status.total) : 0;
  return { share, text: `${count(status.messages)} / ${count(status.total)}`, percent: `${Math.floor(100 * share)}%` };
}
