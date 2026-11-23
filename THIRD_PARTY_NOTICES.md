# Third-party notices

## T3 Code

Parts of the UI come from [T3 Code](https://github.com/pingdotgg/t3code) (commit `476fc9be`), under the MIT license below:

- `src/ui/markdownStreamBlocks.ts`: copied from `apps/web/src/components/chat/markdownStreamBlocks.ts`, without its handling of Claude's insight callouts.
- `src/ui/WorkLog.tsx`: the row and its details, copied from `apps/web/src/components/chat/WorkLog.tsx`.
- `src/ui/index.css`: the colour tokens, the `surface-glass` utility, the `.chat-markdown` rules and the window drag region (`window-bar`), from `apps/web/src/index.css`.
- `src/desktop/environment.ts`: how the login shell is asked for its environment (`-ilc`, the values between marks), after `packages/shared/src/shell.ts`.
- `src/desktop/main.ts`: the window's title bar options, from `apps/desktop/src/window/DesktopWindow.ts`.
- `src/desktop/menu.ts`: the order of the app menu's entries, and leaving a key to the page that already has it (`triggeredByAccelerator`), after `apps/desktop/src/window/DesktopApplicationMenu.ts`.
- `src/desktop/window.ts`: the right-click menu (its entries and their order), the rule for a window's kept place (whole on one screen, a pixel past its edge allowed) and loading a crashed page again at most three times in a minute, from `apps/desktop/src/window/DesktopWindow.ts`.
- `src/ui/badge.ts`: a profile's two letters and its colour, from `apps/web/src/projectIdentity.ts` (the rules as they are) and `projectIconColors.ts` (its colours, without the red and in darker shades on a light page). `ProfileBadge` in `src/ui/Profiles.tsx`: the drawing, copied from `apps/web/src/components/ProjectMonogram.tsx`.
- `src/ui/ui.tsx`: the `Button` and `Kbd` class strings, from `apps/web/src/components/ui/button.tsx` and `kbd.tsx`, without Base UI.
- `src/ui/Composer.tsx`, `Rows.tsx`, `Markdown.tsx`, `Sidebar.tsx`, `Timeline.tsx` and `App.tsx`: the looks (Tailwind class strings) of T3 Code's composer, timeline rows, code block frame, sidebar thread row and new-thread heading. The components themselves are written for this app.
- `src/server/github.ts`: the patterns for where a shell starts a command and where its word ends (`START`, `END`), from `apps/server/src/orchestration-v2/PullRequestSyncReactor.ts`.
- `src/ui/Update.tsx`: the update button's looks (the round button, the ring a download fills and its numbers, the mark on an update that waits) and the turn that is finished once a look is over, after `apps/web/src/components/sidebar/DesktopUpdateStatusIcon.tsx` and `SidebarUpdatePill.tsx`.
- `src/ui/Mark.tsx`: the Claude and OpenAI marks (`ClaudeAI`, `OpenAI`), from `apps/web/src/components/Icons.tsx`.
- `src/ui/Model.tsx`, `src/ui/models.ts`, and `Options` in `src/ui/ui.tsx` (the list, which the commands a `/` lists share): the look and the keys of the model picker (a search over a list, the options beside it), from `apps/web/src/components/chat/ModelPickerContent.tsx`, `ModelListRow.tsx` and `ComposerModelEffort.tsx`, and the order of its search results, after `packages/client-runtime/src/modelSearch.ts`. The components themselves are written here, without Base UI.
- `src/ui/find.ts`, `Find.tsx`: find in the chat, from `apps/web/src/components/chat/threadFindHighlights.ts` and `ThreadFindBar.tsx`: text gathered block by block and marked with CSS highlights over ranges, the bar's layout, and the two colours of a match (`index.css`). Written anew and much smaller: no rows by id, no store, no server search.
- `src/ui/Memory.tsx`: how a match is marked in what a search found (bold on muted text), from `apps/web/src/components/ThreadSearchMatch.tsx`.
- `src/ui/Cite.tsx`, `src/ui/Composer.tsx`: the card a message shows for what it cites (the class string of `ResponseCard`), the chip it is in the composer (a quote mark, how it begins, edit button) and the floating comment popover (Enter/⌘Enter/Esc/outside-click rules), after `apps/web/src/components/chat/AssistantCitationChip.tsx`, `AssistantCitationCommentEditor.tsx` and `assistantCitationCommentDismissal.ts`; the button on a selection after `AssistantSelectionToolbar.tsx`. How a citation is written is this app's own.
- `src/ui/Picture.tsx`: the picture shown large, from `apps/web/src/components/chat/ExpandedImageDialog.tsx` (the buttons at the sides and the ×, their class strings, ← and → round the ends, the counter), `ZoomableImage.tsx` (the fit to the window, zoom up to 8× about a point that stays in place, a pinch as a wheel with Ctrl, a click that zooms in two times and out, the drag that moves a zoomed picture and is no click, + − 0, and the arrows that move it before they step) and `markdownImageGallery.ts` (a message's pictures read from the page under a mark).
- `src/ui/Rows.tsx`: a change's count of lines put in and taken out (`+23 −4`, green and red in mono), after `apps/web/src/components/chat/DiffStatLabel.tsx`.
- `src/ui/Rows.tsx`: the chip a message shows for the skill it runs (the box icon, the name in the message's own colour), after `ContextChip kind="skill"` and `SkillChipIcon` in `apps/web/src/components/ContextChip.tsx` and `chat/SkillInlineText.tsx`.
- `src/ui/Typeset.tsx`, `src/ui/Markdown.tsx`: formulas as T3 Code draws them (`remark-math` with single dollars, KaTeX in a lazy chunk with `trust: false`, the TeX as written while it cannot be read), from `apps/web/src/components/chat/MarkdownMath.tsx` and `MathTypeset.tsx`; and a table's copy as Markdown or CSV under it, from `chat/MarkdownTable.tsx` and `markdown-clipboard.ts` (CSV quoting). T3 Code keeps prices as prose with a patched tokenizer; here it is Pandoc's rule after the parse (`src/ui/math.ts`), tested with T3 Code's examples.
- `src/ui/paths.ts`: which inline code is a file's path (a folder or a line in it, a file's extension at its end, `:line` or `#L`), after `inlineCodeFilePathCandidate` in `packages/shared/src/markdownLinks.ts`; and `src/server/files.ts`: how each editor is told the line (`-g file:line`, `file:line`), from `packages/contracts/src/editor.ts`.
- `src/server/files.ts` and `src/ui/OpenIn.tsx`: the editors a file opens in, how each is told the line (Cursor's `--classic`, `-g file:line`, Zed's `file:line`, JetBrains' `--line`) and Finder's `open -R`, from `EDITORS` in `packages/contracts/src/editor.ts`; the "Open in" split button and its list, after `apps/web/src/components/chat/OpenInPicker.tsx`, and the editor picked last, used while it is there and else the first found, after `usePreferredEditor` in `apps/web/src/editorPreferences.ts`.
- `src/server/ranking.ts`: how a name is ranked against what is typed (the whole of it, a prefix, a word, anywhere, the letters in order, and the penalties of each), from `scoreQueryMatch` and `scoreSubsequenceMatch` in `packages/shared/src/searchRanking.ts`; and the list an `@` opens in `src/ui/Commands.tsx` (a file's name with its folder after it), after `apps/web/src/components/chat/ComposerCommandMenu.tsx`.
- `src/ui/GitHub.tsx`: which glyph and colour stand for a pull request's state, its checks and its review, from `apps/web/src/components/pullRequest/pullRequestIcons.tsx` and `pullRequestPresentation.tsx`.
- `src/ui/Usage.tsx`: the layout of the usage page (the totals, the share bar with its list, the breakdown table) and their class strings, from `apps/web/src/components/usage/UsagePage.tsx` and `UsageShareBar.tsx` (commit `1f698f01`), without Base UI. The figures and the bars over time are written here.
- `src/ui/themes/*.json`: the palettes of the five named themes (Blossom, Grove, Ocean, Ember, Iris), from `packages/shared/src/themePalettes.ts` mapped onto this app's colours, with their sidebar art colours from `apps/web/src/index.css` (the night sky's, mixed from the art colours where that file mixes them). `src/ui/themes.ts`: the theme file (`version`, `name`, `appearance`, `colors`, `variants`), after `parseThemeFile` in `apps/web/src/themePalette.ts`. `src/ui/Appearance.tsx`: the colour scheme's tiles and their small window, the theme cards with a round for light and one for dark, and their class strings, from `apps/web/src/components/settings/ThemeSettings.tsx`, `ThemeWireframe.tsx`, `ThemePreviewCircles.tsx` and `packages/shared/src/themePreview.ts`, without the editor and the import. `src/ui/Art.tsx` and the `sidebar-art` utility in `index.css`: the night sky at the sidebar's top and its fade, from `apps/web/src/components/SidebarStageBackdrop.tsx` (`NightlySkyArt`) and `index.css`.
- `build/background.svg` and the `dmg` block of `electron-builder.yml`: the layout of the dmg's window (its size, where the two icons are and how large, a name, a headline, an arrow and a line under them), after `apps/desktop/resources/dmg/dmg-background-latest.svg` and `scripts/build-desktop-artifact.ts`. The picture itself is drawn here.

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
