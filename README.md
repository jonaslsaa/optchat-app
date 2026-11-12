# OptChat app

A desktop app for [pi-optchat](https://github.com/jonaslsaa/pi-optchat): one chat per profile that never ends, with the memory tree, connected windows and subagents visible instead of hidden behind a terminal.

Status: the local server ([docs/server.md](docs/server.md)) and a first usable UI ([docs/ui.md](docs/ui.md)) are built: profile tabs, windows, the chat with its history, and the composer. Try it with `npm install && npm start`.

## Layout

- **Top: profile tabs.** A profile is the thing you pick once and then stop thinking about. The tab bar is hidden while only one profile is open; opening a second profile shows two tabs.
- **Left: windows.** The profile's main window sits on top, connected windows below it. "New window" opens a connected window. Each connected window has a **Complete** button that hands its work back to the main chat (this replaces T3 Code's Settle).
- **Centre: the chat.** Composer at the bottom; you can always type, messages queue and steer mid-turn.
- **Right: agents and GitHub.** The agents working for the selected window (the main window shows all of them), and the PRs and issues the chat has mentioned, with live status.

## Principles

1. **One chat, not threads.** The sidebar holds a profile's main window and its connected windows, never a list of separate conversations.
2. **The memory is the product, so make it visible.** Every summary line opens into its originals with a click, and a toggle shows exactly what the agent sees this turn.
3. **A client, never a second brain.** The app drives the real `pi --mode rpc` with pi-optchat loaded and reads memory through `pi-optchat/core`. It does no compaction or memory logic of its own. The same profile opens in the terminal or the app interchangeably.
4. **Parallel work is first-class.** Subagents and connected windows get live cards you can read, steer, interrupt and resume.
5. **Never block the user.** Summarizing and handoffs show as a quiet activity gauge, never a spinner in the way.
6. **Steal components, not architecture.** From [T3 Code](https://github.com/pingdotgg/t3code) (MIT): the composer, markdown and code rendering, diffs, the command palette, tool-call blocks and the Pi RPC client. Not its server, multi-provider layer, source control, cloud or mobile.
7. **Small and keyboard-first.** Cost and cache numbers stay honest and visible. Features the terminal already has become panels before new ones are invented.

## Decisions so far

- **Profiles open lazily.** History is read from disk, so a main window shows at once with no Pi process running. Pi starts the first time you type in that profile.
- **The GitHub list is rebuilt from the chat log**, so it survives a restart without its own storage. Only status (open, merged, CI) is fetched, through `gh`, and only for open items.
- **Tracking an issue or PR** (poll every five minutes, tell the main agent when it changes) comes after the first version.

## Build order

1. ~~pi-optchat: let a Pi process in RPC mode join a busy profile as a connected window.~~ Done.
2. ~~The local server: profiles and history from disk, one `pi --mode rpc` per window, one typed protocol.~~ Done.
3. ~~The first usable UI, as a web page: profile tabs, windows sidebar, chat, composer, Complete.~~ Done.
4. ~~Setup: the app's settings, installing Pi and pi-optchat from the app, and a profile a terminal already has open.~~ Done ([docs/setup.md](docs/setup.md)). Logging in to a model from the app comes next.
5. The agents panel.
6. The clickable memory tree.
7. The GitHub list, then tracking.
8. The Electron shell around the same page.

## Open

- Whether a connected window's first message should wake the main agent for a whole turn.
