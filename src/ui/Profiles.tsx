import { CheckIcon, ChevronsUpDownIcon, HistoryIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { badge } from './badge.ts';
import { useOverlay, walk } from './keys.ts';
import { app, type State } from './store.ts';
import { Button, cn, Spinner, WindowDot } from './ui.tsx';

/** A new profile: a name, and pi-optchat makes it and says why when it will not (a name that will not do, or one there is
 * already), which is said under the name. Once made it is opened, beside those that are open. The first profile is named
 * with it, in the setup, and every later one in the New Profile dialog, which has a way out (`onCancel`). `onMade`: the
 * profile is there, and is opened next. */
export function NewProfile({ onMade, onCancel }: { onMade?: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(''), [making, setMaking] = useState(false), [refused, setRefused] = useState<string>(), field = useRef<HTMLInputElement>(null);
  const make = (event: FormEvent) => {
    event.preventDefault();
    const made = name.trim();
    setMaking(true);
    void app.createProfile(made).then(why => {
      setMaking(false);
      setRefused(why);
      // The button is off while it is asked, and loses the focus with that: a name that was refused is put right in its field.
      if (why !== undefined) return field.current?.focus();
      onMade?.();
      void app.openProfile(made);
    });
  };
  return (
    <form onSubmit={make} className={cn('mt-2 flex flex-wrap items-center gap-2', onCancel && 'justify-end')}>
      <input ref={field} aria-label="Profile name" value={name} onChange={event => { setName(event.target.value); setRefused(undefined); }} placeholder="work" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={64}
        className={cn('h-7 rounded-md border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring', onCancel ? 'w-full' : 'w-48')} />
      {refused && <p role="alert" className={cn('enter w-full text-error-foreground text-xs', !onCancel && 'order-last')}>{refused}</p>}
      {onCancel && <Button variant="ghost-muted" onClick={onCancel}>Cancel</Button>}
      <Button type="submit" variant="outline" disabled={making || !name.trim()}>{making ? <Spinner /> : <PlusIcon />}Create profile</Button>
    </form>
  );
}
/** New Profile…: another profile's name, in a dialog over the page. Esc, Cancel or a press beside it puts it away with
 * nothing made, and Esc does nothing else (`useOverlay`): a run in the chat behind it goes on, as it does while the profile
 * is made and opened beside it. It is closed before the new profile is opened, so the keys are in that profile's chat. */
export function NewProfileDialog({ onClose, onMade }: { onClose: () => void; onMade: () => void }) {
  const box = useRef<HTMLDialogElement>(null), inside = useRef<HTMLDivElement>(null), close = () => box.current?.close();
  useEffect(() => box.current?.showModal(), []);
  // Closed as a dialog is, which is what gives the focus back to where it was: there is no button of its own to give it to.
  useOverlay(true, close, inside, useRef(null));
  return (
    <dialog ref={box} aria-label="New profile" onClose={onClose} className="enter enter-grow m-auto w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl outline-none backdrop:enter backdrop:bg-black/20 dark:backdrop:bg-black/60">
      <div ref={inside} className="p-4">
        <h2 className="font-medium text-sm">New profile</h2>
        <p className="mt-1 text-muted-foreground text-xs">A profile is one chat that never ends, with a memory of its own. Its name: lowercase letters, digits, hyphens and underscores.</p>
        <NewProfile onMade={() => { close(); onMade(); }} onCancel={close} />
      </div>
    </dialog>
  );
}

/** A button that opens the list of profiles. Picking one opens it, in a tab of its own beside those already open, and under
 * them is where a new one is made (`onNew`). The arrows walk the list, round its ends; Esc closes it and nothing else
 * (`useOverlay`). */
export function ProfilePicker({ state, label, className, children, onNew, onImport }: { state: State; label: string; className?: string; children: ReactNode; onNew: () => void; onImport: () => void }) {
  const [open, setOpen] = useState(false), menu = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null);
  useOverlay(open, () => setOpen(false), menu, opener);
  return (
    <div ref={menu} className="relative shrink-0">
      <button ref={opener} type="button" aria-label={label} title={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className={className}>{children}</button>
      {open && (
        <ul role="listbox" aria-label="Profiles" onKeyDown={walk} className="enter enter-grow absolute top-full left-0 z-50 mt-1 max-h-80 w-56 origin-top-left overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {state.profiles.map(name => (
            <li key={name} role="option" aria-selected={name === state.profile}>
              <button type="button" autoFocus={name === state.profile} onClick={() => { setOpen(false); void app.openProfile(name); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <span className="min-w-0 flex-1 truncate">{name}</span>{name === state.profile && <CheckIcon className="size-3.5 text-muted-foreground" />}
              </button>
            </li>
          ))}
          {/* Always in sight, under however many profiles the list scrolls through. The focus goes back to the button first,
              which is where it is again once the dialog or the Import page is closed. */}
          <li role="presentation" className="sticky -bottom-1 mt-1 border-t bg-popover py-1">
            <button type="button" onClick={() => { setOpen(false); opener.current?.focus(); onNew(); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground text-sm hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none">
              <PlusIcon className="size-3.5" />New profile…
            </button>
            {state.profile && (
              <button type="button" title={`Import another tool's history into ${state.profile}`} onClick={() => { setOpen(false); opener.current?.focus(); onImport(); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground text-sm hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none">
                <HistoryIcon className="size-3.5" /><span className="min-w-0 truncate">Import history…</span>
              </button>
            )}
          </li>
        </ul>
      )}
    </div>
  );
}
/** A profile's badge: its letters in its colour, on a tint of that. Drawn as T3 Code draws a project's (`ProjectMonogram`): text
 * in an SVG is set on its baseline, so the capitals stand in the tile's middle, which a centred line of text does not give.
 * It is there to tell profiles apart at a glance, and says nothing the name beside it does not. */
function ProfileBadge({ profile }: { profile: string }) {
  const { letters, colour } = badge(profile);
  return (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center">
      <svg viewBox="0 0 16 16" className={cn('size-full select-none overflow-hidden rounded-[25%] font-mono', colour)} style={{ backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)' }}>
        <text x="8" y="10.8" textAnchor="middle" fill="currentColor" fontSize="8.25" fontWeight="700" textLength={letters.length === 1 ? 6 : 12} lengthAdjust="spacingAndGlyphs" textRendering="geometricPrecision">{letters}</text>
      </svg>
    </span>
  );
}
/** The one open profile, named in the title bar: with a single profile there is no tab bar, and this is where a second one is opened. */
export function ProfileName({ state, profile, onNew, onImport }: { state: State; profile: string; onNew: () => void; onImport: () => void }) {
  return (
    <ProfilePicker state={state} label="Open a profile" onNew={onNew} onImport={onImport} className="flex h-7 max-w-40 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground text-sm hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <ProfileBadge profile={profile} /><span className="min-w-0 truncate">{profile}</span><ChevronsUpDownIcon className="size-3 shrink-0" />
    </ProfilePicker>
  );
}
/** The open profiles, as tabs, and a button to open another. They are shown only once there are two: a profile is something
 * you pick once. The tab in front looks like part of the page under it, and a tab says when a window of its profile is working
 * or has failed, since its windows are out of sight. */
export function Tabs({ state, onNew, onImport }: { state: State; onNew: () => void; onImport: () => void }) {
  return (
    <div className="window-bar window-start flex h-10 shrink-0 items-center gap-1 border-b bg-sidebar px-2 in-data-shell:h-(--topbar-height)">
      <div role="tablist" aria-label="Profiles" className="flex min-w-0 items-center gap-1">
        {state.tabs.map(tab => (
          <div key={tab} className={cn('group/tab flex h-7 max-w-48 min-w-0 items-center rounded-md border text-sm', tab === state.profile ? 'border-border bg-background text-foreground shadow-xs' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <button type="button" role="tab" aria-selected={tab === state.profile} onClick={() => void app.openProfile(tab)} className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1 pl-2.5 font-medium focus-visible:ring-2 focus-visible:ring-ring">
              <ProfileBadge profile={tab} /><WindowDot windows={state.windows.filter(window => window.profile === tab)} /><span className="min-w-0 truncate">{tab}</span>
            </button>
            <button type="button" aria-label={`Close ${tab}`} onClick={() => app.closeTab(tab)} className="mr-1 rounded-sm p-0.5 opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/tab:opacity-100"><XIcon className="size-3" /></button>
          </div>
        ))}
      </div>
      <ProfilePicker state={state} label="Open a profile" onNew={onNew} onImport={onImport} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <PlusIcon className="size-4" />
      </ProfilePicker>
    </div>
  );
}
