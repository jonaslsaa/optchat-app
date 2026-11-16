import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { levels, THINKING } from '../models.ts';
import type { ModelChoice, Offered, Result } from '../protocol.ts';
import { Pi } from './pi.ts';
import type { Launch } from './setup.ts';

/** Pi's answers to `get_available_models` and `get_state` (its docs: rpc.md), as much of them as the app reads. */
const Listed = Type.Object({ models: Type.Array(Type.Object({
  provider: Type.String(), id: Type.String(), name: Type.String(), reasoning: Type.Boolean(),
  thinkingLevelMap: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
})) });
const State = Type.Object({ model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })), thinkingLevel: Type.Enum([...THINKING]) });

/** The models a Pi can use: those of the providers it has credentials for, each with the levels it can think at. */
export async function offered(pi: Pi): Promise<Offered[]> {
  const answer = await pi.request({ type: 'get_available_models' });
  if (!Value.Check(Listed, answer)) throw new Error('Pi\'s list of models is not one this app knows. Update Pi or the app.');
  return answer.models.map(model => ({ provider: model.provider, id: model.id, name: model.name, levels: levels(model) }));
}
/** What a Pi runs on now, or nothing when it has no model: one with no provider logged in. */
export async function chosen(pi: Pi): Promise<ModelChoice | undefined> {
  const state = await pi.request({ type: 'get_state' });
  return Value.Check(State, state) && state.model ? { provider: state.model.provider, model: state.model.id, thinking: state.thinkingLevel } : undefined;
}
/** Both, where there is no Pi to ask, of one started for the question and stopped after it: it opens no session, loads no
 * extension and goes nowhere on the network. What it runs on is Pi's own default, which a Pi started now begins on unless
 * something says otherwise. A provider only an extension adds is not in its list; a window's own Pi lists that too. It is
 * ended when `signal` says the server is closing, and after half a minute without an answer. */
export async function catalog(launch: Launch, cwd: string, signal: AbortSignal): Promise<Result<'models'>> {
  signal.throwIfAborted();
  const pi = new Pi({ ...launch, args: [...launch.args, '--no-session', '--offline', '--no-extensions'], cwd, env: process.env }, () => {}, () => {});
  const end = () => void pi.stop(0), late = setTimeout(end, 30_000);
  signal.addEventListener('abort', end);
  try { return { models: await offered(pi), preset: await chosen(pi) }; } finally { clearTimeout(late); signal.removeEventListener('abort', end); await pi.stop(2000); }
}
