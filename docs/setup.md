# Setup

What stands between a new machine and a chat, and the three places the app deals with it: its own settings, the things a chat needs (Pi, pi-optchat, a model, a profile), and a profile that a Pi in a terminal already has open. All of it is in its own files: `src/server/settings.ts` and `src/server/setup.ts` in the server, `src/ui/Settings.tsx`, `Setup.tsx`, `Outside.tsx` and `theme.ts` in the page (themes: [ui.md](ui.md#themes)).

## The app's own folder

The app keeps its files in `~/.optchat-app` (`OPTCHAT_APP_HOME` moves it, which is how tests stay away from yours; `~` in it is your home folder): `settings.json`, and the Pi it installs. It is never pi-optchat's `~/.optchat`, which only Pi writes, but for what pi-optchat's own functions write there when you ask: a new, empty profile (`createProfile`) when you name your first one, and a profile's settings and instructions when you change them on the settings page ([server.md](server.md#a-profiles-settings)).

Two servers on one machine share that folder. Each reads the settings when it starts and writes them whole, so the one that wrote last wins; give a second server its own `OPTCHAT_APP_HOME` if that matters.

## Settings

`settings.json` holds what `Settings` in `src/protocol.ts` says, and nothing else:

| Setting | What it does |
| --- | --- |
| `theme` | `system` (the default), `light` or `dark`. |
| `palette` | The theme drawn in light and the one in dark, each by its file's name (`{ "light": "grove", "dark": "mine.json" }`); the app's own colours where it names none ([Themes](ui.md#themes)). |
| `art` | Whether a theme's drawing is at the top of the sidebar: `true` until you turn it off. |
| `reports` | How the reports of agents that arrive together are drawn: `tabs` (the default) or `sections` ([What you see](ui.md#what-you-see)). |
| `awake` | Whether the desktop app keeps the Mac from sleeping while agents work ([desktop.md](desktop.md)): `true` until you turn it off. In a browser it does nothing, and the settings page does not show it. |
| `names` | The name each profile is shown by in the app, by its ID (`{ "kahoot-work": "Kahoot Work" }`): 1–64 characters, kept trimmed. A profile with none, or whose name is its ID, is shown by its ID, and `setSettings` takes an empty name or `null` as none. It is the app's alone: pi-optchat, the profile's folder and the terminal know the profile by its ID. |
| `cwd` | The folder a window's agent works in when the window is opened. Your home folder while it is not set. It has to exist when you set it, and is kept as its whole path (`~` is your home folder). If it is gone later, windows run in your home folder until you set another. |

`settings` reads them. `setSettings` changes the ones it names and leaves the others, so two pages changing different settings do not undo each other; every open page gets the change. A file the app cannot read counts as no settings and is left alone until you change one; a setting a file does not have, as one from before the setting was there, is as it is before it is changed. The page opens them with the gear in the title bar or ⌘, (Ctrl+, elsewhere).

## What a chat needs

`setup` answers one state for each of three things, with one message saying what to do and, where there is one, the exact command for a terminal:

| | How it is found | When it is missing |
| --- | --- | --- |
| **Pi** | `pi --version`, for the `pi` on your PATH first and then the one in the app's folder. One that does not run to its end and say its version is passed over. The one that is found is run by its whole path from then on, and a PATH entry that is not a whole path is not looked in, since it would mean another folder in each window. It has to be 1.5.2 or newer. | **Install** puts Pi into the app's folder (below). |
| **pi-optchat** | `pi list` names each package and the folder it is in; that folder's `package.json` says the version. It has to be 0.12.2 or newer: a Pi with an older one does not take a message for an agent (0.11.11), a change of settings (0.11.12) or a go-ahead to resume the agents a restart cut off (0.12.2) from the app. | **Install** runs `pi install npm:pi-optchat`, and **Update** `pi update npm:pi-optchat`. A pi-optchat that is a folder of yours (a checkout) is read the same way and never touched. |
| **A model** | Pi lists the models it has credentials for (`get_available_models`, asked of a Pi that opens no session, loads no extension and goes nowhere on the network). | On macOS, a button for each account opens a terminal where Pi signs you in (below). Elsewhere the page shows the command: `pi auth login <provider>`. The app never reads a credential. |

A fourth line in the page is the first profile. You give it a name and an ID, which follows the name until you type it ([ui.md](ui.md#what-you-see)), and `createProfile { name }` makes it under the ID, by pi-optchat's `createProfile` (from `pi-optchat/files`): pi-optchat says what an ID may be, refuses one that is taken, and writes the profile's settings and instructions as it does in a terminal. The name, when it is not the ID, is then kept in the app's own `names` ([Settings](#settings)). The profile opens at once; it needs no Pi to be made. An ID that will not do is refused under the fields, in pi-optchat's words. Every later profile is made the same way, from New profile… ([ui.md](ui.md)). Until there is one, the setup is the first thing the page shows; after that it is part of the settings, and a notice at the top says when something is missing.

The server looks once and keeps what it found: the page, an install and a window's Pi all read that one look. **Check again** looks afresh, and so does a prompt that finds no Pi, since you may have installed one in a terminal meanwhile. After an install and on **Check again**, a chat whose Pi runs an older Pi or pi-optchat than is now installed is started again on the new one, or offered a Restart if it is at work ([server.md](server.md#windows)).

### What the app changes, and what it never does

The app changes only what is its own: the Pi in its own folder, and a pi-optchat that Pi installed from npm. Those have an **Install** or **Update** button (`installable` in the protocol), and `install` refuses anything else.

- **A Pi of yours is never changed**, whether it is fine, too old, or broken, and not for a patch release either ([Updates of Pi](#updates-of-pi)). One that is too old, or has a newer Pi out, gets no button: the page shows the command that updates it (`pi update self`) for you to run. One that does not run is passed over as if it were not there.
- **A pi-optchat that is a folder of yours** (a checkout) is never installed over or updated.

### Installing Pi

The app installs Pi the way you would by hand, with npm, into its own folder:

```bash
npm install --prefix ~/.optchat-app/pi --ignore-scripts @earendil-works/pi-coding-agent@latest
```

- It needs no administrator rights and changes nothing outside that folder: not your PATH, not your shell's profile, and never a Pi you already have. A Pi on your PATH is always the one that is used. The app's own Pi, once too old, is updated the same way it was installed.
- `--ignore-scripts` means no package runs code while it is installed. Pi starts and runs a chat without them (`npm run test:live` installs one this way into a folder under `/tmp` and runs a turn with a tool through it. That turn, like the other live tests, uses the model login in your own `~/.pi/agent`, as any Pi you run does; pi-optchat is then installed into a throwaway Pi folder, not yours.)
- A Pi the app installed is not on your PATH. The page shows where it is, and the line to add to your shell's profile if you want it in a terminal too.
- Pi's own installer (`curl … | sh`) is not used: it asks questions on a terminal and edits your shell's profile.

An install runs without a terminal, one at a time. Its latest line is pushed to the page once a second. When it has ended the server looks again, and the install worked if what it was for is there now, whatever the command said of itself. When it failed, the page shows the first line that says so and the end of what it printed. Closing the server ends an install that is running; the next one puts right what it left.

The shape is T3 Code's (its provider checks and its update runner): a state per thing with one message that names the command, and an install that reports its latest line. What T3 Code does not do is install Pi or a Pi package; that part is this app's own.

### Updates of Pi

The server asks what the newest Pi is where Pi itself asks, `https://pi.dev/api/latest-version` (what makes a Pi in a terminal say "Update Available", and what `pi update` installs; Pi has no command that only says it). It asks as it starts, once a day after, and on **Check again**, and keeps the answer; one that does not come in five seconds, or while `PI_OFFLINE` is set (as for Pi), leaves what it last heard, and before the first nothing is said. A server started from code asks only when it is given how (`latest`, which the app, `npm start` and `npm run dev` pass), so no test asks the network.

- **A newer Pi is told of, quietly.** Beside a Pi that is otherwise fine the page says, in grey, "1.6.0 is available" (`latest`), and the Pi keeps its check. The app's own Pi gets **Update**, which installs `@latest` as **Install** does. A Pi of yours gets the command that updates it, for you to run.
- **A patch of the app's own Pi installs by itself.** As the server starts and once a day, when the newest Pi has the same first two numbers as the app's own and a higher third (1.5.2 to 1.5.3), the app installs it again with npm at `~1.5.2`, the newest 1.5, unless an install is running then. Once a new minor is out, a patch of the old one is not installed by itself.
- **A chat waits for an install of Pi.** A window's Pi that is started while one runs (the patch runs just as the app starts, when the page opens the main chat) starts once it has ended, on the Pi that is there then, never on files npm is swapping.
- **A new minor or major never installs by itself**, and nothing does for a Pi of yours: it has only the grey line, until you press **Update** or run the command. Pi's own updater, `pi update self`, takes no version: it installs the newest Pi in the way you installed it (Pi's managed install in `~/.pi/agent/install`, a global npm, or the command in `PI_SELF_UPDATE_COMMAND`), so the app cannot hold it to a patch without writing into Pi's folders itself or guessing how it was installed.
- **A failed one is quiet.** It is one grey line under Pi ("Pi did not update itself, and 1.5.2 still runs: …"), with what it printed, and no notice: the Pi there keeps working, and the next day it is tried again.
- **Chats move to the new Pi as after any install**: a main chat with nothing to do is started again on it, and one at work keeps its Pi and gets **Restart** ([server.md](server.md#windows)).
- Pi refreshes its model catalogs by itself every time a window's Pi starts (in RPC mode, in the background), so the app does not run `pi update --models`.

### Logging in

Pi signs in to a provider with `pi auth login <provider>`, which needs a terminal: it may ask a question first, and then opens your browser. So the app does not run it. It opens a terminal for you with that one command in it, and waits:

- `signIn { provider }` writes `sign-in-<provider>.command` into the app's folder (mode 700, written anew each time; one file for each provider, so two sign-ins do not change each other's) and opens it with macOS's `open`, which runs it in Terminal. The file holds Pi's whole path, `auth login`, and the provider. The provider is one of three the protocol names, by Pi's own names: `anthropic` (Claude), `openai-codex` (ChatGPT) and `github-copilot`. Anything else is refused before a file is written.
- What Pi asks, what you type and what it stores stay between you and Pi. The app has no API-key field, never reads `auth.json`, and never asks Pi to print a key or a token.
- The page then asks `signedIn { provider }` every three seconds, which is Pi's `pi auth check --provider <provider> --json --no-refresh`: ready or not, and nothing else. It stops when Pi says ready (and looks at the setup again), when you cancel, when the answer fails, when Pi says it cannot read its own logins (its `invalid`: the request is refused, and the page says so with the command that shows it), after a hundred asks (five minutes and a little), or when the page is gone.
- For any other provider, or with an API key, run `pi auth login` in a terminal yourself; **Check again** then finds it.
- On Linux and Windows the app opens no terminal yet: the page shows the command to copy.
- A server started from code opens no terminal unless it is given one (`opener`), so tests never do; `node src/server/main.ts` and `npm run dev` pass macOS's.

### Not handled yet

- **Windows.** Installing is written for macOS and Linux: on Windows npm is `npm.cmd` and the installed Pi is `.bin/pi.cmd`, which the server does not run yet.
- **A second profile from the app.** The field is on the first page only; more profiles are made in Pi's terminal UI for now.

## A profile a terminal has open

Only one Pi owns a profile. When a Pi outside the app holds it (one in a terminal), the app does not join it behind your back:

- The main window carries `outside`: that Pi's PID, host and folder, read from the profile's lock through `pi-optchat/files` (`profileOwner`). A holder that does not say who it is still counts (`outside: 'unknown'`). The server looks when the window is opened, before it starts a Pi on the profile, and after a start that failed. Nothing watches the profile in between.
- The page shows that in place of the composer: "This chat is running outside the app", with who has it. The history above it is still read from disk.
- A prompt to the main window is refused while it is so, and no Pi is started for it. The prompt itself looks again first, so one sent after the terminal has closed goes through.
- **Open a connected window** is the explicit way in: a connected window joins the Pi in the terminal, as it would join the app's own.
- **Check again** opens the window again, which is what looks; so does coming back to the page. Once the terminal's Pi has closed, the chat is the app's, and what that Pi wrote is read from disk.
- A connected window of the app that was using the terminal's Pi is left without an owner when that Pi closes, as any connected window is (pi-optchat hands its work over when an owner next opens the profile). The app's main window becomes that owner on its first message.
