import { app, BrowserWindow, clipboard, dialog, Menu, powerSaveBlocker, screen, session, shell, type MessageBoxOptions } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { MENU_EVENT, RENAME_EVENT, type MenuAction } from '../menu.ts';
import { startServer } from '../server/server.ts';
import { launch } from '../server/files.ts';
import { terminal } from '../server/setup.ts';
import { awake } from './awake.ts';
import { loginEnvironment } from './environment.ts';
import { destination } from './links.ts';
import { appMenu } from './menu.ts';
import { quitter } from './quit.ts';
import { clicked, updater } from './update.ts';
import { contextMenu, placed, recovery } from './window.ts';

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
  let updates: ReturnType<typeof updater> | undefined;
  /** Looks for an update because you asked, and answers whatever it finds: an update is said as at any other look. */
  let check: (() => void) | undefined;
  // A click on the page's update button (`clicked`): the release's page, or what the menu's Check for Updates… does.
  const update = () => clicked(updates?.state(), { open: page => browse(page), look: () => check?.() });
  const options = { ui: join(import.meta.dirname, '../ui'), cwd: homedir(), histories: homedir(), opener: terminal(), launcher: launch, update };
  const server = await startServer({ ...options, port: PORT }).catch(() => startServer(options));
  // The Mac does not fall asleep under agents at work (awake.ts): looked at every ten seconds, which is soon enough for a
  // Mac that takes minutes to sleep. The screen may still go dark.
  const look = awake({
    wanted: () => server.settings().awake, working: () => server.working(),
    blocker: { start: () => powerSaveBlocker.start('prevent-app-suspension'), stop: id => powerSaveBlocker.stop(id) },
  });
  setInterval(() => void look(), 10_000);
  /** A quit that is not asked about: a restart into an update, which its own question was about, or a signal, which nobody
   * may be there to answer. */
  let sure = false, leaving = false;
  /** The app's window, while it has one: closed, the app goes on without it. */
  const current = () => BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
  /** A question, on the window when there is one. Whether its first button was the answer. */
  const ask = async (options: MessageBoxOptions) => { const window = current(); return (await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))).response === 0; };
  const count = (agents: number) => agents === 1 ? '1 agent is' : `${agents} agents are`;
  // The window never leaves the app's page, and there is no second window. A link opens in your browser, one to the app's
  // own server too (a picture, which a link opens in a tab of its own); anything that is not a web page goes nowhere.
  const browse = (url: string) => { if (destination(url, server.page) !== 'nowhere') void shell.openExternal(new URL(url).href); };
  /** Where the window was when it was last closed. */
  const place = join(app.getPath('userData'), 'window.json');
  const open = () => {
    let saved: unknown;
    try { saved = JSON.parse(readFileSync(place, 'utf8')); } catch { /* It was never closed yet. */ }
    const window = new BrowserWindow({
      // Where it was, if that is still on a screen; else as a new window.
      width: 1280, height: 860, ...placed(saved, screen.getAllDisplays().map(display => display.bounds)), minWidth: 380, minHeight: 480, show: false,
      // No title bar: the page's top row is the window's, with the window's buttons in it, level with its middle (52px high).
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 19 },
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    }), { webContents } = window;
    window.on('close', () => { try { writeFileSync(place, JSON.stringify(window.getNormalBounds())); } catch { /* Then it opens where it last was kept. */ } });
    // The page is told it is in this window, and whether the window fills the screen, where it has no buttons to make room for.
    const mark = () => { if (!window.isDestroyed()) void webContents.executeJavaScript(`document.documentElement.dataset.shell = '${window.isFullScreen() ? 'fullscreen' : 'windowed'}'`); };
    webContents.on('dom-ready', mark);
    window.on('enter-full-screen', mark).on('leave-full-screen', mark);
    webContents.on('will-navigate', (event, url) => { if (destination(url, server.page) !== 'here') { event.preventDefault(); browse(url); } });
    webContents.setWindowOpenHandler(({ url }) => { browse(url); return { action: 'deny' }; });
    // A right click: Electron has no menu of its own. On a connected window's row it offers Rename, which only the page can
    // tell (`data-rename` is the row's window), and which it does (RENAME_EVENT).
    webContents.on('context-menu', (_event, params) => void webContents.executeJavaScript(`document.elementFromPoint(${params.x}, ${params.y})?.closest('[data-rename]')?.dataset.rename`).catch(() => undefined).then((row: unknown) => {
      const rename = typeof row === 'string' ? () => void webContents.executeJavaScript(`dispatchEvent(new CustomEvent('${RENAME_EVENT}', { detail: ${JSON.stringify(row)} }))`).catch(() => {}) : undefined;
      Menu.buildFromTemplate(contextMenu(params, server.page, {
        replace: word => webContents.replaceMisspelling(word), copyLink: () => clipboard.writeText(params.linkURL), copyImage: () => webContents.copyImageAt(params.x, params.y), rename,
      })).popup({ window });
    }));
    // A page whose process crashed is loaded again, a few times, in place of a blank window.
    const recover = recovery(), load = () => window.loadURL(server.page);
    webContents.on('render-process-gone', (_event, { reason }) => {
      const wait = recover(reason);
      if (wait !== undefined) setTimeout(() => { if (!window.isDestroyed()) void load().catch(() => {}); }, wait);
    });
    // Shown once the page is there and marked: the first time it loads whole, which may be after a crash.
    webContents.once('did-finish-load', () => { if (!leaving) window.show(); });
    void load().catch(() => {});
    return window;
  };
  /** The window, in front: opened when there is none, unless the app is on its way out. */
  const front = () => {
    const window = current();
    if (!window) return leaving ? undefined : open();
    if (window.isMinimized()) window.restore();
    // One that is still loading is shown when it has loaded, not before.
    if (window.isVisible()) window.focus();
    return window;
  };
  /** What the menu asks of the page (menu.ts), said to it once it is loaded: the menu may have opened the window for it. */
  const tell = (action: MenuAction) => {
    const page = front()?.webContents, say = () => void page?.executeJavaScript(`dispatchEvent(new CustomEvent('${MENU_EVENT}', { detail: '${action}' }))`).catch(() => {});
    if (page?.isLoading()) page.once('did-finish-load', say); else say();
  };
  // Electron is ready only once this file has run to its end, so the window is not waited for here.
  void app.whenReady().then(() => {
    // The packaged app has its icon in it; run from the checkout, Electron would show its own.
    if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'));
    // Electron grants a page every permission it asks for. This one needs only to copy text (`navigator.clipboard.writeText`).
    const copies = (permission: string) => permission === 'clipboard-sanitized-write';
    session.defaultSession.setPermissionRequestHandler((_contents, permission, done) => done(copies(permission)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => copies(permission));
    open();
    // A signal stops everything in order, as a quit does. Set only now: Electron sets handlers of its own for these as it
    // starts, which would quit as Cmd+Q does, and once only: whoever sets one last gets the signal.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { sure = true; app.quit(); });
    // The window closed, the app is still in the Dock, and a click on it there opens the window again.
    app.on('activate', () => { if (!current() && !leaving) open(); });
    app.on('second-instance', front);
    // The packaged app updates itself (update.ts): it looks soon after it opens and every four hours, downloads a newer
    // release, and asks once. It never restarts on its own: a restart stops every Pi, as quitting does. What it is doing
    // is said to the server, whose pages show it in their update button. The app is three folders above what runs:
    // OptChat.app/Contents/MacOS/OptChat. Run from the checkout there is no app to replace and no updater, unless a test
    // names an app of its own to stand for it (`OPTCHAT_APP_BUNDLE`, with the feed in `OPTCHAT_APP_UPDATES`).
    const bundle = app.isPackaged ? resolve(process.execPath, '../../..') : process.env.OPTCHAT_APP_BUNDLE;
    if (bundle) {
      const offer = (message: string, detail: string, yes: string) => ask({ type: 'info', message, detail, buttons: [yes, 'Later'], defaultId: 0, cancelId: 1 });
      updates = updater({
        bundle, version: app.getVersion(), feed: process.env.OPTCHAT_APP_UPDATES, failed: join(app.getPath('userData'), 'update-failed'), changed: state => server.updating(state),
        async ready({ version }) {
          const working = await server.working().catch(() => 0), now = working ? `${count(working)} working now. ` : '';
          // Electron starts the app again once this one is gone, by its path: by then the new app is there. The quit is not
          // asked about a second time: this was the question.
          if (await offer(`OptChat ${version} is ready`, `${now}A restart stops every chat and its agents, as quitting does. Later, it is installed when you quit.`, 'Restart')) { sure = true; app.relaunch(); app.quit(); }
        },
        async manual({ version, page }) {
          if (await offer(`OptChat ${version} is out`, 'This copy of OptChat cannot replace itself where it is. Download the new one and put it in its place.', 'Download')) browse(page);
        },
      });
      server.updating(updates.state());
      // A look that fails (no network, a download cut off) asks nothing: the update button says why, and the next one tries again.
      const look = () => void updates?.look().catch(() => {});
      setTimeout(look, 10_000);
      setInterval(look, 4 * 3_600_000);
      const say = (message: string, detail?: string) => void ask({ type: 'info', message, detail, buttons: ['OK'] });
      check = () => void updates?.look(true).then(found => {
        // Not "the newest": a newer release whose app is not there for this Mac yet is no update either.
        if (found === 'none') say(`There is no update for OptChat ${app.getVersion()}`);
        if (found === 'busy') say('OptChat is looking for an update already', 'If there is one it is downloaded now, and you are asked when it is ready.');
      }, () => { const now = updates?.state(); say('OptChat could not update', now?.state === 'failed' ? now.error : undefined); });
    }
    // The menu bar, in place of Electron's own, which names the app by its package (menu.ts).
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu({ page: tell, keys: () => current()?.webContents.isFocused() ?? false, update: check, browse })));
  });
  // Closing the window (Cmd+W) closes only the window: the app stays in the Dock, and every Pi and its agents go on.
  app.on('window-all-closed', () => {});

  // Quitting stops every Pi in order, so each saves its memory and frees its profile, and is put off until that is done:
  // also when you quit again meanwhile, as a Cmd+Q held a moment too long does. The server gives a Pi 15 seconds at most.
  // While agents work it asks first (quit.ts). The window goes at once, as T3 Code's does: its page would only say that the
  // server is not answering.
  const quitting = quitter({
    working: () => server.working(),
    ask: working => ask({ type: 'question', message: `${count(working)} working. Quit and stop ${working === 1 ? 'it' : 'them'}?`, buttons: ['Quit', 'Cancel'], defaultId: 0, cancelId: 1 }),
    close: () => { leaving = true; for (const window of BrowserWindow.getAllWindows()) window.hide(); return server.close(); },
    quit: () => app.quit(),
  });
  app.on('before-quit', event => { if (!quitting.request(sure)) event.preventDefault(); });
  // An update that is ready takes the app's place at the very end, when every Pi has stopped and the window is gone.
  app.on('quit', () => { updates?.install(); });
}
