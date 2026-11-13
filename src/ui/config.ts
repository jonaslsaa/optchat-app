import type { ModelChoice } from 'pi-optchat/files';
import type { Setting } from '../protocol.ts';

/** The form over a profile's settings, with no DOM: what a field shows of a setting, and what was typed in one as the value
 * pi-optchat keeps. Whether a value will do is pi-optchat's to say, so nothing here checks a range. */

/** How hard a model thinks: pi-optchat's levels, in its order. */
export const THINKING = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } satisfies Record<ModelChoice['thinking'], string>;
export const LEVELS = Object.keys(THINKING) as ModelChoice['thinking'][];

/** A number as its field has it. A percent is kept as a fraction of 1, and shown and typed as a percentage. */
export const field = ({ kind }: Setting, value: number) => String(kind === 'percent' ? Math.round(value * 1000) / 10 : value);
/** What a field's number is of: "%", "KB", or nothing. */
export const unit = ({ kind, unit }: Setting) => kind === 'percent' ? '%' : unit ?? '';
/** A value in words, as pi-optchat's own settings page says it: "on", "30%", "16 KB". */
export function said(setting: Setting, value: Setting['value']) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return `${field(setting, value)}${setting.kind === 'percent' ? '%' : unit(setting) && ` ${unit(setting)}`}`;
}
/** What was typed in a number's field, as the value pi-optchat keeps; nothing when it is no number at all. */
export function typed({ kind }: Setting, text: string) {
  const number = Number(text.trim().replace(/\s*%$/, '') || NaN);
  if (!Number.isFinite(number)) return undefined;
  return kind === 'percent' ? Math.round(number * 10) / 1000 : number;
}
/** A model as it is written: its provider, a slash, its id. */
export const named = ({ provider, model }: Pick<ModelChoice, 'provider' | 'model'>) => `${provider}/${model}`;
/** A model as it was typed. Its id may have a slash in it; a provider has none. */
export function model(text: string): Pick<ModelChoice, 'provider' | 'model'> | undefined {
  const name = text.trim(), slash = name.indexOf('/');
  return slash > 0 && slash < name.length - 1 ? { provider: name.slice(0, slash), model: name.slice(slash + 1) } : undefined;
}
