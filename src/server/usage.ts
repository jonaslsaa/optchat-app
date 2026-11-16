import { cacheShare, readUsage, selectUsage, summarizeUsage, USAGE_RANGES, type UsageEntry, type UsageTotals } from 'pi-optchat/files';
import type { Result, Usage } from '../protocol.ts';

/** What a profile used, from pi-optchat's usage ledger (`usage.jsonl` in the profile's folder, which the Pi that has the profile
 * appends to at every answer of a model: the main chat's, an agent's, a summary's). pi-optchat reads it, picks the range and
 * sums it, with the code `/optchat usage` shows its numbers with, so the page and the terminal say the same. Only a role's
 * own line and the bars over time are made here, and those from pi-optchat's sums too. The ledger is read whole at every look and nothing is kept: 100,000 records (42 MB) take 0.2 s. */

/** The ranges there are to ask for: pi-optchat's own, but for the one that is a single Pi session's, which is nothing the app shows. */
const RANGES = USAGE_RANGES.filter(range => range !== 'This session');
const HOUR = 3600_000, DAY = 24 * HOUR;
/** The bars a stretch of time is drawn with: up to how long a stretch (at most some 90 bars), where the bar a moment is in
 * begins, and where the next one does. By the clock on the wall, as a day and "Today" are. */
const STEPS: { step: Usage['step']; within: number; begin: (at: Date) => void; next: (at: Date) => void }[] = [
  { step: 'minutes', within: 3 * HOUR, begin: at => at.setMinutes(at.getMinutes() - at.getMinutes() % 5, 0, 0), next: at => at.setMinutes(at.getMinutes() + 5) },
  { step: 'hour', within: 3 * DAY, begin: at => at.setMinutes(0, 0, 0), next: at => at.setHours(at.getHours() + 1) },
  { step: 'day', within: 92 * DAY, begin: at => at.setHours(0, 0, 0, 0), next: at => at.setDate(at.getDate() + 1) },
  { step: 'month', within: Infinity, begin: at => { at.setDate(1); at.setHours(0, 0, 0, 0); }, next: at => at.setMonth(at.getMonth() + 1) },
];
/** The spending of `entries` over time: bars from the first of them to `now` (or the last, if the ledger has one dated later),
 * those with nothing in them too. */
function bars(entries: UsageEntry[], now: number): Pick<Usage, 'step' | 'bars'> {
  const times = entries.map(entry => Date.parse(entry.date));
  let first = now, last = now;
  for (const time of times) { first = Math.min(first, time); last = Math.max(last, time); }
  const { step, begin, next } = STEPS.find(({ within }) => last - first <= within)!, bars: Usage['bars'] = [], starts: number[] = [];
  if (!entries.length) return { step, bars };
  const at = new Date(first);
  for (begin(at); at.getTime() <= last; next(at)) { starts.push(at.getTime()); bars.push({ start: at.toISOString(), tokens: 0, cost: { main: 0, subagent: 0, compactor: 0, import: 0 } }); }
  entries.forEach(({ role, usage }, index) => {
    // The last bar that begins at or before the entry: bars are not all as long as each other (a month, a day the clocks change).
    let low = 0, high = starts.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (starts[middle] <= times[index]) low = middle; else high = middle - 1; }
    bars[low].tokens += usage.totalTokens; bars[low].cost[role] += usage.cost.total;
  });
  return { step, bars };
}
/** What the profile in `directory` used in `range`, as of `now`. A range pi-optchat has not got is refused. */
export function usage(directory: string, name = 'Today', now = Date.now()): Result<'usage'> {
  const range = RANGES.find(range => range === name);
  if (!range) throw new Error(`No usage range named ${name}: there are ${RANGES.join(', ')}.`);
  const { entries, warnings } = readUsage(directory), chosen = selectUsage(entries, range, now), { total, groups } = summarizeUsage(chosen);
  const used = (usage: UsageTotals) => ({ usage, cached: cacheShare(usage) });
  const roles = [...new Set(groups.map(group => group.role))].map(role => ({
    role, ...used(summarizeUsage(chosen.filter(entry => entry.role === role)).total), models: groups.filter(group => group.role === role).map(({ model, usage }) => ({ model, ...used(usage) })),
  }));
  return { ranges: RANGES, range, ...used(total), roles, ...bars(chosen, now), warnings };
}
