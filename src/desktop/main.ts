import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { startServer } from '../server/server.ts';
import { terminal } from '../server/setup.ts';
import { loginEnvironment } from './environment.ts';
import { destination } from './links.ts';

/** The desktop app: a window around the same page the server serves to a browser, with the server in this process. It is built
 * to `dist/desktop/main.js` (`npm run build:desktop`), which Electron runs, beside the page in `dist/ui`. */

/** The port the page is served on when it is free, so the page finds what it kept (the open profiles) where it left it: a
 * browser keeps that by address. */
const PORT = 4781;

// One app at a time: a second one would only find every profile held by the first.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  Object.assign(process.env, await loginEnvironment());
  const options = { ui: join(import.meta.dirname, '../ui'), opener: terminal() };
  const server = await startServer({ ...options, port: PORT }).catch(() => startServer(options));
  // Electron is ready only once this file has run to its end, so the window is not waited for here.
  void app.whenReady().then(() => {
    // The packaged app has its icon in it; run from the checkout, Electron would show its own.
    if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'));
    // `OPTCHAT_APP_BACKGROUND` is for trying the app out while you work: its window opens behind the others and takes no focus.
    const background = Boolean(process.env.OPTCHAT_APP_BACKGROUND);
    const window = new BrowserWindow({
      width: 1280, height: 860, minWidth: 380, minHeight: 480, show: false, focusable: !background,
      // No title bar: the page's top row is the window's, with the window's buttons in it, level with its middle (52px high).
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 19 },
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    // The page is told it is in this window, and whether the window fills the screen, where it has no buttons to make room for.
    const mark = () => { if (!window.isDestroyed()) void window.webContents.executeJavaScript(`document.documentElement.dataset.shell = '${window.isFullScreen() ? 'fullscreen' : 'windowed'}'`); };
    window.webContents.on('dom-ready', mark);
    window.on('enter-full-screen', mark).on('leave-full-screen', mark);
    // The window never leaves the app's page, and there is no second window. A link opens in your browser, one to the app's
    // own server too (a picture, which a link opens in a tab of its own); anything that is not a web page goes nowhere.
    const browse = (url: string) => { if (destination(url, server.page) !== 'nowhere') void shell.openExternal(url); };
    window.webContents.on('will-navigate', (event, url) => { if (destination(url, server.page) !== 'here') { event.preventDefault(); browse(url); } });
    window.webContents.setWindowOpenHandler(({ url }) => { browse(url); return { action: 'deny' }; });
    // Shown once the page is there and marked.
    void window.loadURL(server.page).then(() => { if (background) { window.showInactive(); window.blur(); } else window.show(); });
    app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus(); });
  });
  app.on('window-all-closed', () => app.quit());

  // Quitting stops every Pi in order, so each saves its memory and frees its profile, and is put off until that is done:
  // also when you quit again meanwhile, as a Cmd+Q held a moment too long does. The server gives a Pi 15 seconds at most.
  let closing: Promise<void> | undefined, closed = false;
  app.on('before-quit', event => {
    if (closed) return;
    event.preventDefault();
    closing ??= server.close().then(() => { closed = true; app.quit(); });
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => app.quit());
}
