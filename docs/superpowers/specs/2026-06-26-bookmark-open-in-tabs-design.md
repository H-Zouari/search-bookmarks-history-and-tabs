# Open Selected Bookmarks in New Tabs — Design

**Status:** Approved (2026-06-26)

## Goal

In the Bookmark Manager's **Bookmarks** panel, let the user open every **checked**
bookmark in a new **background** browser tab from a single toolbar button. When the
number of checked bookmarks exceeds a configurable threshold (default **30**), show a
confirmation dialog first so the user does not accidentally open hundreds of tabs.

## Context

The Bookmark Manager (`popup/bookmarkManager.html`, controller
`popup/js/initBookmarkManager.js`, view `popup/js/view/bookmarkManagerView.js`)
already has a multi-select "managed bookmarks" workspace:

- Per-row checkboxes write into `ext.model.bookmarkManagerSelectedIds` (a `Set`).
- `getSelectedManagedBookmarkIds()` returns the **checked** ids.
- `getManagedActionTargetIds()` returns checked ids, or the focused bookmark if none
  are checked (used by Move / tag actions).
- `getBookmarksByIds(ids)` resolves ids to bookmark objects (each has `originalUrl`).
- Toolbar actions (Move, Suggest tags, Add/Replace/Remove tags) are wired in
  `bindBookmarkManagerEvents({...})` and implemented as side-effecting handlers in the
  controller, gating destructive steps behind `window.confirm`.
- `updateManagedSelectionUi()` enables/disables toolbar buttons from the current
  selection.

Tab opening already has an idiom (`popup/js/view/searchEvents.js`):
`ext.browserApi.tabs.create({ active, url })` with a `window.open(url, '_newtab')`
fallback when the tabs API is unavailable.

Warning dialogs already have an idiom (`popup/js/helper/localAiTags.js`):
an exported limit constant + a pure text-builder function + a `window.confirm` call.

Options are defined in `popup/js/model/optionsDefaults.js`, validated against
`popup/json/options.schema.json`, and the Options UI (`popup/js/view/editOptionsView.js`)
**auto-generates** an input for each schema property using its `x-ui-section`, `type`,
`minimum`/`maximum`, `default`, and `description`.

## Decisions (confirmed with user)

1. **Button placement:** top toolbar of the Bookmarks panel, next to *Select Visible*
   and *Clear* (`.bookmark-browser-actions`).
2. **Target set:** **checked bookmarks only.** The button is disabled when nothing is
   checked, even if a row is focused. Uses `getSelectedManagedBookmarkIds()`, **not**
   `getManagedActionTargetIds()`.
3. **Tab activation:** **background** tabs (`active: false`), keeping focus on the
   manager — matches a browser's native "Open all in tabs".
4. **Warning threshold:** **configurable user option** `openTabsWarningThreshold`,
   default **30**, surfaced in the Options UI. Warn when `count > threshold`
   (exactly 30 does not warn; 31 does).

## Architecture

### New pure helper — `popup/js/helper/openBookmarkTabs.js`

No DOM access; fully unit-testable.

- `export const OPEN_TABS_WARNING_THRESHOLD_DEFAULT = 30`
- `export function getOpenTabsWarningThreshold(opts)` — returns
  `opts.openTabsWarningThreshold` when it is an integer ≥ 1, otherwise
  `OPEN_TABS_WARNING_THRESHOLD_DEFAULT`.
- `export function createOpenTabsWarning(count, threshold)` — confirmation text,
  mirroring `createLargeLocalAiTagSelectionWarning`.
- `export function collectOpenableBookmarkUrls(bookmarks)` — maps to `originalUrl`,
  filters out falsy/empty values, preserves order, no dedupe.
- `export function openUrlsInTabs(urls, browserApi)` — for each url: if
  `browserApi?.tabs?.create` exists, call `browserApi.tabs.create({ active: false, url })`;
  otherwise `window.open(url, '_newtab')`. Returns the count opened.

### Controller — `popup/js/initBookmarkManager.js`

New handler `openSelectedBookmarksInTabs()`:

1. `const selectedIds = getSelectedManagedBookmarkIds()`; return if empty.
2. `const urls = collectOpenableBookmarkUrls(getBookmarksByIds(selectedIds))`;
   return if empty.
3. `const threshold = getOpenTabsWarningThreshold(ext.opts)`.
4. If `urls.length > threshold` and `!window.confirm(createOpenTabsWarning(urls.length, threshold))`,
   return without opening.
5. `const opened = openUrlsInTabs(urls, ext.browserApi)`.
6. `showManagerStatus(`Opened ${opened} bookmark(s) in new tabs`, 'success')`.

Wired via a new `onOpenSelectedInTabs` key in the `bindBookmarkManagerEvents({...})`
call. Imports `getSelectedManagedBookmarkIds` (already exported by the view) and the
new helper functions.

### View — `popup/js/view/bookmarkManagerView.js`

- `getBookmarkManagerDom()`: add
  `openSelectedBookmarks: document.getElementById('open-selected-bookmarks')`.
- `bindBookmarkManagerEvents(...)`: accept `onOpenSelectedInTabs`; add
  `dom.openSelectedBookmarks.addEventListener('click', onOpenSelectedInTabs)`.
- `updateManagedSelectionUi()`: add
  `dom.openSelectedBookmarks.disabled = selectedCount === 0` (the existing
  `selectedCount` is the checked count — checked-only semantics).

### HTML — `popup/bookmarkManager.html`

Inside `.bookmark-browser-actions` (after the *Clear* button):

```html
<button id="open-selected-bookmarks" class="button secondary" type="button"
  title="Open checked bookmarks in new background tabs" disabled>Open in tabs</button>
```

### Option plumbing

- `popup/js/model/optionsDefaults.js`: add `openTabsWarningThreshold: 30` under the
  `BOOKMARKS OPTIONS` block.
- `popup/json/options.schema.json`: add an integer property (`minimum: 1`,
  `default: 30`, `x-ui-section: "bookmarks"`, descriptive `description`) next to
  `detectDuplicateBookmarks`.
- `OPTIONS.md`: document the new option in the Bookmarks section.

## Data flow

checked rows → `getSelectedManagedBookmarkIds()` → `getBookmarksByIds()` →
`collectOpenableBookmarkUrls()` → [warn if `count > threshold`] →
`openUrlsInTabs()` → background tabs + `showManagerStatus`.

## Error handling

- Empty checked selection → button disabled; handler no-ops.
- No openable URLs after filtering → no-op.
- User dismisses the warning → nothing opens.
- `tabs.create` / `window.open` are fire-and-forget (matching `searchEvents.js`); no
  try/catch is added.

## Behavior in preview / E2E mode

Playwright serves the static page with no extension APIs, so `browserApi.tabs` is
undefined and `openUrlsInTabs` uses the `window.open` fallback. Mock data
(`mockData/chrome.json`) provides **35 bookmarks**, so *Select Visible* (35) exceeds the
default threshold (30) and exercises the warning path. Tests stub `window.open` via
`page.addInitScript` and handle the confirm via `page.on('dialog')`.

## Testing

### Unit — `popup/js/helper/__tests__/openBookmarkTabs.test.js`
- `getOpenTabsWarningThreshold`: valid value, non-integer/zero/negative/missing → default.
- `createOpenTabsWarning`: includes count and threshold.
- `collectOpenableBookmarkUrls`: maps `originalUrl`, drops blanks, preserves order.
- `openUrlsInTabs`: with a fake `browserApi.tabs.create` (background option) and with the
  `window.open` fallback; returns opened count.

### Unit — view (`bookmarkManagerView.test.js`) & controller (`initBookmarkManager.test.js`)
- Button disabled with no checked selection, enabled when ≥ 1 checked.
- Clicking opens via `ext.browserApi.tabs.create` once per checked bookmark with
  `{ active: false, url }`.
- Over-threshold selection calls `window.confirm`; `confirm = false` opens nothing.
- Both jsdom DOM fixtures gain the `#open-selected-bookmarks` button (and the controller
  fixture's fake `browserApi` gains `tabs: { create: jest.fn() }`).

### E2E — `playwright/tests/bookmarkManager.spec.js`
New describe block (stubs `window.open`, registers a dialog handler):
1. Button disabled until a bookmark is checked; enabled after.
2. Check 2 bookmarks → click → exactly those 2 URLs opened, **no** dialog.
3. *Select Visible* (35 > 30) → click → warning dialog appears; **accept** → 35 opened;
   in a second case **dismiss** → 0 opened.

## Scope

Single, self-contained plan. No background worker, network, or telemetry. No changes to
the search popup — Bookmark Manager only.
