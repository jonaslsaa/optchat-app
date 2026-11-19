import type { App } from './store.ts';
import { chosen, readTheme, ROLES, type Appearance, type Colors, type Theme } from './themes.ts';

/** The themes the app comes with: its `themes` folder, read as your own files are (`themes.ts`), in the order they are shown. */
const FILES = import.meta.glob<unknown>('./themes/*.json', { eager: true, import: 'default' });
export const BUILT_IN = ['blossom', 'grove', 'ocean', 'ember', 'iris'].map(id => readTheme(id, FILES[`./themes/${id}.json`])).filter((theme): theme is Theme => 'name' in theme);

/** What the page is painted with: light or dark (`scheme`, the settings' `theme`), the colours of the theme drawn in each, and
 * whether a theme's drawing is on the sidebar (`art`). It is kept in the browser as well, so a reload paints it before the
 * server has answered. A theme's colours are set on the page over `index.css`'s, and with none the page has the app's own. */
interface Look { scheme?: string; light?: Colors; dark?: Colors; art: boolean }
const KEPT = 'optchat-app-theme', LOOK = 'optchat-app-look';
function kept(): Look {
  const look: Look = { scheme: localStorage.getItem(KEPT) ?? undefined, art: true };
  try { return { ...look, ...JSON.parse(localStorage.getItem(LOOK) ?? '{}') }; } catch { return look; }
}
export function followTheme(app: App) {
  const system = matchMedia('(prefers-color-scheme: dark)'), root = document.documentElement;
  let look = kept();
  const paint = () => {
    const appearance: Appearance = look.scheme === 'dark' || look.scheme !== 'light' && system.matches ? 'dark' : 'light', colors = look[appearance] ?? {};
    root.classList.toggle('dark', appearance === 'dark');
    for (const role of ROLES) {
      const color = colors[role];
      if (color) root.style.setProperty(`--${role}`, color); else root.style.removeProperty(`--${role}`);
    }
    // The drawing is the sidebar's while it is on and the theme has its colours (`data-art`, the `art:` variant in `index.css`).
    root.toggleAttribute('data-art', look.art && colors['art-top'] !== undefined);
  };
  paint();
  system.addEventListener('change', paint);
  app.subscribe(() => {
    // Your own themes are known once the server has read them: till then a theme of yours is painted as it was kept.
    const { settings, themes } = app.state;
    if (!settings || (!themes && Object.values(settings.palette ?? {}).some(id => id?.endsWith('.json')))) return;
    const all = [...BUILT_IN, ...themes?.files ?? []];
    const next: Look = { scheme: settings.theme, light: chosen(all, settings, 'light')?.light, dark: chosen(all, settings, 'dark')?.dark, art: settings.art };
    if (JSON.stringify(next) === JSON.stringify(look)) return;
    look = next;
    localStorage.setItem(KEPT, settings.theme);
    localStorage.setItem(LOOK, JSON.stringify({ light: look.light, dark: look.dark, art: look.art }));
    paint();
  });
}
