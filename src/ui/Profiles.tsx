import { CheckIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { app, type State } from './store.ts';
import { cn } from './ui.tsx';

/** A button that opens the list of profiles. Picking one opens it, in a tab of its own beside those already open. */
export function ProfilePicker({ state, label, className, children }: { state: State; label: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setOpen(false); };
    // Esc closes the menu and nothing else: it is taken before the shortcut that stops the agent hears it.
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setOpen(false); } };
    addEventListener('pointerdown', outside); addEventListener('keydown', escape, true);
    return () => { removeEventListener('pointerdown', outside); removeEventListener('keydown', escape, true); };
  }, [open]);
  return (
    <div ref={menu} className="relative shrink-0">
      <button type="button" aria-label={label} title={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className={className}>{children}</button>
      {open && (
        <ul role="listbox" aria-label="Profiles" className="absolute top-full left-0 z-50 mt-1 max-h-80 w-56 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {state.profiles.map(name => (
            <li key={name} role="option" aria-selected={name === state.profile}>
              <button type="button" autoFocus={name === state.profile} onClick={() => { setOpen(false); void app.openProfile(name); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <span className="min-w-0 flex-1 truncate">{name}</span>{name === state.profile && <CheckIcon className="size-3.5 text-muted-foreground" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
/** The one open profile, named in the title bar: with a single profile there is no tab bar, and this is where a second one is opened. */
export function ProfileName({ state, profile }: { state: State; profile: string }) {
  return (
    <ProfilePicker state={state} label="Open a profile" className="flex h-7 max-w-40 items-center gap-1 rounded-md px-1.5 text-muted-foreground text-sm hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <span className="min-w-0 truncate">{profile}</span><ChevronsUpDownIcon className="size-3 shrink-0" />
    </ProfilePicker>
  );
}
/** The open profiles, as tabs, and a button to open another. They are shown only once there are two: a profile is something
 * you pick once. */
export function Tabs({ state }: { state: State }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-sidebar px-2">
      <div role="tablist" aria-label="Profiles" className="flex min-w-0 items-center gap-1">
        {state.tabs.map(tab => (
          <div key={tab} className={cn('group/tab flex h-6 max-w-44 min-w-0 items-center rounded-md text-xs', tab === state.profile ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
            <button type="button" role="tab" aria-selected={tab === state.profile} onClick={() => void app.openProfile(tab)} className="min-w-0 truncate rounded-md py-1 pr-1 pl-2 font-medium focus-visible:ring-2 focus-visible:ring-ring">{tab}</button>
            <button type="button" aria-label={`Close ${tab}`} onClick={() => app.closeTab(tab)} className="mr-1 rounded-sm p-0.5 opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/tab:opacity-100"><XIcon className="size-3" /></button>
          </div>
        ))}
      </div>
      <ProfilePicker state={state} label="Open a profile" className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <PlusIcon className="size-3.5" />
      </ProfilePicker>
    </div>
  );
}
