# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run dev              # run the app with hot reload (electron-vite)
npm run typecheck        # tsc for main/preload (tsconfig.node), renderer (tsconfig.web) and extension (tsconfig.extension)
npm test                 # vitest run (no vitest config; defaults)
npx vitest run src/shared/ranking.test.ts   # a single test file
npx vitest run -t "name"                    # tests matching a name
npm run build            # typecheck + production build into out/
npm run dist             # build + portable Windows .exe into dist/
npm run build:extension  # Chrome extension into extension/dist (load unpacked in chrome://extensions)
```

There is no linter. TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`, so unused imports fail typecheck.

`TODO_USER_DATA_DIR=<dir>` makes the app use a separate `userData` folder. Use it to run a second "device" for sync testing, or to launch without touching the real local cache.

## Architecture

An Electron + React app that uses a GitHub repo you own as its database. Each task is one JSON file, and every write goes through the GitHub Contents API, so every change is one commit. There is no server.

### Process boundaries

- **Main** (`src/main/`) is the only code that touches the network, the disk cache or secrets.
- **Renderer** (`src/renderer/src/`) reaches main only through `window.api`.
- **Adding an IPC call means changing four places:** the channel name in `CHANNELS` and the method in the `Api` interface (`src/shared/ipc.ts`), the `ipcRenderer.invoke` wrapper (`src/preload/index.ts`), and the handler (`src/main/ipc.ts`). Errors don't cross IPC cleanly, so calls that can fail return `Outcome<T>`.
- **`src/shared/`** is imported by main, renderer *and* the Chrome extension through the `@shared` alias. Code there must be environment-agnostic: no Node `Buffer` and no Electron imports. For example, `github.ts` uses `fetch` and `TextEncoder`. Node-only helpers live in `src/main/` (for example `calendarIds.ts`, which uses `crypto`). Unit tests sit next to the pure logic in `src/shared/`.

### Data and sync model

- **`src/shared/types.ts` is the source of truth for the on-disk format.** The extension and a planned Android app read and write the same files.
  - Repo layout: `data/tasks/<uuid>.json`, plus the single shared files `data/lists.json`, `data/folders.json` and `data/settings.json`.
  - Settings loaders merge stored values over `DEFAULT_*` (`localCache.getSettings`, `secureStore.loadLocalSettings`), so older files with missing fields still load.
- **Local-first cache** (`src/main/localCache.ts`, under `<userData>/cache`):
  - The working copy mirrors `data/`.
  - `cache/synced/` holds the last content known to match GitHub. It is the base for conflict diffs.
  - `sync-meta.json` tracks blob SHAs, dirty and deleted task ids, unresolved conflict ids and dirty flags for the shared files.
  - Renderer edits only write the cache and mark items dirty. Nothing goes to GitHub until Sync runs.
- **Sync** (`src/main/sync.ts`) is manual and pushes before it pulls.
  - Each file's blob SHA is an optimistic-concurrency token. A 409/422 response becomes a `GitHubConflictError`.
  - Tasks edited on both sides become a `SyncConflict`, which the user resolves in `ConflictModal`.
  - The shared files (lists, folders, settings) are last-writer-wins.
- **Sync orchestration** is in the `syncRun` handler in `main/ipc.ts`: sync, then calendar import if this device is connected, then sync again if the import changed anything. Pulling first stops an event that another device already imported from being duplicated.
- **Secrets** are the GitHub PAT, the Google client secret and the Google refresh token. They are encrypted with `safeStorage` as named files in `secureStore.ts` and are never sent to the renderer. Local, per-device settings live in `local-settings.json`. Synced settings live in `data/settings.json`.

### Google Calendar import (`src/main/googleAuth.ts`, `calendarImport.ts`, `src/shared/calendar.ts`)

- **Auth:** OAuth for installed apps with PKCE and a loopback redirect, using plain `fetch` (no googleapis dependency). The scope is read-only.
- **Task ids:** each imported task's id is a deterministic UUID derived from `calendarId + eventId`, so two devices write the same file.
- **Import ledger:** a per-device ledger (`<userData>/calendar-ledger.json`) makes each event import only once. Deleting or editing the task never brings it back.
- **Mapping:** the event → task mapping and overdue → P1 promotion are pure functions in `shared/calendar.ts`.

### Renderer

- **State:** all state and mutations live in `state/AppStateContext.tsx`. There is no Redux.
- **What the main pane shows** is a `View` union: `list`, `important` or `search`. `TaskListView` gets its tasks from the view. Only the main Tasks list and cross-list views use `rankTasks` (`shared/ranking.ts`). Other lists sort by creation date.
- **Ranking rules:** P1 always comes first, P4 always sorts above P5, and P2/P3 are blended by an age-vs-priority weight. An optional setting puts starred tasks first within their tier.
- **Sidebar:** folders are one level deep. `shared/sidebarTree.ts` builds the tree and shows a list whose `folderId` points to a missing folder at the top level. A folder's collapsed state is stored per device in `localStorage`.
- **Drag and drop:** native HTML5, with one MIME type per draggable kind (`dnd.ts`: `TASK_MIME`, `LIST_MIME`). Tasks with a sync conflict can't be dragged.

### Chrome extension (`extension/`)

A Manifest V3 extension built with its own Vite config. It writes `data/tasks/<uuid>.json` directly to the GitHub repo through the shared `github.ts` client, and the desktop app picks the task up on its next Sync. Its PAT is stored in `chrome.storage.local`, which is not OS-encrypted.

## Gotchas

- On Windows, Chromium's `<sessionData>/Cache` would collide with the app's own `<userData>/cache` because the filesystem is case-insensitive. That is why `main/index.ts` moves `sessionData` to `<userData>/chromium`. Don't remove it.
- Running `npm test` from the main checkout also runs the test files inside `.claude/worktrees/*`, because there is no vitest config to exclude them.
- `ROADMAP.md` tracks feature phases and open questions. `TODO.md` is the user's checklist.
