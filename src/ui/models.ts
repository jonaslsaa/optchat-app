import { clamp } from '../models.ts';
import type { ModelChoice, Offered } from '../protocol.ts';

/** What the page calls a provider of models: the ones Pi signs in to by name, any other by Pi's own word for it. */
const PROVIDERS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', 'openai-codex': 'OpenAI Codex', 'github-copilot': 'GitHub Copilot' };
export const provider = (id: string) => PROVIDERS[id] ?? id;

/** The model a choice names, among those Pi lists. */
export const listed = (models: readonly Offered[], choice?: ModelChoice) => models.find(model => model.provider === choice?.provider && model.id === choice.model);
/** Whether a model's level is worth saying: not for one that cannot think at any. */
export const thinks = (model?: Offered) => !model || model.levels.some(level => level !== 'off');
/** What picking a listed model asks for: it, thinking as hard as the model before it where it can, else at the nearest level
 * it has. */
export const picked = (model: Offered, now?: ModelChoice): ModelChoice => ({ provider: model.provider, model: model.id, thinking: clamp(model.levels, now?.thinking ?? 'medium') });

/** The models in the order they are shown: each provider's together, the providers in the order Pi lists them. */
export function arranged(models: readonly Offered[]) {
  const providers = [...new Set(models.map(model => model.provider))];
  return models.toSorted((a, b) => providers.indexOf(a.provider) - providers.indexOf(b.provider));
}
/** The models that match what was typed, the best first: every word has to be in the model's name, its id or its provider's
 * name, and a word that is the whole of one counts for more than one it begins with, that for more than one a word in it
 * begins with, and that for more than one found inside a word. A match in the name counts for more than one in the id, and
 * that for more than one in the provider's name. This is T3 Code's ranking (MIT, see THIRD_PARTY_NOTICES.md), without its
 * guessing at misspelt words. */
export function search(models: readonly Offered[], typed: string): Offered[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (model: Offered) => words.reduce((total, word) => total + Math.min(...[model.name, model.id, provider(model.provider)].map((field, k) => {
    const text = field.toLowerCase(), at = text.indexOf(word);
    return at < 0 ? Infinity : k * 10 + (text === word ? 0 : at === 0 ? 2 : /[\s\-_./]/.test(text[at - 1]) ? 4 : 6);
  })), 0);
  return arranged(models).map(model => ({ model, score: score(model) })).filter(({ score }) => score < Infinity).toSorted((a, b) => a.score - b.score).map(({ model }) => model);
}
