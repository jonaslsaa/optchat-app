import type { Usage } from '../protocol.ts';

/** What the usage page says, with no DOM: the words and the numbers for what the server read of a profile's ledger
 * ([server.md](../../docs/server.md#usage)). The figures are written as pi-optchat writes them in a terminal (`/optchat usage`,
 * its `inspector.ts`), so the two can be held beside each other: `test/usage.test.ts` does. */
type Used = Pick<Usage, 'usage' | 'cached'>;
export type Role = Usage['roles'][number]['role'];
/** The roles in the order they are listed, with what each is called (`short` in a terminal) and its colour in the bars. */
export const ROLES = [
  { role: 'main', name: 'Main chat', short: 'main', colour: 'bg-sky-500 dark:bg-sky-400/90' },
  { role: 'subagent', name: 'Subagents', short: 'subagents', colour: 'bg-violet-500 dark:bg-violet-400/90' },
  { role: 'compactor', name: 'Compactor', short: 'compactor', colour: 'bg-amber-500 dark:bg-amber-400/90' },
  { role: 'import', name: 'Import', short: 'import', colour: 'bg-zinc-400 dark:bg-zinc-500' },
] as const satisfies readonly { role: Role; name: string; short: string; colour: string }[];

export const dollars = (n: number) => `$${n.toFixed(2)}`;
const UNITS = ['', 'k', 'M', 'B'];
/** 950, 12.3k, 164k, 2.4M: a value that rounds to 1000 moves up a unit. */
export function short(n: number) {
  let unit = 0, value = n;
  const round = (v: number) => v >= 100 || !unit ? Math.round(v) : Number(v.toFixed(1));
  while (unit < UNITS.length - 1 && round(value) >= 1000) { value /= 1000; unit++; }
  return `${round(value)}${UNITS[unit]}`;
}
/** The one line that says it all, as the terminal has it. */
export const headline = ({ usage, cached }: Used) => `${dollars(usage.cost.total)} estimated · ${short(usage.totalTokens)} tokens · ${cached}% cached`;
/** A line of the table: what it cost, its share of the whole, the tokens that came out and how much of what went in was cached. */
const figures = ({ usage, cached }: Used, total: number) => ({ cost: dollars(usage.cost.total), share: `${total ? Math.round(100 * usage.cost.total / total) : 0}%`, out: short(usage.output), cached: `${cached}%` });
/** The table: the roles that used something, in their order, each with its models, the dearest first, and the model's name
 * where a role has `only` one: its line and the role's are then the same. */
export function breakdown({ usage: { cost: { total } }, roles }: Pick<Usage, 'usage' | 'roles'>) {
  return ROLES.flatMap(names => roles.filter(({ role }) => role === names.role).map(role => ({
    ...names, dollars: role.usage.cost.total, ...figures(role, total), only: role.models.length === 1 ? role.models[0].model : undefined,
    models: role.models.toSorted((a, b) => b.usage.cost.total - a.usage.cost.total).map(model => ({ model: model.model, ...figures(model, total) })),
  })));
}

/** When a bar begins, as its label: the time for a bar of minutes or an hour, with the day where the bars are of more than one;
 * the day, or the month, for longer ones. In the words of `locale` and by the clock of `timeZone`: the reader's, unless said. */
export function when(start: string, step: Usage['step'], many = false, locale?: string, timeZone?: string) {
  const time = { hour: '2-digit', minute: '2-digit' } as const, day = { day: 'numeric', month: 'short' } as const;
  const format: Intl.DateTimeFormatOptions = step === 'month' ? { month: 'short', year: 'numeric' } : step === 'day' ? day : many ? { ...day, ...time } : time;
  return new Date(start).toLocaleString(locale, { ...format, timeZone });
}
/** The bars over time: each bar's height as a share of the tallest, its parts by role from the bottom up, and what it says
 * when pointed at. `ends` are the labels under the first and the last bar. */
export function chart({ bars, step }: Pick<Usage, 'bars' | 'step'>, locale?: string, timeZone?: string) {
  const whole = (bar: Usage['bars'][number]) => ROLES.reduce((total, { role }) => total + bar.cost[role], 0), peak = Math.max(0, ...bars.map(whole));
  const label = (start: string, many: boolean) => when(start, step, many, locale, timeZone);
  // Bars of minutes or hours that go past midnight say which day each is of.
  const days = new Set(bars.map(bar => when(bar.start, 'day', false, locale, timeZone))).size > 1;
  return {
    peak: dollars(peak), ends: bars.length ? [label(bars[0].start, days), label(bars.at(-1)!.start, days)] : [],
    bars: bars.map(bar => ({
      start: bar.start, title: `${label(bar.start, days)} · ${dollars(whole(bar))} · ${short(bar.tokens)} tokens`, height: peak ? whole(bar) / peak : 0,
      parts: ROLES.flatMap(({ role, colour }) => bar.cost[role] > 0 ? [{ role, colour, share: bar.cost[role] / whole(bar) }] : []),
    })),
  };
}
