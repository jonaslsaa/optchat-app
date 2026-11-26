import { CheckIcon, SearchIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ModelChoice, Result, WindowState } from '../protocol.ts';
import { THINKING } from './config.ts';
import { useOverlay } from './keys.ts';
import { Mark } from './Mark.tsx';
import { arranged, listed, picked, provider, search, thinks } from './models.ts';
import { app, type State } from './store.ts';
import { Choice, cn, Options, ROW, stepped } from './ui.tsx';

/** A model as the page writes one: its provider's mark, its name (its id, until Pi's list is read), and how hard it thinks,
 * for one that can. The mark is the only colour in it. */
export function ModelName({ model, models }: { model: ModelChoice; models?: Result<'models'> }) {
  const found = listed(models?.models ?? [], model);
  return (
    <>
      <Mark provider={model.provider} />
      <span className="min-w-0 truncate">{found?.name ?? model.model}</span>
      {thinks(found) && <span className="shrink-0 font-normal text-muted-foreground">{THINKING[model.thinking]}</span>}
    </>
  );
}

const HEAD = 'flex h-8.25 shrink-0 items-center gap-2 border-border/70 border-b pb-1.5 text-sm';
/** The list a model is picked from: every model Pi can use, each provider's under its name, found by typing; beside it the
 * levels the picked model can think at. A click picks, and the list stays open for the level. The look and the keys are
 * T3 Code's model picker (MIT, see THIRD_PARTY_NOTICES.md): the arrows move through the models while the typing goes on, Enter
 * picks and goes to the levels, as → does without a pick, and ← comes back. What Pi or pi-optchat refuses is said under it.
 *
 * The switch under it says whose model it is: the window's own agent's (`own`), or that of the agents the profile's chats
 * start (`subagent`), which pi-optchat keeps in the profile and is the judge of: what it refuses is said in its words, and
 * one change is made at a time. */
function Picker({ window, models, own, subagent, place }: { window: WindowState; models?: Result<'models'>; own?: ModelChoice; subagent?: ModelChoice; place: Place }) {
  const [typed, setTyped] = useState(''), [moved, setMoved] = useState<number>();
  const [whose, setWhose] = useState<'own' | 'subagents'>('own'), [refused, setRefused] = useState<string>(), [keeping, setKeeping] = useState(false);
  const model = whose === 'own' ? own : subagent;
  useEffect(() => { void app.readConfig(window.profile); }, [window.profile]);
  const all = models?.models ?? [], now = listed(all, model), id = useId();
  const rows = useMemo(() => typed.trim() ? search(all, typed) : arranged(all), [all, typed]);
  // Until an arrow moves it, the one that would be picked is the model in use, or the best match of what is typed.
  const at = moved ?? Math.max(0, typed.trim() || !now ? 0 : rows.indexOf(now));
  const levels = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null);
  const radios = () => [...levels.current?.querySelectorAll<HTMLButtonElement>('[role=radio]') ?? []];
  // A picked model is followed by its level, so the focus goes there, as in T3 Code: to the level it thinks at, once the
  // levels are the picked model's. One that does not think leaves the focus with the typing.
  const leveled = useRef(false);
  const toLevels = () => (radios().find(radio => radio.ariaChecked === 'true') ?? radios()[0] ?? field.current)?.focus();
  useEffect(() => { if (leveled.current) toLevels(); }, [now, model?.thinking]);
  const pick = async (choice: ModelChoice, level = false) => {
    if (keeping) return;
    setRefused(undefined);
    if (!level) { leveled.current = true; toLevels(); }
    if (whose === 'own') return setRefused(await app.setModel(window.id, choice));
    setKeeping(true);
    setRefused(await app.configure(window.profile, 'subagent', choice));
    setKeeping(false);
  };
  const typing = (event: KeyboardEvent<HTMLInputElement>) => {
    const { key, currentTarget: { selectionStart, value } } = event;
    if (event.nativeEvent.isComposing) return;
    if (key === 'ArrowDown' || key === 'ArrowUp') { event.preventDefault(); setMoved(stepped(key, at, rows.length)); }
    else if (key === 'Enter' && rows[at]) { event.preventDefault(); void pick(picked(rows[at], model)); }
    else if (key === 'ArrowRight' && selectionStart === value.length) (radios().find(radio => radio.ariaChecked === 'true') ?? radios()[0])?.focus();
  };
  const leveling = (event: KeyboardEvent) => {
    const all = radios(), here = all.findIndex(radio => radio === document.activeElement);
    if (event.key === 'ArrowLeft') { event.preventDefault(); field.current?.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); all[(here + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
  };
  return (
    <div role="dialog" aria-label="Model" style={place.below ? { top: place.at, maxHeight: place.room } : { bottom: place.at, maxHeight: place.room }} className={cn('absolute right-0 z-50 flex w-[min(34.5rem,100%)] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] enter enter-grow', place.below ? 'origin-top-right' : 'origin-bottom-right')}>
      <div className="flex min-h-0 sm:h-86.5 max-sm:flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-sm:h-56 max-sm:flex-initial">
          <div className="shrink-0 px-3 pt-2.5">
            <label className={cn(HEAD, 'focus-within:border-ring')}>
              <SearchIcon className="size-4 shrink-0 text-muted-foreground/55" />
              <input ref={field} autoFocus role="combobox" aria-label="Search models" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={rows[at] ? `${id}-${at}` : undefined} placeholder="Search models…"
                value={typed} onChange={event => { setTyped(event.target.value); setMoved(undefined); }} onKeyDown={typing} onFocus={() => { leveled.current = false; }} className="h-6.5 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder" />
            </label>
          </div>
          <Options id={id} label="Models" rows={rows} at={at} selected={now} onPick={(row, k) => { setMoved(k); void pick(picked(row, model)); }}
            head={(row, k) => !typed.trim() && rows[k - 1]?.provider !== row.provider && <p className="px-2 pt-2 pb-1 font-medium text-2xs text-muted-foreground select-none">{provider(row.provider)}</p>}
            empty={!models ? 'Asking Pi for its models…' : all.length ? 'No models found' : 'Pi lists no model: no provider is logged in.'}>
            {row => (
              <>
                <Mark provider={row.provider} />
                <span className="min-w-0 truncate">{row.name}</span>
                {row === now && <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                {typed.trim() && <span className="ms-auto min-w-0 shrink truncate ps-2 text-muted-foreground/70 text-xs">{provider(row.provider)}</span>}
              </>
            )}
          </Options>
        </div>
        <div className="flex min-h-0 w-48 shrink-0 flex-col border-border/70 border-l bg-muted/40 max-sm:w-full max-sm:border-t max-sm:border-l-0">
          <div className="shrink-0 px-3 pt-2.5"><p className={HEAD}><span className="text-muted-foreground">Thinking</span></p></div>
          <div ref={levels} role="radiogroup" aria-label="Thinking" onKeyDown={leveling} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pt-2.5 pb-1.5 max-sm:flex-row max-sm:flex-wrap">
            {model && now && thinks(now) ? now.levels.map(level => (
              <button key={level} type="button" role="radio" aria-checked={level === model.thinking} tabIndex={level === model.thinking ? 0 : -1} onClick={() => void pick({ ...model, thinking: level }, true)}
                className={cn(ROW, 'shrink-0 hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] max-sm:w-auto')}>
                <span className="min-w-0 flex-1 truncate">{THINKING[level]}</span>{level === model.thinking && <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            )) : <p className="flex h-8 items-center px-2 text-muted-foreground text-sm">{now ? 'It does not think' : ''}</p>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/70 border-t bg-muted/40 px-3 py-2 text-xs">
        <Choice label="Whose model" name={`${id}-whose`} options={[[window.role === 'main' ? 'Main chat' : 'This window', 'own'], ['Subagents', 'subagents']]} value={whose} onChange={whose => { leveled.current = false; setWhose(whose); setMoved(undefined); setRefused(undefined); }} />
        {refused ? <p role="alert" className="min-w-0 flex-1 text-error-foreground [overflow-wrap:anywhere]">{refused}</p>
          : <p className="min-w-0 flex-1 truncate text-muted-foreground">{whose === 'subagents' ? 'The agents this profile\'s chats start' : window.role === 'main' ? 'Kept for this profile' : 'For this window only'}</p>}
      </div>
    </div>
  );
}

const GAP = 8;
/** Where the list opens: at the button, on the side with more room in the chat's column between its top bar and its foot (the
 * desktop app's notices are under it), and no taller than that room (`room`), so all of it is on the page and its list
 * scrolls. It is placed in the composer's box, its `offsetParent`, whose right edge it keeps, `at` from its edge: over the
 * button, or under the box, whose edge is just under the button. */
type Place = { below: boolean; at: number; room: number };
function placed(chip: HTMLElement): Place {
  const button = chip.getBoundingClientRect(), box = chip.offsetParent?.getBoundingClientRect() ?? button, column = chip.closest('main');
  // Not over the top bar: in the desktop app that drags the window, and would take the clicks.
  const top = column?.querySelector(':scope > header')?.getBoundingClientRect().bottom ?? 0, foot = Math.min(innerHeight, column?.getBoundingClientRect().bottom ?? innerHeight);
  const over = button.top - top - 2 * GAP, under = foot - box.bottom - 2 * GAP;
  return under > over ? { below: true, at: box.height + GAP, room: under } : { below: false, at: box.bottom - button.top + GAP, room: over };
}

/** The model the window's agent runs on and how hard it thinks, in the composer: a click opens the list it is picked from.
 * Before the window's Pi runs it says what that will start on: the pick, the model the profile keeps for its main chat, or
 * Pi's own default. The list is read when the window is shown, for the names, and again each time it is opened: logging in
 * to a provider adds its models. Esc closes the list and nothing else, and a click anywhere else closes it too
 * (`useOverlay`). The list opens at the button, over it or under it (`placed`), and is placed again wherever it may have moved. */
export function Model({ state, window }: { state: State; window: WindowState }) {
  const [open, setOpen] = useState<Place>(), root = useRef<HTMLDivElement>(null), chip = useRef<HTMLButtonElement>(null);
  const models = state.models[window.id], model = window.model ?? models?.preset;
  const shown = open !== undefined;
  useEffect(() => { if (shown || !models) void app.readModels(window.id); }, [window.id, shown]);
  useOverlay(shown, () => setOpen(undefined), root, chip);
  // Placed again wherever it may have moved: after each render (a draft typed, a notice, the first message taking the composer
  // to the foot of the page), and when the window, the composer or the chat's column change size.
  const again = () => {
    if (!chip.current) return;
    const now = placed(chip.current);
    setOpen(was => was && (JSON.stringify(was) === JSON.stringify(now) ? was : now));
  };
  useLayoutEffect(() => { if (shown) again(); });
  useEffect(() => {
    const at = chip.current;
    if (!shown || !at) return;
    const box = new ResizeObserver(again);
    for (const element of [at.offsetParent, at.closest('main')]) if (element) box.observe(element);
    addEventListener('resize', again);
    return () => { box.disconnect(); removeEventListener('resize', again); };
  }, [shown]);
  return (
    <div ref={root} className="flex min-w-0 shrink">
      <button ref={chip} type="button" aria-label="Model" title="Model and thinking level" aria-haspopup="dialog" aria-expanded={shown} aria-busy={!models} onClick={event => setOpen(open ? undefined : placed(event.currentTarget))}
        className="flex h-7 min-w-13 max-w-64 cursor-pointer items-center gap-1.5 rounded-[var(--control-radius)] px-2 font-medium text-foreground/80 text-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent aria-expanded:text-foreground">
        {model ? <ModelName model={model} models={models} /> : <><Mark /><span className="text-muted-foreground">Model</span></>}
      </button>
      {open && <Picker window={window} models={models} own={model} subagent={state.config[window.profile]?.subagent} place={open} />}
    </div>
  );
}
