# Third-party notices

## T3 Code

Parts of the UI come from [T3 Code](https://github.com/pingdotgg/t3code) (commit `476fc9be`), under the MIT license below:

- `src/ui/markdownStreamBlocks.ts`: copied from `apps/web/src/components/chat/markdownStreamBlocks.ts`, without its handling of Claude's insight callouts.
- `src/ui/WorkLog.tsx`: the row and its details, copied from `apps/web/src/components/chat/WorkLog.tsx`.
- `src/ui/index.css`: the colour tokens, the `surface-glass` utility, the `.chat-markdown` rules and the window drag region (`window-bar`), from `apps/web/src/index.css`.
- `src/desktop/environment.ts`: how the login shell is asked for its environment (`-ilc`, the values between marks), after `packages/shared/src/shell.ts`.
- `src/desktop/main.ts`: the window's title bar options, from `apps/desktop/src/window/DesktopWindow.ts`.
- `src/desktop/window.ts`: the right-click menu (its entries and their order), the rule for a window's kept place (whole on one screen, a pixel past its edge allowed) and loading a crashed page again at most three times in a minute, from `apps/desktop/src/window/DesktopWindow.ts`.
- `src/ui/badge.ts`: a profile's two letters and its colour, from `apps/web/src/projectIdentity.ts` (the rules as they are) and `projectIconColors.ts` (the eighteen colours). `ProfileBadge` in `src/ui/Profiles.tsx`: the drawing, copied from `apps/web/src/components/ProjectMonogram.tsx`.
- `src/ui/ui.tsx`: the `Button` and `Kbd` class strings, from `apps/web/src/components/ui/button.tsx` and `kbd.tsx`, without Base UI.
- `src/ui/Composer.tsx`, `Rows.tsx`, `Markdown.tsx`, `Sidebar.tsx`, `Timeline.tsx` and `App.tsx`: the looks (Tailwind class strings) of T3 Code's composer, timeline rows, code block frame, sidebar thread row and new-thread heading. The components themselves are written for this app.
- `src/server/github.ts`: the patterns for where a shell starts a command and where its word ends (`START`, `END`), from `apps/server/src/orchestration-v2/PullRequestSyncReactor.ts`.
- `src/ui/Mark.tsx`: the Claude and OpenAI marks (`ClaudeAI`, `OpenAI`), from `apps/web/src/components/Icons.tsx`.
- `src/ui/Model.tsx`, `src/ui/models.ts`, and `Options` in `src/ui/ui.tsx` (the list, which the commands a `/` lists share): the look and the keys of the model picker (a search over a list, the options beside it), from `apps/web/src/components/chat/ModelPickerContent.tsx`, `ModelListRow.tsx` and `ComposerModelEffort.tsx`, and the order of its search results, after `packages/client-runtime/src/modelSearch.ts`. The components themselves are written here, without Base UI.
- `src/ui/Memory.tsx`: how a match is marked in what a search found (bold on muted text), from `apps/web/src/components/ThreadSearchMatch.tsx`.
- `src/ui/Rows.tsx`: a change's count of lines put in and taken out (`+23 −4`, green and red in mono), after `apps/web/src/components/chat/DiffStatLabel.tsx`.
- `src/ui/GitHub.tsx`: which glyph and colour stand for a pull request's state, its checks and its review, from `apps/web/src/components/pullRequest/pullRequestIcons.tsx` and `pullRequestPresentation.tsx`.
- `src/ui/Usage.tsx`: the layout of the usage page (the totals, the share bar with its list, the breakdown table) and their class strings, from `apps/web/src/components/usage/UsagePage.tsx` and `UsageShareBar.tsx` (commit `1f698f01`), without Base UI. The figures and the bars over time are written here.

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
