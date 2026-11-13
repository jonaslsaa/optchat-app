# The desktop app

Electron around the same page: `src/desktop/main.ts` starts the server in its own process ([server.md](server.md)) and opens one window on the page it serves ([ui.md](ui.md)). There is no second UI and no bridge between the two: the page talks to the server over its WebSocket, as it does in a browser, and has no Node in it (no `nodeIntegration`, context isolation, sandboxed, no preload).

## Run it

```sh
npm run desktop   # builds the page and the main process, then opens the app from this folder
npm run dist      # the same build as OptChat.app and a dmg, in release/ (macOS, Apple Silicon)
```

`npm start` and the page in a browser are as they were. To try the app while you work on something else, as a script that takes its picture does, set `OPTCHAT_APP_BACKGROUND=1`: the window then opens behind the others and takes no focus. `OPTCHAT_HOME` and `OPTCHAT_APP_HOME` move the two folders, as for the server.

## What the shell does

- **Your terminal's environment.** An app opened from the Finder or the Dock gets launchd's environment, whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin`: no `pi`, `npm` or `gh`. So before anything else the app asks your login shell for its environment, once (`$SHELL -ilc`, as T3 Code does), and takes all of it: the PATH, and whatever else your shell sets for Pi, such as an API key. A shell that fails, or has not answered after five seconds, gives none and is killed with what it started; the app then runs with what it has, and the setup page says what it did not find.
- **The server, in the app's process.** `startServer` on 127.0.0.1, on port 4781 when it is free and on any free port otherwise. The port is kept the same because the page keeps what it has (the open profiles, your drafts) by its address.
- **One app at a time.** A second one would find every profile held by the first, so it brings the first one's window to the front and goes.
- **Quitting** waits for `server.close()`: every Pi is stopped in order, saves its memory and frees its profile, the same as the server's own Ctrl+C. That goes for Cmd+Q, for closing the window (the app has one window and quits with it), and for a signal. Quitting a second time quits at once.
- **The window shows the app and nothing else.** A link to a web page (`http:`, `https:`) opens in your browser, and so does a link to something the app's own server has, such as a picture: there is no second window. Any other address, such as a `file:` or another app's scheme, is opened nowhere: an agent can write any link. `src/desktop/links.ts` is the whole rule.
- **The title bar is the page's top row.** The window has none of its own (`titleBarStyle: 'hiddenInset'`), and the shell marks the page with `data-shell` on `<html>`: `windowed`, or `fullscreen` while the window fills the screen. In `index.css` a `window-bar` is what the window is dragged by, though not by its buttons, links and fields; a `window-start` row leaves room at its left for the window's three buttons, unless another bar is above it (the profile tabs) or the window fills the screen and has none. A double click on a bar zooms the window, as macOS has it. What the app has to tell you (the notices a browser has above everything) is at the window's foot instead. In a browser there is no mark and nothing changes.

## How it is built

- `vite.desktop.config.ts` bundles `src/desktop/main.ts`, the server and all they import into one file, `dist/desktop/main.js`: Electron's Node does not run TypeScript, and the packaged app then needs no `node_modules`. Only `electron` itself stays an import. The page is `dist/ui`, beside it.
- `electron-builder.yml` packs `dist/` and `package.json` into `OptChat.app` and a dmg, for arm64 only.
- **Signed ad hoc.** There is no Apple Developer ID, so the app is not notarized, and it does not update itself. An arm64 app that is not signed at all does not start, so it is signed with no identity (`codesign -dv` says `Signature=adhoc`).

## Not there yet

- An icon: the app has Electron's.
- Windows and Linux: nothing here is tried on them, and the title bar is written for macOS.
- A window in the Dock while the app has none: closing the window quits.
