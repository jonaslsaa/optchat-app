import type { App } from './store.ts';

/** The page's colours: light or dark as the settings say, and as the system has it while they say `system`. The choice is kept
 * in the browser as well, so a reload paints it before the server has answered. */
const KEPT = 'optchat-app-theme';
export function followTheme(app: App) {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let theme = localStorage.getItem(KEPT);
  const paint = () => document.documentElement.classList.toggle('dark', theme === 'dark' || theme !== 'light' && system.matches);
  paint();
  system.addEventListener('change', paint);
  app.subscribe(() => {
    const chosen = app.state.settings?.theme;
    if (!chosen || chosen === theme) return;
    localStorage.setItem(KEPT, theme = chosen);
    paint();
  });
}
