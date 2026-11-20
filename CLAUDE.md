# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run dev              # run the app with hot reload (electron-vite)
npm run typecheck        # tsc for main/preload (tsconfig.node), renderer (tsconfig.web), extension (tsconfig.extension), Android web code (tsconfig.mobile) and the CLI (tsconfig.cli)
npm test                 # vitest run (no vitest config; defaults)
npx vitest run src/shared/ranking.test.ts   # a single test file
npx vitest run -t "name"                    # tests matching a name
npm run build            # typecheck + production build into out/
npm run dist             # build + Windows installer and portable .exe into dist/
npm run build:extension  # Chrome extension into extension/dist (load unpacked in chrome://extensions)
npm run build:cli        # the `todo` CLI into cli/dist/todo.mjs (`npm install -g ./cli` puts it on the PATH)
npm run build:mobile     # Android web bundle into mobile/dist + `cap sync android`
npm run android:run      # build:mobile, then install and launch on a device/emulator
npm run android:apk      # build:mobile, then a debug APK (Windows: uses gradlew.bat)
```

There is no linter. TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`, so unused imports fail typecheck.

The app's `userData` is `%APPDATA%\TODO` for both `npm run dev` and the installed app (set explicitly in `main/index.ts`). `TODO_USER_DATA_DIR=<dir>` makes the app use a separate `userData` folder. Use it to run a second "device" for sync testing, or to launch without touching the real local cache.

## Architecture

An Electron + React app that uses a GitHub repo you own as its database. Each task is one JSON file, and every write goes through the GitHub Contents API, so every change is one commit. There is no server.

### Process boundaries

- **Main** (`src/main/`) is the only code that touches the network, the disk cache or secrets.
- **Renderer** (`src/renderer/src/`) reaches main only through `window.api` (the `Api` interface). On Android the same renderer runs with `window.api` implemented in the WebView (`mobile/src/api.ts`, see below), so the renderer must not assume Electron. `window.api.platform` is `'desktop'` or `'android'`.
- **Adding an IPC call means changing four places:** the channel name in `CHANNELS` and the method in the `Api` interface (`src/shared/ipc.ts`), the `ipcRenderer.invoke` wrapper (`src/preload/index.ts`), and the handler (`src/main/ipc.ts`). Errors don't cross IPC cleanly, so calls that can fail return `Outcome<T>`.
- **`src/shared/`** is imported by main, renderer *and* the Chrome extension through the `@shared` alias. Code there must be environment-agnostic: no Node `Buffer` and no Electron imports. For example, `github.ts` uses `fetch` and `TextEncoder`. Node-only helpers live in `src/main/` (for example `extensions/googleCalendar/ids.ts`, which uses `crypto`). Unit tests sit next to the pure logic, mostly in `src/shared/`.

### Data and sync model

- **`src/shared/types.ts` is the source of truth for the on-disk format.** The Chrome extension and the Android app read and write the same files.
  - Repo layout: `data/tasks/<uuid>.json`, plus the single shared files `data/lists.json`, `data/folders.json` and `data/settings.json`.
  - Settings loaders merge stored values over `DEFAULT_*` (`mergeSyncedSettings` in `shared/cacheStore.ts`, `secureStore.loadLocalSettings`), so older files with missing fields still load.
  - `SyncedSettings` is `ranking`, `archive`, `appearance` and `extensions` (`installed` plus each extension's synced options).
- **Local-first cache** (`src/main/localCache.ts`, under `<userData>/cache`):
  - The working copy mirrors `data/`.
  - `cache/synced/` holds the last content known to match GitHub. It is the base for conflict diffs.
  - `sync-meta.json` tracks blob SHAs, dirty and deleted task ids, unresolved conflict ids and dirty flags for the shared files.
  - Renderer edits only write the cache and mark items dirty. Nothing goes to GitHub until Sync runs.
  - Sync talks to the cache through the synchronous `CacheStore` interface (`shared/cacheStore.ts`). Desktop passes the `localCache` module; Android and the sync tests use `createMemoryCacheStore` (`shared/memoryCacheStore.ts`).
- **Sync** (`src/shared/sync.ts`, `syncNow(cache, ...)`) pushes before it pulls. It runs on the Sync button, or from `AppStateContext` when the per-device `LocalSettings.autoSync` is on (app open/focus at most once a minute, and 5 s after an edit; never two at once).
  - Sync re-reads `sync-meta` for every change and clears a task's dirty mark only if the cache still holds the content it pushed, so edits made during a sync aren't lost. Tasks with an unresolved conflict are never pushed.
  - Each file's blob SHA is an optimistic-concurrency token. A 409/422 response becomes a `GitHubConflictError`.
  - 10 or more new task files (an import) are pushed as one commit via the Git Data API (`commitNewFiles`), because GitHub allows only ~80 content-creating requests a minute and 500 an hour. It only batches paths that don't exist remotely and never forces the ref update; when it can't batch it returns null and the per-file push handles those tasks.
  - Tasks edited on both sides become a `SyncConflict`, which the user resolves in `ConflictModal`.
  - The shared files (lists, folders, settings) are last-writer-wins.
- **Sync orchestration** is in the `syncRun` handler in `main/ipc.ts`: sync, then every active extension's `importTasks`, then sync again if an import changed tasks, then every `exportTasks`. Pulling first stops an event that another device already imported from being duplicated; exporting last means exports see the synced state.
- **Secrets** are the GitHub PAT, the Google client secret and the Google refresh token. They are encrypted with `safeStorage` as named files in `secureStore.ts` and are never sent to the renderer. Local, per-device settings live in `local-settings.json`. Synced settings live in `data/settings.json`.

### Extensions (`src/shared/extensions.ts`, `src/main/extensions/`, `src/renderer/src/components/extensions/`)

- **Catalog:** `shared/extensions.ts` lists every marketplace entry: `built-in` (has an `ExtensionId`), `companion` (separate app; setup steps only) or `planned`. Only built-in code runs; there is no third-party loading, because extensions share the main process with the secrets.
- **Install state** is synced (`SyncedSettings.extensions.installed`); per-device setup lives in `LocalSettings`. An extension runs on a device when it's installed and its `isReady()` is true.
- **Main half:** each built-in exports a `MainExtension` (`main/extensions/types.ts`) and is registered in `EXTENSIONS` in `main/extensions/index.ts`. `importTasks` may write tasks to the cache (mark them dirty); `exportTasks` must not change tasks. Steps throw on failure; `runPhase` catches and reports per extension. Last results are kept per device in `<userData>/extension-runs.json`.
- **Renderer half:** a settings panel per extension, registered in `SETTINGS_PANELS` in `ExtensionsModal.tsx`, and a `readyHere` case mirroring `isReady`.
- **Adding one:** add the id to `ExtensionId` and its options to `ExtensionSettings` + defaults (`shared/types.ts`) and to `localCache.getSettings`, a catalog entry, a `MainExtension`, and a settings panel.

**Google Calendar** (`main/extensions/googleCalendar/`, `shared/calendar.ts`):
- **Auth:** OAuth for installed apps with PKCE and a loopback redirect, using plain `fetch` (no googleapis dependency). The scope is read-only.
- **Task ids:** each imported task's id is a deterministic UUID derived from `calendarId + eventId`, so two devices write the same file.
- **Import ledger:** a per-device ledger (`<userData>/calendar-ledger.json`) makes each event import only once. Deleting or editing the task never brings it back.
- **Mapping:** the event → task mapping and overdue → P1 promotion are pure functions in `shared/calendar.ts`.

**Obsidian** (`main/extensions/obsidian.ts`, `shared/obsidian.ts`):
- Writes plain files into `<vault>/<folder>/` (no Obsidian plugin): `Tasks/<title>.md` per task, `Tasks.base` (written once), `Inbox.md`. The vault path is per device (`LocalSettings.obsidianVaultPath`); the folder and options are synced.
- A note belongs to the app only if its frontmatter has `todo_id` (`noteTaskId`); the app never overwrites or deletes any other file. Everything from `## Vault notes` down is the user's and is carried over on every rewrite and rename.
- A per-device ledger (`<userData>/obsidian-ledger.json`) maps task id → file name, so a renamed task moves its note. Export reads every note's vault notes first, then writes, then removes stale notes, so two tasks swapping names can't lose text.
- Inbox capture is the import step: unchecked `- [ ]` items become tasks (`source.type: 'obsidian_inbox'`) and are removed from `Inbox.md` after the tasks are in the cache.
- Rendering, file naming and inbox parsing are pure and tested in `shared/obsidian.test.ts`.

**Microsoft To Do** (`main/extensions/microsoftTodo.ts`, `shared/microsoftTodo.ts`):
- Reads the Windows app's own SQLite database (`%LOCALAPPDATA%\Packages\Microsoft.Todos_8wekyb3d8bbwe\LocalState\AccountsRoot\<account>\todosqlite.db`) with `sql.js` (WASM: Electron 33's Node has no `node:sqlite`, and a native module would need rebuilding for Electron). No Microsoft auth or Graph permissions.
- The database is in WAL mode and the app may be running, so `applyWal` merges committed WAL frames into the image before opening it. Which account to read is per device (`LocalSettings.microsoftTodoAccountId`).
- Ids come from `stableUuid('microsoft-todo', kind, msId)` (`main/extensions/stableId.ts`, which calendar ids also use). A per-device ledger (`<userData>/microsoft-todo-ledger.json`) imports each task once and doesn't recreate imported lists or folders the user deleted. The mapping is pure and tested in `shared/microsoftTodo.test.ts`.
- `build.files` in `package.json` leaves out sql.js's unused builds; only `sql-wasm.js` and `sql-wasm.wasm` ship.

### Renderer

- **State:** all state and mutations live in `state/AppStateContext.tsx`. There is no Redux.
- **What the main pane shows** is a `View` union: `list`, `important`, `search` or `stats`. `TaskListView` gets its tasks from the view and shows them as a list or, per a per-device `localStorage` choice, a board (`BoardView`, columns by priority plus Done). `StatsView` charts `shared/stats.ts` (burndown from `createdAt`/`completedAt`) as plain SVG. Only the main Tasks list and cross-list views use `rankTasks` (`shared/ranking.ts`). Other lists sort by creation date.
- **Ranking rules:** P1 always comes first, P4 always sorts above P5, and P2/P3 are blended by an age-vs-priority weight. An optional setting puts starred tasks first within their tier.
- **Sidebar:** folders are one level deep. `shared/sidebarTree.ts` builds the tree and shows a list whose `folderId` points to a missing folder at the top level. A folder's collapsed state is stored per device in `localStorage`.
- **Styles:** `SyncedSettings.appearance.styleId` (`shared/styles.ts`) picks the layout: `standard`, or `terminal`, where `App.tsx` renders `components/terminal/TerminalShell.tsx` instead of the sidebar and list (the overlays are shared). `theme.ts` sets `data-style` on `<html>`; `styles/terminal.css` holds every terminal rule under it. The terminal style swaps a proportional font for JetBrains Mono (`fontForStyle`). Every style must work with every theme and font, on Android and in the widget (`WidgetSnapshot.style` and `fontFamily`).
- **Shell commands** (`shared/shell.ts`) are shared by the terminal style and the CLI: `runCommand(input, state, host)` parses and runs a command against a `ShellHost` (the front end's reads and writes) and returns toned output lines. Tasks are referred to by their number in the last listing (`ShellState.shown`). A new command goes in `COMMANDS`; a host-specific one (undo, open) is offered only when the host has the method. Tests in `shell.test.ts`.
- **Themes and fonts:** a theme (`shared/themes.ts`) is three main colors (background, primary, secondary) plus optional per-color overrides; `deriveColors` works out the other 8 colors. Built-in themes live in code, the user's in `SyncedSettings.appearance.customThemes`. `renderer/src/theme.ts` sets the 11 resulting CSS variables and `--font` (from `shared/fonts.ts`) on `<html>`, and `global.css` derives every other shade with `color-mix`. Never hardcode a color in the stylesheet. Fonts are bundled with `@fontsource` and imported in `main.tsx`. Per-font adjustments go under `html[data-font='<id>']` (Doto needs heavier weights to be readable).
- **Activity log and undo:** user actions in `AppStateContext` save through plain writers (`persistTask`, `removeTask`, `saveLists`, `saveFolders`) and then `record()` one entry holding each touched entity's before and after state (`shared/activity.ts`). New user-facing mutations must do the same, and housekeeping (auto-archive) must not log. Tasks written by extensions in the main process aren't logged either. Undo writes the "before" states back as a new change and a new entry, so it syncs as new commits and history is never rewritten. The log is per device (`<userData>/activity-log.json`, last 300 entries) and never synced. The repo's commit history is the cross-device record.
- **Popups:** never use `confirm()`, `alert()` or `title=`. Use `useConfirm()` (`components/ConfirmDialog.tsx`; `tone: 'danger'` for changes that lose or overwrite data, `'accent'` for milder ones) and `data-tooltip="..."` (rendered by `components/Tooltips.tsx`). Give icon-only buttons an `aria-label`.
- **Drag and drop:** native HTML5, with one MIME type per draggable kind (`dnd.ts`: `TASK_MIME`, `LIST_MIME`). Tasks with a sync conflict can't be dragged.

### Android app (`mobile/`)

Capacitor 8 wrapping the same renderer. `mobile/src/main.ts` installs `window.api` and then imports `@renderer/main`.
- **`mobile/src/api.ts`** implements `Api`: the cache is `createMemoryCacheStore`, written behind to IndexedDB (`storage.ts`, one record per cache file, flushed after Sync and when the app is hidden). The token is in the Android Keystore (`capacitor-secure-storage-plugin`; `@aparajita/capacitor-secure-storage` hangs on Capacitor 8). Local settings are in `@capacitor/preferences`, with `autoSync` defaulting to on. Desktop-only groups (calendar, obsidian, microsoftTodo, extensions) return `{ ok: false }`.
- **Phone layout** is CSS under `html[data-platform='android']` at the end of `global.css` (drawer sidebar, full-screen sheets, touch sizes), plus a drawer toggle in `App.tsx`. Elements with class `desktop-only` are hidden there. The board view and tooltips are off when `platform !== 'desktop'`. The back button (`mobile/src/native.ts`) closes the top `.overlay`, then the drawer, then minimizes.
- **Native code** is Java in `mobile/android/app/src/main/java/com/jadonlee/todoapp/`; the app's own plugins are registered in `MainActivity` before `super.onCreate`.
  - `ShareTargetPlugin`: the ACTION_SEND text/plain intent filter. Exposed as the optional `Api.shareTarget`; `shared/share.ts` turns the shared subject/text into a title and notes, and `App.tsx` adds the task to Tasks and opens it.
  - Widget: `TasksWidgetProvider` + `TasksWidgetService` (list rows) + `WidgetBridgePlugin`. `App.tsx` sends `shared/widget.ts`'s `widgetSnapshot` (ranked open Tasks, theme colors, style, closest system font) through the optional `Api.widget` after every change; the bridge stores it in SharedPreferences and redraws. Taps come back as a pending action (open a task, or focus the add box). Redraws use `partiallyUpdateAppWidget`: a full `updateAppWidget` from the app wasn't shown by the Pixel launcher after the widget was placed. RemoteViews can't set a typeface, so text is wrapped in a family-name `TypefaceSpan` (`WidgetStore.inFamily`); the terminal style hides the priority and star views and writes each row as one `[ ] p1 * title` line.
- `mobile/android/` is the generated Capacitor project, committed. `npx cap sync android` copies `mobile/dist` in and regenerates the plugin wiring. The Gradle wrapper is pinned to 9.5.0 (AGP 8.13 breaks on 9.6+; Android Studio's JDK 25 needs 9.1+); builds need `JAVA_HOME` = Android Studio's `jbr` and `ANDROID_HOME`.

### CLI (`cli/`)

`todo`, a Node program bundled by `cli/vite.config.ts` into one dependency-free file. It is its own device, like the phone: a `createMemoryCacheStore` saved to `cache.json` (`cli/src/store.ts`) in `TODO_CLI_HOME`, else `%APPDATA%\TODO\cli` (Windows) or `~/.config/todo/cli`. `todo login` stores the repo in `config.json` and the token in a plain `token` file (or use `TODO_GITHUB_TOKEN`); the desktop app's token is encrypted with `safeStorage` and can't be shared. `cli/src/host.ts` is the `ShellHost` over the cache. `todo <command>` syncs before and after the command (unless `--offline` or `todo config autosync off`) and remembers the last listing's ids in `state.json` so `todo done 2` matches `todo ls`; `todo` alone is an interactive shell. No activity log or undo in the CLI, so `rm` asks first.

### Chrome extension (`extension/`)

A Manifest V3 extension built with its own Vite config (`extension/vite.config.ts`; the service worker is emitted as a fixed `background.js`). It is its own device, like the phone and the CLI.
- **Background** (`src/background/`) is the only writer. `store.ts` holds a `createMemoryCacheStore` loaded from and written behind to `chrome.storage.local` (keys `cache:<file>`) and runs `syncNow`: 2 s after a change, on the side panel opening (at most once a minute), and on a 15-minute `chrome.alarms` alarm. Chrome stops the worker when idle, so nothing may live only in memory and every listener is registered synchronously at the top level.
- **Pages** (popup, `sidepanel.html`, options) never touch the cache: they `send()` typed requests (`src/messages.ts`) and redraw on the `todo:changed` broadcast. `look.ts` applies the synced theme, font and style with the shared helpers, like the app's `theme.ts`. The side panel reuses `shared/shell.ts` for ordering (`buildListing`), the terminal style's rows (`formatRow`) and its add syntax (`parseTaskOptions`).
- **Integrations** (`src/integrations/`) are the extension's feature registry: `quickAdd` (right-click menu and popup prefill) works; Gmail and GitHub are `planned` entries. An integration declares its menus, its `hosts` (also listed in the manifest's `optional_host_permissions`, and requested by the options page when it's turned on) and `activate`/`deactivate`, and gets an `IntegrationContext` instead of reaching into the cache. The comment in `integrations/types.ts` lists the steps for adding one.
- Its PAT is stored in `chrome.storage.local`, which is not OS-encrypted.

## Gotchas

- On Windows, Chromium's `<sessionData>/Cache` would collide with the app's own `<userData>/cache` because the filesystem is case-insensitive. That is why `main/index.ts` moves `sessionData` to `<userData>/chromium`. Don't remove it.
- Running `npm test` from the main checkout also runs the test files inside `.claude/worktrees/*`, because there is no vitest config to exclude them.
- `docs/ROADMAP.md` tracks feature phases and open questions; `docs/KNOWLEDGE_BASE.md` is the plan for the cross-app knowledge base this app feeds. `TODO.md` is the user's checklist.
- CI (`.github/workflows/ci.yml`) runs typecheck, tests and the desktop and extension builds, and a separate job builds the Android debug APK (uploaded as an artifact). Pushing a `v*` tag runs `release.yml`, which sets the version from the tag and publishes the installer, portable .exe, Android APK and extension zip. It also uploads `latest.yml` and the installer's `.blockmap`, which the desktop self-update reads: `main/updater.ts` (electron-updater, repo set by `build.publish` in `package.json`) checks at startup and every 4 hours, downloads in the background and installs on quit or from Settings → Updates. `npm run dev` and the portable .exe don't self-update; a release without `latest.yml` shows as an error in Settings. The APK is signed with the local debug key from the `ANDROID_DEBUG_KEYSTORE` secret so releases install over each other and over local builds.
- Local `npm run dist` on Windows can fail unpacking electron-builder's `winCodeSign` (symlink privilege). The README has the one-time fix.
- The logo is "Commit check": `build/logo.svg`, plus `build/logo-small.svg` (solid commits) for 24 px and below. The icon files are PNGs rendered from it: `build/icon.ico` and `icon.png` (electron-builder), `extension/public/icons/`, and the Android mipmaps and splash PNGs. The Android adaptive icon is the vector `drawable/ic_launcher_foreground.xml`, with a `ic_launcher_monochrome.xml` layer. In the UI it's `components/Logo.tsx` (and inline in the extension's pages), drawn in theme colors.
- Stop the Gradle daemon (`mobile/android/gradlew --stop`) before `npm install`/`uninstall`, or npm fails with EBUSY on files Gradle holds open.
