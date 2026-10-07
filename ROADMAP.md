# Roadmap

Plan for everything in `TODO.md`. The items are ordered so that each phase builds on the one before it. The quick UI wins come first, the data-model changes come in the middle, and the two external integrations come last.

| # | Item | Size | Touches data format? | Status |
|---|------|------|----------------------|--------|
| 1 | Denser sidebar | S | No | ✅ Done |
| 2 | Sidebar search bar | M | No | ✅ Done |
| 3 | Starring tasks (finish it) | S–M | Maybe (one optional synced setting) | ✅ Done |
| 4 | Drag and drop tasks between lists | M | No | Not started |
| 5 | List folders | L | **Yes**: new `data/folders.json`, `TaskList.folderId` | Not started |
| 6 | Google Calendar integration | XL | **Yes**: synced calendar settings, `TaskSource.htmlLink` | Not started |
| 7 | Chrome extension | L | No (writes the existing task format) | Not started |

Every format change is **additive and optional**. Missing fields get default values when they're read, so older copies of the app on other devices keep working.

---

## Phase 0: groundwork (do this alongside phases 1–3)

**"View" abstraction.** Right now the main pane can only show one list (`selectedListId: string`). The search bar and the Important view both need the main pane to show something other than a single list. Replace `selectedListId` in `AppStateContext.tsx` with:

```ts
type View =
  | { kind: 'list'; listId: string }
  | { kind: 'important' }
  | { kind: 'search'; query: string }
```

`TaskListView` gets the tasks it should show from the view: a list filter, a starred filter, or search matches. It also decides whether to apply `rankTasks`, and which list `AddTaskBar` should add into. `App.tsx` builds the header title from the view.

**Tests.** There's no test runner yet. Add `vitest` and cover the pure logic in `src/shared/` that phases 2, 3, 5 and 6 will add or change: search matching, ranking with starring, the calendar event → task mapping, and the overdue promotion.

---

## Phase 1: make the sidebar lists denser (S) — ✅ Done

**Root cause of most of the wasted space:** in `.list-row`, the delete button (`.list-delete`) comes after a full-width `display:flex` `.nav-item`. So it wraps onto **its own line** under every custom list. It's `visibility: hidden`, so you can't see it, but it still takes up its full height. Fix:

- `.list-row { display: flex; align-items: center; }`, with `.nav-item` set to `flex: 1; min-width: 0`. As an alternative, position `.list-delete` absolutely over the right edge and hide the count while the row is hovered.
- Tighten the spacing: `.nav-item` padding `9px 10px` → `5px 10px`, font size 13px; `.sidebar-section` gap → 0; `.sidebar-divider` margin `10px` → `6px`; trim `.sidebar-title` padding; give `.new-list-row` the same padding as `.nav-item`.

Files: `src/renderer/src/styles/global.css` and possibly `Sidebar.tsx`.

## Phase 2: search bar at the top of the sidebar (M) — ✅ Done

- Put an `<input type="search">` above the "Tasks" item in `Sidebar.tsx`. Typing in it switches the view to `{ kind: 'search', query }`. Clearing it, or pressing Esc, returns to the previous view.
- Add `Ctrl+F` / `Ctrl+K` to focus the search box (a `keydown` listener in `App.tsx`).
- New `src/shared/search.ts`: `searchTasks(tasks, query)` does a case-insensitive match on title and notes and skips archived tasks.
- Results view: matching active tasks across **all lists**, each showing its list name as a small tag, with completed matches in a collapsed section. Clicking a result opens the existing `TaskDetailPanel`. The `AddTaskBar` is hidden in this view.
- Header title: `Search: "query"`.

## Phase 3: starring tasks (S–M) — ✅ Done

This is already partly built. The `starred` field exists, rows have a star button, and the detail panel has a "Mark important" toggle. What's missing:

- An **Important** smart view in the sidebar, directly under "Tasks", with a ★ icon and a count. It shows starred, incomplete tasks from every list, each tagged with its list name. Adding a task from this view creates it in the main Tasks list, already starred.
- Ranking: should a star change the sort order? *(Open question 2.)* My recommendation is a synced setting, `ranking.starredFirst: boolean` (default `false`). When it's on, starred tasks float to the top of their **own priority tier** in `rankTasks`, and to the top of the plain lists. That keeps the P1-always-first rule intact.
- Make the wording consistent: the TODO says "star", the UI says "important". Pick one. I'd keep "Important" for the view and ★ for the button.

Files: `Sidebar.tsx`, `TaskListView.tsx`, `AppStateContext.tsx`, `shared/ranking.ts`, `shared/types.ts`, `SettingsModal.tsx`.

## Phase 4: drag and drop tasks between lists (M)

Use the browser's native HTML5 drag-and-drop. It works in Electron and needs no new dependency.

- In `TaskRow`, set `draggable` and an `onDragStart` handler that sets `dataTransfer.setData('application/x-todo-task', task.id)`. Conflicted tasks can't be dragged, because moving one would create another edit on top of an unresolved conflict.
- Every list entry in the sidebar becomes a drop target. On `dragover`, call `preventDefault()` only when the MIME type matches, and add a `.drop-target` highlight class. On `drop`, call `moveTask(id, listId)` in `AppStateContext`, which is `updateTask({ ...task, listId })`. Dropping onto the task's current list does nothing.
- Dropping onto **Important** stars the task instead of moving it.
- Out of scope: reordering tasks by hand inside a list. The main list is ranked automatically and the other lists sort by date, so manual order has no meaning there.
- This phase builds the drag-and-drop plumbing, with a typed MIME string for each kind of draggable thing, that phase 5 reuses for dragging lists into folders.

## Phase 5: list folders (L)

**Data model** (`shared/types.ts`):

```ts
export interface TaskFolder { id: string; name: string; order: number }
export interface TaskList { id; name; order; folderId?: string | null }  // new optional field
```

Folders go in a new synced file, `data/folders.json`, rather than being packed into `lists.json`. That way the existing `lists.json` array format stays the same for older clients and the planned Android app.

**Plumbing.** This follows the exact pattern `lists.json` already uses:
- `localCache.ts`: `getFolders`, `writeFoldersLocal`, `getSyncedFolders`, `setSyncedFolders`, and a new `SyncMeta.foldersDirty` that defaults to `false` when an older meta file is read.
- `sync.ts`: push with `pushSingleFile` and pull with `pullSingleFileIfChanged`, the same way `LISTS_PATH` works.
- `shared/ipc.ts`, `preload/index.ts`, `main/ipc.ts`: add `folders.getAll` and `folders.save`.
- `AppStateContext`: `addFolder`, `renameFolder`, `deleteFolder` (its lists move back to the top level; nothing is deleted), and `moveListToFolder`.

**UI** (`Sidebar.tsx`):
- Folders are collapsible rows with a chevron, a folder icon and the total count of their lists. Their lists sit indented underneath. Folders and lists without a folder share one `order` space at the top level.
- Whether a folder is collapsed is stored **per device** in `localStorage`, not synced.
- Create a folder with a "New folder" option next to the "New list" input. Move a list by dragging it onto a folder (MIME `application/x-todo-list`, reusing phase 4), or with a right-click "Move to folder…" menu.
- Lists can't be renamed in the UI yet, even though `renameList` already exists. Add double-click-to-rename for both lists and folders.
- Folders are one level deep only: no folders inside folders.
- Defensive rendering: a list whose `folderId` points to a folder that no longer exists is shown at the top level. This can happen because `lists.json` and `folders.json` are synced separately and the last writer wins.

**Risk:** folders and drag-and-drop mean `lists.json` gets edited much more often. It's last-writer-wins, so if two devices both reorganize lists before syncing, one device's changes are lost. That's acceptable for now. Note it in the README.

## Phase 6: Google Calendar integration (XL)

**Prerequisites (you have to do these; I can't):**
1. Create a Google Cloud project and enable the **Google Calendar API**.
2. Set up the OAuth consent screen: user type External, and add yourself as a test user.
3. Create an OAuth client ID of type **Desktop app**, and copy the client ID and secret.
4. ⚠️ While the consent screen is in **Testing** status, refresh tokens expire after **7 days**, so you'd have to reconnect every week. To avoid that, switch it to **In production**. Without verification you get an "unverified app" warning screen, which is fine for personal use.

**Auth** (new file `src/main/googleAuth.ts`, plain `fetch` like `github.ts`, no `googleapis` dependency):
- OAuth installed-app flow with **PKCE and a loopback redirect** (`http://127.0.0.1:<random port>`). Open the consent page in the system browser with `shell.openExternal`, catch the redirect with a one-shot `http` server, and exchange the code at `oauth2.googleapis.com/token`.
- Scope: `https://www.googleapis.com/auth/calendar.readonly`.
- Store the refresh token and client secret **encrypted with `safeStorage`**. Generalize `secureStore.ts` from a single GitHub-token file into named secrets. The access token lives only in memory and is refreshed when needed.

**Settings:**
- *Local (per device)*: client ID/secret, connection status. Only devices that are connected run the import.
- *Synced (`SyncedSettings.calendar`)*: selected calendar IDs, target list, how many days ahead to import, default priority, and whether to promote overdue tasks to P1.

**Import** (new file `src/main/calendarImport.ts`):
- For each selected calendar, fetch `GET /calendars/{id}/events?singleEvents=true&timeMin=…&timeMax=…`.
- Each event becomes a `Task`: title = summary, notes = description, dueDate = the start date (`start.date` for all-day events, `start.dateTime` for timed ones), and `source = { type: 'google_calendar', calendarId, eventId, htmlLink }`. `htmlLink` is a new optional field.
- **Deterministic task ID**, a UUID-shaped hash of `calendarId + eventId`. Two devices importing the same event then produce the same file path instead of duplicates.
- Each event is **imported only once.** Keep a ledger of imported IDs on each device so that a task you deleted or edited never gets recreated or overwritten. *(Open question 3: should changes to the event, like a new time or cancellation, carry over to the task?)*
- **Overdue → P1**: an incomplete imported task whose `dueDate` is before today gets `priority: 1`. *(Open question 3: should this apply to every task with a due date?)*
- **When it runs**: the Sync button does sync (pull) → import → sync again if anything was imported. Pulling first means imported tasks never collide with files another device already pushed. There's also an "Import now" button in Settings.

**UI:** Replace the "Coming soon" block in `SettingsModal` with: client ID/secret fields, a Connect/Disconnect button, a list of calendars with checkboxes (from `calendarList`), the target list, days ahead, default priority, the overdue toggle and the last import result. Imported tasks show a 📅 marker in `TaskRow`, and an "Open in Google Calendar" link in `TaskDetailPanel`.

## Phase 7: Chrome extension (L)

*(Open question 4: what should it do? This plan assumes **quick-add from the browser**.)*

**Recommended design: the extension writes directly to the GitHub repo.** It creates `data/tasks/<uuid>.json` in the existing format. That makes it completely independent of the desktop app, which picks the task up on its next Sync like any other remote change. The alternatives were rejected:
- *Native messaging*: needs a registry-installed host manifest, and Electron is awkward as a native host.
- *Local HTTP server in the app*: only works while the app is running, and needs CSRF/auth hardening.

**Contents** (new `extension/` folder, Manifest V3):
- **Popup**: title prefilled from the tab title, notes prefilled with the URL, a priority picker, a list dropdown (read from `data/lists.json`) and a star toggle → **Add**.
- **Context menu**: "Add to TODO" on a page, link or selected text.
- **Options page**: repo owner/name/branch plus a PAT. Use a **separate** fine-grained PAT scoped to just the tasks repo, so it can be revoked on its own. It's stored in `chrome.storage.local`, which is *not* OS-encrypted like DPAPI. That's weaker than the desktop app, and the README should say so.

**Shared code:**
- Move the GitHub client from `src/main/github.ts` into `src/shared/` and make it environment-agnostic: `TextEncoder` plus a base64 helper instead of Node's `Buffer`. The app and the extension then share one client and one `types.ts`, so the format can't drift.
- Build the extension with its own small Vite config into `extension/dist`. Load it unpacked from `chrome://extensions`. Add an `npm run build:extension` script.
- Use commit messages of the form `Add task (Chrome): <title>`.

---

## Wrap-up for each phase

- Update `README.md`: remove "Coming soon" / "Not yet implemented", add the new `data/` files to the format section, and add setup steps for Google and the extension.
- Tick the item off in `TODO.md`. The empty trailing `- ` bullet can go too.
- `npm run typecheck`, then check by hand with `npm run dev`. Test sync between two machines, or two separate `userData` directories, for phases 5 and 6.

## Open questions

1. **Search**: should it search *tasks across all lists*, as planned, or just filter the list names in the sidebar?
2. **Starring**: should starred tasks move up in the sort order (as an option), or only appear in the Important view?
3. **Google Calendar**: should changes to an event after import (new time, cancellation) update the task? And should "overdue → P1" apply only to imported tasks, or to every task with a due date?
4. **Chrome extension**: is it for quick-adding tasks from the browser, as planned, or do you also want to see and complete tasks from it?
5. **Folders**: is one level deep enough?
