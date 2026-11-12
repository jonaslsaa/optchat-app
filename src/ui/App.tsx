import { CheckIcon, PanelLeftIcon, XIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Composer } from './Composer.tsx';
import { matches } from './keys.ts';
import { Sidebar, title } from './Sidebar.tsx';
import { app, mainOf, useApp, type State } from './store.ts';
import { Timeline } from './Timeline.tsx';
import { chat, idle, logged, said } from './transcript.ts';
import { Button, cn } from './ui.tsx';

/** The open profiles, as tabs. They are shown only once there are two: a profile is something you pick once. */
function Tabs({ state }: { state: State }) {
  return (
    <div role="tablist" aria-label="Profiles" className="flex h-9 shrink-0 items-center gap-1 border-b bg-sidebar px-2">
      {state.tabs.map(tab => (
        <div key={tab} className={cn('group/tab flex h-6 max-w-44 shrink-0 items-center rounded-md text-xs', tab === state.profile ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
          <button type="button" role="tab" aria-selected={tab === state.profile} onClick={() => void app.openProfile(tab)} className="min-w-0 truncate rounded-md py-1 pr-1 pl-2 font-medium focus-visible:ring-2 focus-visible:ring-ring">{tab}</button>
          <button type="button" aria-label={`Close ${tab}`} onClick={() => app.closeTab(tab)} className="mr-1 rounded-sm p-0.5 opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/tab:opacity-100"><XIcon className="size-3" /></button>
        </div>
      ))}
    </div>
  );
}
/** One profile: its windows on the left, and the selected window's chat. */
function Profile({ state, profile }: { state: State; profile: string }) {
  const [sidebar, setSidebar] = useState(() => innerWidth >= 768);
  const windows = state.windows.filter(window => window.profile === profile);
  const window = windows.find(w => w.id === state.selected[profile]) ?? windows.find(w => w.id === mainOf(profile));
  const live = (window && state.live[window.id]) ?? idle(), log = state.logs[profile], session = window && state.sessions[window.id];
  // The main chat is the profile's log. A connected window's conversation is only in its Pi until it is handed off.
  const own = window?.role === 'connected';
  const base = useMemo(() => own ? (session ?? []).flatMap(message => said(message)) : logged(log?.entries ?? []), [own, session, log]);
  const items = useMemo(() => chat(base, live), [base, live]);

  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      const ordered = [...windows.filter(w => w.id === mainOf(profile)), ...windows.filter(w => w.id !== mainOf(profile))];
      const digit = ordered.findIndex((_, index) => matches(event, `alt+${index + 1}`));
      if (matches(event, 'mod+shift+o')) void app.newWindow(profile);
      else if (matches(event, 'mod+b')) setSidebar(shown => !shown);
      else if (digit >= 0) app.select(ordered[digit].id);
      else return;
      event.preventDefault();
    };
    addEventListener('keydown', pressed);
    return () => removeEventListener('keydown', pressed);
  });
  if (!window) return <p className="m-auto text-muted-foreground text-sm">Opening {profile}…</p>;
  const more = !own && log && log.entries.length > 0 && log.entries[0].i > 0;
  return (
    <div className="flex min-h-0 flex-1">
      {sidebar && <div className="max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl"><Sidebar state={state} profile={profile} selected={window.id} /></div>}
      {sidebar && <button type="button" aria-label="Close the sidebar" onClick={() => setSidebar(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden" />}
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-(--topbar-height) shrink-0 items-center gap-2 px-3 sm:px-5">
          <Button variant="ghost-muted" size="icon-sm" aria-label="Toggle the sidebar" aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)}><PanelLeftIcon /></Button>
          <h1 className="min-w-0 truncate font-medium text-sm">{title(window, state)}</h1>
          {window.role === 'connected' && <span className="shrink-0 rounded-full border px-2 py-0.5 text-2xs text-muted-foreground">{window.completed ? 'Completed' : 'Connected window'}</span>}
          <span className="flex-1" />
          {window.role === 'connected' && window.owner === false && !window.completed && <Button variant="outline" size="sm" onClick={() => void app.complete(window.id)}><CheckIcon />Complete</Button>}
        </header>
        <Fragment key={window.id}>
          <Timeline items={items} live={live} profile={profile} loading={log?.loading} older={more ? () => void app.older(profile) : undefined}
            empty={window.role === 'main' ? 'Send a message to start the conversation.' : window.completed ? 'Completed. The main chat has this conversation; your next message starts a new one.' : 'A connected window: its own conversation, with this profile\'s memory. Complete hands it to the main chat.'} />
          <Composer window={window} live={live} />
        </Fragment>
      </main>
    </div>
  );
}
export function App() {
  const state = useApp();
  useEffect(() => {
    // Read the log again when you come back to the page: a Pi in a terminal may have written to it.
    const back = () => { if (document.visibilityState === 'visible' && app.state.profile) void app.openProfile(app.state.profile); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);
  return (
    <div className="flex h-dvh flex-col">
      {state.tabs.length > 1 && <Tabs state={state} />}
      {state.connection === 'lost' && <p role="status" className="shrink-0 bg-warning-surface px-4 py-1.5 text-center text-warning-foreground text-xs">The server is not answering. Trying again…</p>}
      {state.error && (
        <p role="alert" className="flex shrink-0 items-center justify-center gap-2 bg-error-surface px-4 py-1.5 text-error-foreground text-xs">
          <span className="min-w-0 truncate">{state.error}</span><button type="button" aria-label="Dismiss" onClick={() => app.dismiss()} className="rounded-sm p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
        </p>
      )}
      {state.profile ? <Profile key={state.profile} state={state} profile={state.profile} />
        : state.connection === 'connecting' ? <p className="m-auto text-muted-foreground text-sm">Connecting…</p>
        : <div className="m-auto max-w-sm text-center text-sm"><p className="font-medium">No profiles yet</p><p className="mt-1 text-muted-foreground">A profile is one chat that never ends. Create the first one in a terminal with <code className="rounded bg-foreground/10 px-1 py-0.5 text-[0.85em]">pi --optchat-profile work</code>, then reload.</p></div>}
    </div>
  );
}
