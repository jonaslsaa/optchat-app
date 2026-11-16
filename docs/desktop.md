# The desktop app

Electron around the same page: `src/desktop/main.ts` starts the server in its own process ([server.md](server.md)) and opens one window on the page it serves ([ui.md](ui.md)). There is no second UI and no bridge between the two: the page talks to the server over its WebSocket, as it does in a browser, and has no Node in it (no `nodeIntegration`, context isolation, sandboxed, no preload).

## Run it

```sh
npm run desktop   # builds the page and the main process, then opens the app from this folder
npm run dist      # the same build as OptChat.app and a dmg, in release/ (macOS, Apple Silicon)
```

`npm start` and the page in a browser are as they were. `OPTCHAT_HOME` and `OPTCHAT_APP_HOME` move the two folders, as for the server. The app has a third, which is Chromium's: what the page keeps (the open profiles, your drafts) is in `~/Library/Application Support/OptChat`, or `optchat-app` there when the app runs from a checkout.

## What the shell does

- **Your terminal's environment.** An app opened from the Finder or the Dock gets launchd's environment, whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin`: no `pi`, `npm` or `gh`. So before anything else the packaged app asks your login shell for its environment, once (`$SHELL -ilc`, as T3 Code does), and takes all of it: the PATH, and whatever else your shell sets for Pi, such as an API key. A shell that fails, or has not answered after five seconds, gives none and is killed with what it started; the app then runs with what it has, and the setup page says what it did not find. Run from a checkout (`npm run desktop`) the app is started from your terminal and keeps its environment as it is, with what you typed in front of it.
- **The server, in the app's process.** `startServer` on 127.0.0.1, on port 4781 when it is free and on any free port otherwise. The port is kept the same because the page keeps what it has (the open profiles, your drafts) by its address.
- **One app at a time.** A second one would find every profile held by the first, so it brings the first one's window to the front and goes.
- **Closing the window closes only the window** (Cmd+W, or its red button). The app stays in the Dock, and every Pi and its agents go on; a click on the Dock icon opens the window again, on the same page.
- **Quitting** waits for `server.close()`: every Pi is stopped in order, saves its memory and frees its profile, the same as the server's own Ctrl+C. That goes for Cmd+Q and for a signal. The window is gone at once, and the app a moment later. Quitting again meanwhile changes nothing, so a Cmd+Q held too long leaves no Pi behind: the wait is over within the 15 seconds the server gives a Pi to stop.
- **It asks before it quits while agents work**: "2 agents are working. Quit and stop them?", once however long Cmd+Q is held, and Cancel leaves everything running. What counts is each of the app's chats that is in a run and each agent running under them; a chat in a terminal is not the app's to stop. Nothing is asked when nothing works, after Restart in the update's question (which said the same), or for a signal, which nobody may be there to answer. `src/desktop/quit.ts` is the rule.
- **The window shows the app and nothing else.** A link to a web page (`http:`, `https:`) opens in your browser, and so does a link to something the app's own server has, such as a picture: there is no second window. Any other address, such as a `file:` or another app's scheme, is opened nowhere: an agent can write any link. `src/desktop/links.ts` is the whole rule.
- **The Mac stays awake while agents work.** Every ten seconds the shell asks the server how many agents work (the count a quit asks about: each of the app's chats in a run, and each agent running under them), and while there are any it holds Electron's `powerSaveBlocker` (`prevent-app-suspension`), so the Mac does not fall asleep by itself under a long job; the screen may still turn off, and closing the lid still puts it to sleep. It lets go when two looks in a row found none, since for a moment between an agent's end and the turn its report starts nothing works. When the app quits, macOS lets go with it. A paused agent, a chat that waits for you and a chat in a terminal do not hold it. "Keep the Mac awake" in the settings turns it off, within those ten seconds (`src/desktop/awake.ts`). What pi-optchat does after a turn without a run, such as summarizing, is not counted: the app cannot see it.
- **A right click has a menu**, which Electron does not give: the spellings for a word marked as wrong, Copy Link, Copy Image, and cut, copy, paste and select all, each where it can be done (as T3 Code has it).
- **The window opens where you left it**, at the size it had (`window.json` beside what the page keeps), if that place is still whole on a screen there is now. Otherwise it opens as a new window does.
- **A page that crashes is loaded again**, after half a second, then one, then two; after three times in a minute it is left as it is, since it would crash again.
- **The title bar is the page's top row.** The window has none of its own (`titleBarStyle: 'hiddenInset'`), and the shell marks the page with `data-shell` on `<html>`: `windowed`, or `fullscreen` while the window fills the screen. In `index.css` a `window-bar` is what the window is dragged by, though not by its buttons, links and fields; the chat's own top row is not one while the sidebar lies over it in a narrow window, since Electron would have it drag through the sidebar's buttons; a `window-start` row leaves room at its left for the window's three buttons, unless another bar is above it (the profile tabs) or the window fills the screen and has none. A double click on a bar zooms the window, as macOS has it. What the app has to tell you (the notices a browser has above everything) is at the window's foot instead. In a browser there is no mark and nothing changes.

## How it is built

- `vite.desktop.config.ts` bundles `src/desktop/main.ts`, the server and all they import into one file, `dist/desktop/main.js`: Electron's Node does not run TypeScript, and the packaged app then needs no `node_modules`. Only `electron` itself stays an import. The page is `dist/ui`, beside it.
- `electron-builder.yml` packs `dist/` and `package.json` into `OptChat.app` and a dmg, for arm64 only.
- **Signed ad hoc.** There is no Apple Developer ID, so the app is not notarized, and it updates itself in its own way ([below](#updates)). An arm64 app that is not signed at all does not start, so it is signed with no identity (`codesign -dv` says `Signature=adhoc`).

The icon is `build/icon.icns`, where electron-builder looks for it; it is cut from `build/icon.svg`, and `build/icon.png` is the page's icon and the Dock's when the app runs from the checkout.

The dmg opens as a window with a picture, `build/background.png` (and its `@2x`), where electron-builder looks for it: the icon's rings on cream, the name, "Drag OptChat into Applications.", an arrow between the two icons and a line under them. `build/background.svg` is its source, and `npm run dmg:art` cuts the pictures from it with `sips`; they are committed, so a build needs nothing more. Three things about the Finder decide how it is drawn:

- **The window is the picture's size**, 640 by 432 with the title bar, and the picture is never scaled. The lowest strip of it (36 px on macOS 27) is therefore never seen.
- **The icons' places are part of the picture.** `electron-builder.yml` puts them at (166, 214) and (474, 214), 120 px each, and the arrow is drawn for those.
- **The Finder writes the names under the icons in black** in a window with a picture, in light mode and in dark, and no setting changes it. So the picture is light: on a dark one the names could not be read.

## Updates

The packaged app updates itself from this repository's GitHub releases. `src/desktop/update.ts` is all of it, and `main.ts` says when it looks and what it asks.

- **It looks** ten seconds after it opens and every four hours: it asks GitHub for the latest release, with no token. A release is an update when its tag is a newer version than the app's and it has the app's zip (`OptChat-<version>-arm64.zip`).
- **It downloads without asking**, and checks what it got before it unpacks anything: the zip has to be as long as the release says and have the sha256 GitHub took of it when it was uploaded, and the app in it has to be signed and whole (`codesign --verify --deep --strict`). It is made ready in a hidden folder beside the app, `.OptChat-update`.
- **It asks once**: "OptChat 0.2.0 is ready", **Restart** or **Later**, and it says how many agents are working now, since a restart stops every chat and its agents as quitting does. It never restarts on its own, and after Restart the quit is not asked about again. Later, the update is installed when you quit.
- **It is installed as the app quits**, after every Pi has stopped as on any quit: the new app takes the old one's place by two renames, so there is never half an app, and the old one is removed when the new one has opened. Restart starts the app again from the same place.
- **A look that fails says nothing** (no network, a download cut off, a file that is not the release's), leaves nothing behind, and the next look tries again.
- **Where the app cannot replace itself**, it downloads nothing and offers the release's page instead, once each time it is opened: run from the dmg, from where macOS runs a copy it does not trust (an app opened from Downloads without being moved), or in a folder you cannot write to. The same for a version it could not install: when macOS refused the change at quit, or the release's own zip had no whole, signed app in it. The app stays as it was, does not download that version again, and offers its page from then on.

What is trusted: GitHub, asked over https, and whoever can push a `v*` tag here, since the release workflow builds what is tagged. The sha256 comes in the same answer as the zip's address, so it says that the file is the one the release names and nothing of who made it; and `codesign --verify` on an ad hoc signature says the app is as it was when it was signed, not who signed it.

Why not Electron's updater: it, and electron-updater on top of it, hand the new app to Squirrel.Mac, which takes it only if it meets the running app's designated requirement. For an app signed ad hoc that requirement is the build's own hash (`codesign -d -r-` says `cdhash H"…"`), which no other build has, so every update would be refused. With a Developer ID this updater works as it is, and could also ask for the team's signature.

What macOS does with an updated app: the app downloads the zip itself, so nothing is marked as downloaded and the new app opens without "Open Anyway". It asks again for your Documents folder, as [below](#the-first-open).

Until this repository has a release, GitHub answers 404, which is "no update": nothing is shown. To try it before then, serve a release as GitHub's API gives one (`tag_name`, `html_url`, and `assets` with `name`, `size`, `digest` and `browser_download_url`; `test/update.test.ts` has one) and start the app with `OPTCHAT_APP_UPDATES=<its address>`. That variable is for trying this out and nothing else: the app installs what that address offers, with the same checks. Run from a checkout (`npm run desktop`), the app never looks.

## Releasing

`.github/workflows/release.yml` builds the app on a macOS runner (Apple Silicon) and attaches it to a GitHub release with generated notes, as the dmg you download and as the zip a running app updates itself from. To cut one:

1. Set `version` in `package.json` (and `package-lock.json`: `npm version <x.y.z> --no-git-tag-version`), and merge that.
2. Tag that commit `v<x.y.z>` and push the tag. The build fails if the tag and `package.json` disagree.

Started by hand (Actions → Release → Run workflow), the same build makes no release and keeps the dmg and the zip as an artifact of the run for a week. Nothing builds on a push or a pull request: a macOS runner's minutes count ten times in a private repository. The build prints the app's signature (`Signature=adhoc`) and Gatekeeper's answer to it, which is `rejected` for an app without a Developer ID.

## The first open

The app is signed ad hoc and not notarized, so what macOS does at the first open depends on how the dmg got to the Mac (tried on macOS 27.2):

- **Downloaded with `gh`** (or `curl`): the file is not marked as downloaded (no `com.apple.quarantine`), and the app opens like any other.
- **Downloaded with a browser**: macOS marks the dmg and the app copied out of it, and the first open ends with "“OptChat” Not Opened. Apple could not verify “OptChat” is free of malware that may harm your Mac or compromise your privacy.", with **Move to Trash** and **Done**. Press Done, then allow it once under System Settings → Privacy & Security → **Open Anyway**. Taking the mark off does the same (`xattr -dr com.apple.quarantine /Applications/OptChat.app`).
- **On a company Mac** with endpoint security, an unsigned app from the internet may be flagged or stopped whatever you allow yourself.

macOS asks once whether OptChat may read your Documents folder (or Desktop, Downloads) when an agent first works there. An ad hoc signature is a new identity with every build, so it asks again after each update.

## Not there yet

- An update is tried on the real app only in a folder under `/tmp`, started by its path (macOS 27.2): it downloaded a newer build from a local address, replaced itself as it quit, and opened as the new one. Not tried: an app in `/Applications`, where macOS may refuse an app that changes itself (App Management), an app that was downloaded with a browser, and the two dialogs.
- A way to look for an update when you ask, and the notice in the page instead of a dialog.

- Windows and Linux: nothing here is tried on them, and the title bar is written for macOS.
