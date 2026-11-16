import type { ModelChoice } from 'pi-optchat/files';
import type { Offered, Setting } from '../protocol.ts';
import { listed, picked } from './models.ts';

/** The form over a profile's settings, with no DOM: what a field shows of a setting, and what was typed in one as the value
 * pi-optchat keeps. Whether a value will do is pi-optchat's to say, so nothing here checks a range. */

/** How hard a model thinks: pi-optchat's levels, in its order. They mirror pi-optchat's `THINKING`, which the page cannot load:
 * `pi-optchat/files` is for Node only (`test/config-ui.test.ts` fails when the two differ). */
export const THINKING = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } satisfies Record<ModelChoice['thinking'], string>;
export const LEVELS = Object.keys(THINKING) as ModelChoice['thinking'][];

/** A number as its field has it. A percent is kept as a fraction of 1, and shown and typed as a percentage. */
export const field = ({ kind }: Setting, value: number) => String(kind === 'percent' ? Math.round(value * 1000) / 10 : value);
/** What a field's number is of: "%", "KB", or nothing. */
export const unit = ({ kind, unit }: Setting) => kind === 'percent' ? '%' : unit ?? '';
/** A value in words, as pi-optchat's own settings page says it: "on", "30%", "16 KB". A percent mirrors pi-optchat's `percent`,
 * which the page cannot load: `pi-optchat/files` is for Node only (`test/config-ui.test.ts` fails when the two differ). */
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
/** What a model written in the field asks for: it at `thinking`, or at the nearest level it has where Pi lists it without
 * that one, as picking it in a chat does. A running Pi refuses a model at a level it has not in the words it has for a model
 * it does not list, so it is not asked for one. A model Pi does not list is asked for as written: pi-optchat says if it will do. */
export function asked(models: readonly Offered[], text: string, thinking: ModelChoice['thinking']) {
  const written = model(text), choice = written && { ...written, thinking }, found = listed(models, choice);
  return found ? picked(found, choice) : choice;
}
/** The levels to choose from for a model: the ones it has where Pi lists it, with the one it is kept at, and else all of them. */
export function offered(models: readonly Offered[], kept: ModelChoice) {
  const found = listed(models, kept);
  return LEVELS.filter(level => !found || found.levels.includes(level) || level === kept.thinking);
}
