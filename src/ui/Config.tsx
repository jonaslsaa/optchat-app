import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Config as Kept, ModelChoice, Offered, Params, Setting } from '../protocol.ts';
import { asked, field, LEVELS, model, named, offered, said, THINKING, typed, unit } from './config.ts';
import { app } from './store.ts';
import { Button, cn, Switch } from './ui.tsx';

/** A profile's settings as pi-optchat keeps them, a row for each one it has (`config.ts` has what a field shows and what
 * was typed in it), and the profile's instructions. A change is kept when you leave its field or press Enter, and pi-optchat
 * is its judge: what it refuses stays in the field with its reason under it. */

const FIELD = 'h-7 rounded-[var(--control-radius)] border border-input bg-popover px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32';
/** How keeping a change went: kept, with a `note` where what was kept is not quite what was asked for, or why not. */
type Outcome = { kept: true; note?: string } | { problem: string } | undefined;

/** Keeps a change to one thing of the profile, and says how that went. */
function useKeep(profile: string, key: string) {
  const [outcome, setOutcome] = useState<Outcome>();
  const keep = async (value: Params<'configure'>['value'], note?: string) => {
    const problem = await app.configure(profile, key, value);
    setOutcome(problem ? { problem } : { kept: true, note });
  };
  return [outcome, keep, setOutcome] as const;
}
/** One setting: what it is on the left, its field on the right, and under it what came of the last change. */
function Row({ label, description, applies, outcome, children }: { label: string; description: string; applies: string; outcome: Outcome; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-end gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56 text-sm">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
        {outcome && ('problem' in outcome ? <p role="alert" className="mt-1 text-error-foreground text-xs">{outcome.problem}</p> : <p role="status" className="mt-1 text-success-foreground text-xs">Saved. {outcome.note && `${outcome.note} `}{applies}</p>)}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}
/** A field that keeps what is typed in it when you press Enter, or leave it having changed it, if that is not what it had
 * (`onSame` when it is). Enter leaves the focus where it is. */
function Typed({ label, kept, className, list, placeholder, unit, field, onKeep, onSame }: { label: string; kept: string; className: string; list?: string; placeholder?: string; unit?: string; field?: Ref<HTMLInputElement>; onKeep: (text: string) => void; onSame: () => void }) {
  const [text, setText] = useState(kept), changed = useRef(false);
  useEffect(() => setText(kept), [kept]);
  // A field left empty, or as it was, goes back to what it had.
  const keep = () => { changed.current = false; if (!text.trim() || text.trim() === kept) { setText(kept); onSame(); } else onKeep(text); };
  return (
    <label className={cn(FIELD, 'flex items-center gap-1.5 focus-within:ring-2 focus-within:ring-ring', className)}>
      <input ref={field} aria-label={label} value={text} list={list} placeholder={placeholder} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={event => { setText(event.target.value); changed.current = true; }} onBlur={() => { if (changed.current) keep(); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) keep(); }} className="min-w-0 flex-1 bg-transparent text-inherit outline-none [text-align:inherit] placeholder:font-sans placeholder:text-muted-foreground" />
      {unit && <span className="text-muted-foreground text-xs">{unit}</span>}
    </label>
  );
}
function One({ profile, setting }: { profile: string; setting: Setting }) {
  const [outcome, keep, setOutcome] = useKeep(profile, setting.key), { label, value } = setting;
  return (
    <Row label={label} description={`${setting.description} Default: ${said(setting, setting.default)}.`} applies={setting.applies} outcome={outcome}>
      {typeof value === 'boolean' ? (
        <Switch label={label} checked={value} onChange={on => void keep(on)} />
      ) : (
        <Typed label={label} kept={field(setting, value)} unit={unit(setting)} className="w-28 text-right tabular-nums" onSame={() => setOutcome(undefined)} onKeep={text => {
          const number = typed(setting, text);
          if (number === undefined) setOutcome({ problem: `${label} must be a number.` }); else void keep(number);
        }} />
      )}
    </Row>
  );
}
/** The model that writes the profile's summaries: written `provider/id`, with the models Pi lists to choose from, and how
 * hard it thinks. The chat's own model, and its agents', are chosen in the chat. */
function Compactor({ profile, kept, standard, models }: { profile: string; kept: Kept['compactor']; standard: Kept['standard']; models: readonly Offered[] }) {
  const [outcome, keep, setOutcome] = useKeep(profile, 'compactor'), list = useId(), field = useRef<HTMLInputElement>(null), [fresh, setFresh] = useState(0);
  // The model at a level it has, and a word about it where that is not the level it was asked for at.
  const ask = (text: string, thinking: ModelChoice['thinking']) => {
    const choice = asked(models, text, thinking);
    if (!choice) setOutcome({ problem: 'A model is written provider/id, as in anthropic/claude-sonnet-5-5.' });
    else void keep(choice, choice.thinking === thinking ? undefined : `Thinking is ${THINKING[choice.thinking]}: this model has no ${THINKING[thinking]}.`);
  };
  return (
    <Row label="Compactor model" description={`Writes summaries, imports and fallback handoffs. Default: ${named(standard)} · ${standard.thinking}.`} applies="Applies to the next summary." outcome={outcome}>
      <Typed key={fresh} label="Compactor model" kept={named(kept)} field={field} list={list} placeholder="provider/model" className="w-60 font-mono text-xs" onSame={() => setOutcome(undefined)} onKeep={text => ask(text, kept.thinking)} />
      <datalist id={list}>{models.map(({ provider, id }) => named({ provider, model: id })).map(name => <option key={name} value={name} />)}</datalist>
      <select aria-label="Compactor thinking" value={kept.thinking} className={cn(FIELD, 'px-1.5')}
        onChange={event => {
          // With the model as it stands in the field: one that was refused is asked for again with this level. What is no
          // model is not: the saved one is, which the field is then given again.
          const thinking = LEVELS.find(level => level === event.target.value), text = field.current?.value ?? '';
          if (thinking && model(text)) ask(text, thinking);
          else if (thinking) { setFresh(fresh + 1); ask(named(kept), thinking); }
        }}>
        {offered(models, kept).map(level => <option key={level} value={level}>{THINKING[level]}</option>)}
      </select>
    </Row>
  );
}
export function Config({ profile, config, models }: { profile: string; config: Kept; models: readonly Offered[] }) {
  return (
    <ul className="divide-y">
      <Compactor profile={profile} kept={config.compactor} standard={config.standard} models={models} />
      {config.settings.map(setting => <One key={setting.key} profile={profile} setting={setting} />)}
    </ul>
  );
}
/** The profile's instructions, kept whole when you say so: they are long, and half of one is not one. */
export function Instructions({ profile, kept }: { profile: string; kept: string }) {
  const [text, setText] = useState(kept), [outcome, setOutcome] = useState<Outcome>();
  useEffect(() => setText(kept), [kept]);
  const keep = async () => { const problem = await app.instruct(profile, text); setOutcome(problem ? { problem } : { kept: true }); };
  return (
    <>
      <textarea aria-label="Instructions" value={text} rows={10} spellCheck={false} onChange={event => { setText(event.target.value); setOutcome(undefined); }}
        className={cn(FIELD, 'block h-auto w-full resize-y py-2 font-mono text-xs leading-relaxed')} />
      <p className="mt-2 flex items-center gap-3 text-xs">
        <Button variant="outline" disabled={text === kept} onClick={() => void keep()}>Save</Button>
        {outcome && ('problem' in outcome ? <span role="alert" className="text-error-foreground">{outcome.problem}</span> : <span role="status" className="text-success-foreground">Saved. Applies from the next turn.</span>)}
      </p>
    </>
  );
}
