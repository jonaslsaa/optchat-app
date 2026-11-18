# Design

What the app is made of, what was decided, and what is built. The [README](../README.md) is the product page; the rules a change must follow are in [AGENTS.md](../AGENTS.md).

| Doc | What it has |
| --- | --- |
| [server.md](server.md) | The local server and its protocol. |
| [ui.md](ui.md) | The page: what you see, the keys, how it is built. |
| [setup.md](setup.md) | The app's settings, installing Pi and pi-optchat, signing in. |
| [desktop.md](desktop.md) | The Electron shell, updates, releasing, the first open. |

## Run it

```sh
npm install
npm start         # the page in a browser, at the address it prints (http://127.0.0.1:4780/#<token>)
npm run desktop   # the desktop app, from this folder
```

More in [ui.md](ui.md#run-it) and [desktop.md](desktop.md#run-it).

## Layout

- **Top: profile tabs.** A profile is the thing you pick once and then stop thinking about. The tab bar is hidden while only one profile is open; opening a second profile shows two tabs.
- **Left: windows.** The profile's main window sits on top, connected windows below it. "New window" opens a connected window. Each connected window has a **Complete** button that hands its work back to the main chat (this replaces T3 Code's Settle).
- **Centre: the chat.** Composer at the bottom; you can always type, messages queue and steer mid-turn.
- **Right: agents and GitHub.** The agents working for the selected window (the main window shows all of them), and the PRs and issues the chat has mentioned, with live status.

## Decisions so far

- **Profiles open lazily.** History is read from disk, so a main window shows at once with no Pi process running. Pi starts the first time you type in that profile.
- **The GitHub list is rebuilt from the chat log**, so it survives a restart without its own storage. Only status (open, merged, CI) is fetched, through `gh`: once for each item, and again only for those not merged or closed.
- **Tracking an issue or PR** (poll every five minutes, tell the main agent when it changes) comes after the first version.
- **Importing another tool's history is pi-optchat's**, read and summarized by it in the profile's own Pi; the app finds what there is, lets you pick it and shows how it goes ([ui.md](ui.md#import), [server.md](server.md#imports)). The page names a conversation by its source and id, never by its file, and nothing is picked until you pick it: a large import keeps the compactor busy for a long time.
- **The same profile opens in the terminal or the app**, since the app drives the real `pi --mode rpc` with pi-optchat loaded and does no compaction or memory logic of its own.

## Build order

1. ~~pi-optchat: let a Pi process in RPC mode join a busy profile as a connected window.~~ Done.
2. ~~The local server: profiles and history from disk, one `pi --mode rpc` per window, one typed protocol.~~ Done ([server.md](server.md)).
3. ~~The first usable UI, as a web page: profile tabs, windows sidebar, chat, composer, Complete.~~ Done ([ui.md](ui.md)).
4. ~~Setup: the app's settings, installing Pi and pi-optchat from the app, and a profile a terminal already has open.~~ Done ([setup.md](setup.md)). Logging in to a model from the app is there too (macOS), and so are a profile's own settings: everything pi-optchat's settings page has in a terminal ([ui.md](ui.md#a-profiles-settings)). The model a chat and its subagents run on is picked in the composer ([ui.md](ui.md#model)).
5. ~~The agents panel: the main chat's agents, live, each one's chat to read, and telling, interrupting, stopping and resuming one from there.~~ Done ([ui.md](ui.md#agents)). An agent's words as it writes them are next.
6. The clickable memory tree. Reading it is done: the main chat as the agent reads it, every line opening down to its messages, and a search that finds a message and opens the tree at it ([ui.md](ui.md#memory-view)). Changing it is next.
7. The GitHub list. Its first part is done: the issues and pull requests the main chat named by link, with how they stand ([ui.md](ui.md#github)). Tracking them is next.
8. ~~The Electron shell around the same page.~~ Done for macOS ([desktop.md](desktop.md)): `npm run dist` builds the app and a dmg, and the app updates itself from the releases ([desktop.md](desktop.md#updates)).

## Being built

Decided, and named in the README as if they were there. Take one off this list when it lands, with a link to where it is described.

- Pi's notices shown in the chat, and a message Pi refuses put back in the composer.
- A `/` menu of commands in the composer.
- Images in the composer: paste, drop or attach.
- ↑ to recall earlier messages, and ⌘F to find in the chat.
- Quoting a selection into the composer.

## Open

- Whether a connected window's first message should wake the main agent for a whole turn. From pi-optchat #312 on it does not: the window's start is told to the main agent with its next turn.
- Whether a connected window should start on the model the profile keeps for its main chat. Today it starts on Pi's default.
- Not decided, so not in the README: notifications and a Dock badge, watching a pull request, opening a folder, a ⌘K command palette, Windows and Linux, and an app signed with an Apple Developer ID.

## The README's pictures

`docs/images/` holds four states of `npm run screenshots` (34 `chat`, 30 `memory`, 44 `agent`, 08 `window`), each in light and with `--dark`, so they show seeded chats and never a real profile. Each PNG is made smaller with `cwebp -q 88 -sharp_yuv -resize 1760 0`. Make them again when the look changes.
