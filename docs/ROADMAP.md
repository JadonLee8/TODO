# Roadmap

Feature phases for the TODO app. `TODO.md` (repo root) is the short checklist; this file has the reasoning.
The bigger plan everything feeds into, one knowledge base across tasks, video notes and Obsidian, is in
[KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md).

**Data format policy:** while only one person on one or two devices uses the app, the format in `src/shared/types.ts`
may change freely (no migration code). Settings loaders still fill missing fields with defaults. Once the Android app
or a second user exists, changes become additive and optional.

## Done

| # | Phase | Notes |
|---|-------|-------|
| 0 | View abstraction, vitest | The main pane shows a `View`: list, Important, search or stats. |
| 1 | Denser sidebar | |
| 2 | Sidebar search | Ctrl+F / Ctrl+K. Searches task titles and notes across lists. |
| 3 | Starring | Important view; optional "starred first" ranking within each priority tier. |
| 4 | Drag tasks between lists | Native HTML5 DnD, one MIME type per draggable kind (`dnd.ts`). |
| 5 | List folders | `data/folders.json`, one level deep, drag to reorder. Last writer wins, like `lists.json`. |
| 6 | Google Calendar import | Works against a local mock of Google's endpoints. **Not yet tried with a real OAuth client.** |
| 7 | Chrome quick-add extension | Writes task files straight to the repo. |
| 8 | Themes, fonts, activity log with undo | Undo writes the earlier state as a new change, so history is never rewritten. |
| 9 | Extensions + marketplace | See below. Google Calendar moved into it. |
| 10 | Obsidian extension | Task notes, a Base and an inbox note in the vault. |
| 11 | Board layout and Stats | Board: columns P1–P5 + Done; dragging a card changes priority or completes it. Stats: burndown (open tasks per day), completed per day, totals. |
| 12 | CI and releases | `.github/workflows/ci.yml` on every push/PR; pushing a `v*` tag builds the installer, the portable .exe and the extension zip into a GitHub release. |

### Extensions (phase 9): how they work

- **Catalog** (`shared/extensions.ts`): every extension the marketplace lists. Three kinds: *built-in* (ships with the
  app; install, then set up per device), *companion* (a separate app such as the Chrome quick-add or watchwise; the
  marketplace shows setup steps) and *planned* (none right now).
- **Installed** is a synced setting (`SyncedSettings.extensions.installed`), so installing on one computer installs
  everywhere. Each device still does its own setup (connect Google, pick a vault), stored in `LocalSettings`.
- **Main-process half** (`main/extensions/`): a `MainExtension` has `isReady()`, an optional `importTasks()` (may
  create tasks) and an optional `exportTasks()` (reads tasks, writes elsewhere). Sync runs: pull/push → imports → push
  again if anything changed → exports. Errors are caught per extension and shown in the sync line and the marketplace.
- **Why no third-party extensions:** extensions run in the main process next to the GitHub token and Google secrets.
  Loading code from a remote catalog would mean a sandbox (a utility process with a narrow API) and signing. That's not
  worth building for one user. A remote catalog of *companion* apps could be added cheaply if that changes.

### Board and Stats (phase 11): decisions

- Board columns are **priorities**, not statuses: the app has no "in progress" state, and priority is what you
  re-sort by hand. Done shows the 30 most recent completions. List or board is remembered per device.
- The burndown is built from `createdAt` and `completedAt`, so deleted tasks don't count, and a task completed and then
  reopened counts as open the whole time.

## Next

1. **Confirm Google Calendar with a real OAuth client** (Google Cloud setup steps are in the README), then tick it off.
2. **First release:** `git tag v0.1.0 && git push --tags`. CI builds and publishes it.
3. **Knowledge base:** see [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md). Nothing in this repo is needed for the next step
   (indexing the vault), which is a separate project.
4. ~~**Auto-sync**~~ — done as a per-device setting: on open/focus (at most once a minute) and 5 s after an edit.
   There is still no timer, so a desktop left open in the background doesn't pull other devices' changes.
5. ~~**Microsoft To Do import**~~ — done, as an extension that reads the Windows app's local database (no Graph API).
6. **Android app** — built (Capacitor + the same UI; share-to-add and a home-screen widget). Still to do: a first
   real sync between the phone and desktop, a signed release APK (CI only builds a debug one), and switching the
   data-format policy to additive-only once the phone is in daily use.

## Open questions

1. **Calendar changes after import:** should a moved or cancelled event update its task? Today each event is imported
   once and later changes are ignored.
2. **Overdue → P1:** only imported tasks, or every task with a due date?
3. **Obsidian, two-way:** should completing a task by ticking something in the vault complete it in the app? Today the
   vault is a one-way mirror plus the inbox. Two-way needs conflict rules, because the vault and GitHub are both changed
   outside the app.
4. **Board columns:** priorities (today) or a new status field (To do / Doing / Done)?
5. **Widget freshness:** the Android widget only changes when the app runs. Worth a periodic background sync
   (WorkManager), or completing tasks from the widget?
