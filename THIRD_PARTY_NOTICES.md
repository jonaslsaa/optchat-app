# Third-party notices

## T3 Code

Parts of the UI come from [T3 Code](https://github.com/pingdotgg/t3code) (commit `476fc9be`), under the MIT license below:

- `src/ui/markdownStreamBlocks.ts`: copied from `apps/web/src/components/chat/markdownStreamBlocks.ts`, without its handling of Claude's insight callouts.
- `src/ui/WorkLog.tsx`: the row and its details, copied from `apps/web/src/components/chat/WorkLog.tsx`.
- `src/ui/index.css`: the colour tokens, the `surface-glass` utility and the `.chat-markdown` rules, from `apps/web/src/index.css`.
- `src/ui/ui.tsx`: the `Button` and `Kbd` class strings, from `apps/web/src/components/ui/button.tsx` and `kbd.tsx`, without Base UI.
- `src/ui/Composer.tsx`, `Rows.tsx`, `Markdown.tsx`, `Sidebar.tsx`, `Timeline.tsx` and `App.tsx`: the looks (Tailwind class strings) of T3 Code's composer, timeline rows, code block frame, sidebar thread row and new-thread heading. The components themselves are written for this app.
- `src/server/github.ts`: the patterns for where a shell starts a command and where its word ends (`START`, `END`), from `apps/server/src/orchestration-v2/PullRequestSyncReactor.ts`.
- `src/ui/GitHub.tsx`: which glyph and colour stand for a pull request's state, its checks and its review, from `apps/web/src/components/pullRequest/pullRequestIcons.tsx` and `pullRequestPresentation.tsx`.

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
