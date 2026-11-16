import { app, BrowserWindow, dialog, shell } from 'electron';
import { join, resolve } from 'node:path';
import { startServer } from '../server/server.ts';
import { terminal } from '../server/setup.ts';
import { loginEnvironment } from './environment.ts';
import { destination } from './links.ts';
import { updater } from './update.ts';

/** The desktop app: a window around the same page the server serves to a browser, with the server in this process. It is built
 * to `dist/desktop/main.js` (`npm run build:desktop`), which Electron runs, beside the page in `dist/ui`. */

/** The port the page is served on when it is free, so the page finds what it kept (the open profiles) where it left it: a
 * browser keeps that by address. */
const PORT = 4781;

// One app at a time: a second one would only find every profile held by the first.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Opened from the Finder, the app has launchd's environment. Run from a terminal it has yours already, and what you typed stays.
  if (app.isPackaged) Object.assign(process.env, await loginEnvironment());
  const options = { ui: join(import.meta.dirname, '../ui'), opener: terminal() };
  const server = await startServer({ ...options, port: PORT }).catch(() => startServer(options));
  let updates: ReturnType<typeof updater> | undefined;
  // Electron is ready only once this file has run to its end, so the window is not waited for here.
  void app.whenReady().then(() => {
    // The packaged app has its icon in it; run from the checkout, Electron would show its own.
    if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'));
    const window = new BrowserWindow({
      width: 1280, height: 860, minWidth: 380, minHeight: 480, show: false,
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
    void window.loadURL(server.page).then(() => window.show());
    app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus(); });
    // The packaged app updates itself (update.ts): it looks soon after it opens and every four hours, downloads a newer
    // release without a word, and asks once. It never restarts on its own: a restart stops every Pi, as quitting does.
    if (app.isPackaged) {
      const ask = async (message: string, detail: string, yes: string) =>
        !window.isDestroyed() && (await dialog.showMessageBox(window, { type: 'info', message, detail, buttons: [yes, 'Later'], defaultId: 0, cancelId: 1 })).response === 0;
      updates = updater({
        // The app is three folders above what runs: OptChat.app/Contents/MacOS/OptChat.
        bundle: resolve(process.execPath, '../../..'), version: app.getVersion(), feed: process.env.OPTCHAT_APP_UPDATES, failed: join(app.getPath('userData'), 'update-failed'),
        async ready({ version }) {
          const working = server.working(), now = working ? `${working === 1 ? '1 chat is' : `${working} chats are`} working now. ` : '';
          // Electron starts the app again once this one is gone, by its path: by then the new app is there.
          if (await ask(`OptChat ${version} is ready`, `${now}A restart stops every chat and its agents, as quitting does. Later, it is installed when you quit.`, 'Restart')) { app.relaunch(); app.quit(); }
        },
        async manual({ version, page }) {
          if (await ask(`OptChat ${version} is out`, 'This copy of OptChat cannot replace itself where it is. Download the new one and put it in its place.', 'Download')) browse(page);
        },
      });
      // A look that fails (no network, a download cut off) says nothing, and the next one tries again.
      const look = () => void updates?.look().catch(() => {});
      setTimeout(look, 10_000);
      setInterval(look, 4 * 3_600_000);
    }
  });
  app.on('window-all-closed', () => app.quit());

  // Quitting stops every Pi in order, so each saves its memory and frees its profile, and is put off until that is done:
  // also when you quit again meanwhile, as a Cmd+Q held a moment too long does. The server gives a Pi 15 seconds at most.
  // The window goes at once, as T3 Code's does: its page would only say that the server is not answering.
  let closing: Promise<void> | undefined, closed = false;
  app.on('before-quit', event => {
    if (closed) return;
    event.preventDefault();
    for (const window of BrowserWindow.getAllWindows()) window.hide();
    closing ??= server.close().then(() => { closed = true; app.quit(); });
  });
  // An update that is ready takes the app's place at the very end, when every Pi has stopped and the window is gone.
  app.on('quit', () => { updates?.install(); });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => app.quit());
}
