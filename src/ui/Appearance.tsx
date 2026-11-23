import { FolderOpenIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import type { Settings } from '../protocol.ts';
import { Section } from './Settings.tsx';
import { app, type State } from './store.ts';
import { BUILT_IN } from './theme.ts';
import { chosen, OWN, OWN_NAME, type Appearance as Mode, type Colors, type Theme, type Unread } from './themes.ts';
import { Button, cn, Switch } from './ui.tsx';

/** The Appearance tab: light or dark, the theme drawn in each, the sidebar's drawing, your own themes' folder, and how the
 * reports of agents that arrive together are drawn. Where the tiles, the cards and their pictures come from:
 * THIRD_PARTY_NOTICES.md. */

const MODES = ['light', 'dark'] as const;
const SCHEMES = { system: 'System', light: 'Light', dark: 'Dark' } satisfies Record<Settings['theme'], string>;
/** What a picture of a theme shows, with the app's own colours where the theme has none. */
type Preview = Required<Pick<Colors, keyof typeof OWN.light>>;
const preview = (theme: Theme | undefined, mode: Mode): Preview => ({ ...OWN[mode], ...theme?.[mode] });
const LINE = 'rgb(127 127 127 / 0.25)';

/** A small window in a theme's colours: the sidebar, a message, the composer and a menu. */
function Pane({ colors: c, clip }: { colors: Preview; clip?: 'left' | 'right' }) {
  const box = (className: string, style: CSSProperties) => <span className={cn('absolute', className)} style={style} />;
  return (
    <span className="absolute inset-0" style={clip && { clipPath: clip === 'left' ? 'polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)' : 'polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)' }}>
      {box('inset-0', { backgroundColor: c.background })}
      {box('inset-y-0 left-0 w-[22%]', { backgroundColor: c.sidebar, boxShadow: `inset -1px 0 0 ${LINE}` })}
      {box('left-[3%] top-[8%] h-[8%] w-[16%] rounded-md', { backgroundColor: c.card, boxShadow: `inset 0 0 0 1px ${LINE}` })}
      {box('left-[3%] top-[22%] h-[7%] w-[16%] rounded-md', { backgroundColor: c.accent })}
      {box('left-[3%] top-[32%] h-[7%] w-[16%] rounded-md', { backgroundColor: c['message-surface'], opacity: 0.7 })}
      {box('left-[3%] top-[42%] h-[7%] w-[16%] rounded-md', { backgroundColor: c['message-surface'], opacity: 0.5 })}
      {box('right-[28%] top-[11%] h-[9%] w-[24%] rounded-lg', { backgroundColor: c['message-surface'] })}
      {box('left-[27%] top-[28%] h-[5%] w-[34%] rounded-sm', { backgroundColor: LINE })}
      {box('left-[27%] top-[38%] h-[5%] w-[26%] rounded-sm', { backgroundColor: LINE })}
      <span className="absolute right-[6%] bottom-[8%] left-[26%] flex h-[15%] items-center justify-between rounded-md px-1" style={{ backgroundColor: c.card, boxShadow: `inset 0 0 0 1px ${LINE}` }}>
        <span className="block h-[26%] w-[34%] rounded-full" style={{ backgroundColor: LINE, opacity: 0.7 }} />
        <span className="block aspect-square h-[58%] rounded-full" style={{ backgroundColor: c.primary }} />
      </span>
      <span className="absolute top-[8%] right-[5%] h-[46%] w-[20%] rounded-lg" style={{ backgroundColor: c.card, boxShadow: `inset 0 0 0 1px ${LINE}, 0 2px 5px rgb(0 0 0 / 0.14)` }}>
        {['#34d399', c.primary, '#fbbf24'].map((dot, row) => (
          <span key={row} className="absolute right-[11%] left-[11%] flex items-center gap-1" style={{ top: `${10 + row * 30}%`, height: '20%' }}>
            <span className="block aspect-square h-[26%] rounded-full" style={{ backgroundColor: dot, opacity: 0.55 }} />
            <span className="block h-[30%] w-[52%] rounded-sm" style={{ backgroundColor: LINE }} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** A theme in one appearance as a blurred round of its colours. */
const ROUND = {
  light: { base: '#ffffff', accent: [72, 22], fade: 72, action: [18, 82], edge: 'inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)' },
  dark: { base: '#09090b', accent: [28, 78], fade: 62, action: [82, 18], edge: 'inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)' },
} as const;
function Round({ colors: c, mode }: { colors: Preview; mode: Mode }) {
  const { base, accent, fade, action, edge } = ROUND[mode];
  return (
    <span aria-hidden="true" className="relative block size-14 shrink-0 overflow-hidden rounded-full border-2 border-background" style={{ boxShadow: edge }}>
      <span className="absolute inset-0 scale-110 rounded-full blur-[3px]" style={{
        backgroundColor: `color-mix(in oklab, ${c.background} 80%, ${base})`,
        backgroundImage: `radial-gradient(circle at ${accent[0]}% ${accent[1]}% in oklab, ${c.ring} 0%, color-mix(in oklab, ${c.ring} ${fade}%, transparent) 28%, transparent 58%), radial-gradient(circle at ${action[0]}% ${action[1]}% in oklab, color-mix(in oklab, ${c.primary} 45%, transparent) 0%, transparent 55%)`,
      }} />
    </span>
  );
}

/** A theme to pick: a click on the card draws it in both appearances it has, one on a round only in that one. A ring and a sun
 * or a moon mark the appearance it is drawn in. */
function Card({ id, name, theme, drawn }: { id?: string; name: string; theme?: Theme; drawn: (mode: Mode) => string | undefined }) {
  const modes = theme ? MODES.filter(mode => theme[mode]) : MODES, picked = (mode: Mode) => drawn(mode) === id;
  const use = (modes: readonly Mode[]) => void app.saveSettings({ palette: Object.fromEntries(modes.map(mode => [mode, id ?? null])) });
  const on = MODES.filter(picked).length === modes.length;
  return (
    <div data-theme={name} onClick={() => use(modes)} className={cn('cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-card/60 transition-colors hover:bg-accent/40', on && 'bg-accent/60 ring-1 ring-ring ring-inset')}>
      <div className="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
        {modes.map(mode => (
          <button key={mode} type="button" aria-label={`Use ${name} in ${mode} mode`} aria-pressed={picked(mode)} title={`Use for ${mode} mode only`} onClick={event => { event.stopPropagation(); use([mode]); }}
            className={cn('relative flex size-[68px] shrink-0 items-center justify-center rounded-full p-1.5 outline-none transition-transform focus-visible:outline-2 focus-visible:outline-foreground/60 focus-visible:-outline-offset-5', !picked(mode) && 'hover:scale-105')}>
            <Round colors={preview(theme, mode)} mode={mode} />
            {picked(mode) && <>
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-ring ring-inset" />
              <span aria-hidden="true" className="pointer-events-none absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm">
                {mode === 'light' ? <SunIcon className="size-3" /> : <MoonIcon className="size-3" />}
              </span>
            </>}
          </button>
        ))}
      </div>
      <div className="px-3 pt-2 pb-3">
        <button type="button" aria-label={`Use ${name}`} aria-pressed={on} title={modes.length > 1 ? 'Use for both light and dark' : `Use for ${modes[0]} mode only`} onClick={event => { event.stopPropagation(); use(modes); }}
          className="max-w-full cursor-pointer truncate rounded-sm text-left font-medium text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{name}</button>
      </div>
    </div>
  );
}
/** A file in the folder that is no theme, with why: it is never drawn. */
const Unreadable = ({ theme }: { theme: Unread }) => (
  <div data-theme={theme.id} className="flex min-h-[7.25rem] flex-col justify-center gap-1 rounded-xl border border-error/30 bg-error-surface px-3 py-3 text-sm">
    <span className="truncate font-medium text-foreground">{theme.id}</span>
    <span className="text-error-foreground text-xs">Not a theme. {theme.error}</span>
  </div>
);

const LAYOUTS = {
  tabs: ['Tabs', 'One report at a time, a tab for each agent. The card stays one report high.'],
  sections: ['Sections', 'All of them in one card, one under the other.'],
} satisfies Record<Settings['reports'], [title: string, about: string]>;
/** A card of reports as it is drawn in the chat, small and without words, in the page's own colours: a tab or a section for
 * each of three agents, the last of which failed. */
function Reports({ layout }: { layout: Settings['reports'] }) {
  const bar = (className: string) => <span className={cn('block h-1.5 shrink-0 rounded-full bg-muted-foreground/25', className)} />;
  const failed = <span className="block size-1.5 shrink-0 rounded-full bg-error-foreground/70" />;
  return (
    <span aria-hidden="true" data-preview={layout} className="relative block h-full min-h-[7.5rem] w-full overflow-hidden rounded-lg border border-border/60 bg-background p-3">
      <span key={layout} className="enter flex h-full flex-col gap-2 overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-2.5 dark:bg-card/60">
        <span className="flex items-center gap-1.5"><span className="block size-2 rounded-sm bg-muted-foreground/40" />{bar('w-10 bg-muted-foreground/40')}<span className="flex-1" />{bar('w-5')}</span>
        {layout === 'tabs' ? <>
          <span className="-mx-3 flex gap-2.5 border-border/70 border-b px-2.5">
            {['w-12', 'w-9', 'w-11'].map((width, index) => (
              <span key={index} className={cn('-mb-px flex items-center gap-1 border-b-2 pb-1.5', index === 0 ? 'border-foreground/70' : 'border-transparent')}>
                {index === 2 && failed}{bar(cn(width, index === 0 && 'bg-foreground/60'))}
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1.5">{bar('w-12 bg-foreground/45')}<span className="flex-1" />{bar('w-4')}</span>
          {bar('w-11/12')}{bar('w-4/5')}{bar('w-2/3')}
        </> : ['w-4/5', 'w-3/5', 'w-2/3'].map((width, index) => (
          <span key={index} className={cn('flex flex-col gap-1.5', index > 0 && 'border-border/70 border-t pt-2')}>
            <span className="flex items-center gap-1">{index === 2 && failed}{bar('w-12 bg-foreground/45')}<span className="flex-1" />{bar('w-4')}</span>
            {bar(width)}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Appearance({ state, settings }: { state: State; settings: Settings }) {
  // Your files are read again each time the tab is shown: one may have been added or changed since.
  useEffect(() => { void app.readThemes(); }, []);
  const all = [...BUILT_IN, ...state.themes?.files ?? []], drawn = (mode: Mode) => chosen(all, settings, mode);
  return (
    <>
      <Section title="Color scheme">
        <div role="radiogroup" aria-label="Color scheme" className="grid grid-cols-3 gap-3">
          {(Object.keys(SCHEMES) as Settings['theme'][]).map(scheme => (
            <label key={scheme} className={cn('flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foreground/60 has-[:focus-visible]:-outline-offset-7',
              settings.theme === scheme ? 'border-transparent bg-accent/60 ring-2 ring-ring ring-inset' : 'border-border/70 bg-card/60 hover:bg-accent/40')}>
              <input type="radio" name="scheme" className="sr-only" checked={settings.theme === scheme} onChange={() => void app.saveSettings({ theme: scheme })} />
              <span aria-hidden="true" className="relative block h-[7.5rem] w-full overflow-hidden rounded-[3px] border border-border/60">
                {scheme === 'system' ? <><Pane colors={preview(drawn('light'), 'light')} clip="left" /><Pane colors={preview(drawn('dark'), 'dark')} clip="right" /></> : <Pane colors={preview(drawn(scheme), scheme)} />}
              </span>
              <span className={cn('text-center font-medium text-xs', settings.theme === scheme ? 'text-foreground' : 'text-muted-foreground')}>{SCHEMES[scheme]}</span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Theme" hint="A click on a card uses it in light and dark, a click on one of its rounds only in that one.">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 12rem), 1fr))' }}>
          <Card name={OWN_NAME} drawn={mode => drawn(mode)?.id} />
          {all.map(theme => 'name' in theme ? <Card key={theme.id} id={theme.id} name={theme.name} theme={theme} drawn={mode => drawn(mode)?.id} /> : <Unreadable key={theme.id} theme={theme} />)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Your own themes are <a href="https://github.com/jonaslsaa/optchat-app/blob/main/docs/ui.md#themes" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">theme files</a> (.json) in the themes folder: each shows up here.</span>
          <Button variant="outline" size="xs" className="shrink-0" onClick={() => void app.openThemes()}><FolderOpenIcon />Open themes folder</Button>
        </div>
      </Section>
      <Section title="Sidebar art">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span>A drawing at the top of the sidebar<span className="block text-muted-foreground">In the theme's colours, where the theme has one.</span></span>
          <Switch label="Sidebar art" checked={settings.art} onChange={art => void app.saveSettings({ art })} />
        </div>
      </Section>
      <Section title="Subagent reports" hint="How the reports of agents started together are shown when they arrive at once.">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem]">
          <div role="radiogroup" aria-label="Subagent reports" className="flex flex-col gap-2">
            {(Object.keys(LAYOUTS) as Settings['reports'][]).map(layout => (
              <label key={layout} className={cn('flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foreground/60 has-[:focus-visible]:-outline-offset-4',
                settings.reports === layout ? 'border-transparent bg-accent/60 ring-2 ring-ring ring-inset' : 'border-border/70 bg-card/60 hover:bg-accent/40')}>
                <input type="radio" name="reports" className="sr-only" checked={settings.reports === layout} onChange={() => void app.saveSettings({ reports: layout })} />
                <span className="font-medium text-foreground">{LAYOUTS[layout][0]}</span>
                <span className="text-muted-foreground text-xs">{LAYOUTS[layout][1]}</span>
              </label>
            ))}
          </div>
          <Reports layout={settings.reports} />
        </div>
      </Section>
    </>
  );
}
