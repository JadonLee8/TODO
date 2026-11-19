# TODO

A simple, priority-ranked task app that uses a GitHub repo as its backend, so every add/edit/delete is a version-controlled commit and tasks sync across devices.

## Stack

Electron + React + TypeScript, built with [`electron-vite`](https://electron-vite.org). No Redux, no ORM, no server — the main process is the only thing that talks to GitHub or touches your token; the renderer (UI) only talks to the main process over Electron's IPC. The Android app is the same UI in a [Capacitor](https://capacitorjs.com) shell (see [Android app](#android-app)).

## How it works

- **Storage**: each task is its own JSON file (`data/tasks/<uuid>.json`) in a GitHub repo you choose, plus `data/lists.json`, `data/folders.json` and `data/settings.json`. One file per task means every change is a clean, isolated git diff, and conflicts only happen when the *same* task is edited on two devices before syncing — never unrelated tasks.
- **Commits**: every push to GitHub goes through the Contents API, which creates one real commit per file write — so adding/editing/deleting a task is a commit, automatically. The exception is a burst of 10 or more new tasks (an import), which goes up as a single commit so it stays within GitHub's rate limits.
- **Sync**: via the Sync button, or automatically when **Auto-sync** is on for that device (Settings: when the app opens or comes back to the front, and a few seconds after a change). It pushes everything you changed locally, then pulls anything new from GitHub. If a task was edited differently on two devices, it shows up with a reddened row and a "SYNC CONFLICT" tag — click it to see a side-by-side diff and pick which version wins.
- **Token security**: your GitHub personal access token is encrypted at rest using Electron's `safeStorage` (Windows DPAPI, tied to your Windows user account) and only ever decrypted in memory in the main process. The renderer (and the GitHub repo) never sees it.
- **Priority ranking** (main "Tasks" list only): P1 tasks always sort first (oldest first). P4 always sorts above P5 (oldest first within each). P2/P3 are blended by an adjustable age-vs-priority weight in Settings. Other lists (e.g. "Wishlist Projects", "To 3D Print") behave like a normal to-do list, sorted by creation date — priority ranking is specific to the main Tasks view, since these are backlog/reference lists.
- **Completed tasks** collapse into a "Completed" section and auto-archive (drop out of the list entirely) after a configurable number of days.
- **Board and Stats**: any list (and Important) can be shown as a board with a column per priority plus Done; drag a card to change its priority or complete it. **Stats** shows a burndown (open tasks per day), completions per day and weekly totals.
- **Activity and undo**: Settings › Activity lists the changes made on this device; undoing one saves the earlier state as a new change, so it syncs like any edit.
- **Extensions**: Google Calendar import, Microsoft To Do import and the Obsidian vault mirror are extensions you install from the marketplace (sidebar › Extensions). See below.

## Install

Download `TODO-Setup-<version>.exe` (installs for your user, no admin needed) or the portable `.exe` from the repo's GitHub Releases, or build them yourself with `npm run dist`. The app keeps its data in `%APPDATA%\TODO`, the same folder `npm run dev` uses.

Releases are built by GitHub Actions: push a tag such as `v0.2.0` and `.github/workflows/release.yml` builds the installer, the portable .exe, the Android APK and the Chrome extension zip and publishes them. `ci.yml` type-checks, tests and builds every push and pull request.

> Building locally on Windows can fail with "Cannot create symbolic link: A required privilege is not held by the client" while electron-builder unpacks its `winCodeSign` tools. Either turn on Windows Developer Mode (which allows symlinks), or extract the archive once by hand without its macOS folder: in `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`, run `7za x <any>.7z -owinCodeSign-2.6.0 -xr!darwin` (7za is in `node_modules/7zip-bin/win/x64`).

## First-time setup

1. **Create a GitHub repo** to hold your tasks (can be private). It can be empty — the app will create `data/...` files in it as needed.
2. **Create a fine-grained personal access token**: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories** → your tasks repo.
   - Permissions: **Contents: Read and write**. Nothing else is needed.
3. Run the app (`npm run dev`, or the built portable `.exe`), open **Settings**, and fill in:
   - Repo owner, repo name, branch (usually `main`)
   - Paste the token and click **Save token**, then **Test connection** to confirm.
4. Click **Sync** to do your first push/pull.

## Android app

The same React UI in a Capacitor shell (`mobile/`), with its own storage, syncing with the same repo through the same sync code as the desktop app.

- **Phone layout**: the sidebar is a slide-in drawer (☰), task details and Settings open full screen, and the back button closes whatever is on top. The Board view and Extensions are desktop-only.
- **Auto-sync** is on by default on the phone: it syncs when the app opens or comes back to the front (at most once a minute) and a few seconds after a change. Turn it off in Settings to sync only with the Sync button.
- **Share to add**: share a page or some text from any app and pick **TODO**. It becomes a task in Tasks (a browser's page title becomes the title and the link goes in the notes) and opens so you can adjust it.
- **Home-screen widget**: long-press the home screen → **Widgets** → **TODO**. It shows the top of the ranked Tasks list in your theme's colors; tap a task to open it, or **+** to add one. The widget doesn't sync on its own, so it is as fresh as the last time the app ran.
- **Storage**: tasks live in the app's IndexedDB and the GitHub token in the Android Keystore.

Build and install (a debug build, sideloaded):

1. Install Android Studio (it brings the SDK, an emulator and a JDK), and point the build at them: `JAVA_HOME=C:\Program Files\Android\Android Studio\jbr` and `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`.
2. On the phone, turn on **Developer options → USB debugging** and plug it in (or start an emulator).
3. `npm run android:run` builds, installs and starts the app. `npm run android:apk` only builds `mobile/android/app/build/outputs/apk/debug/app-debug.apk`; CI also uploads that APK as a build artifact.
4. In the app: ☰ → **Settings**, enter the repo and a **separate** fine-grained PAT (tasks repo only, *Contents: Read and write*), then **Sync**.

> The Gradle wrapper is pinned to 9.5.0: the Android Gradle plugin (8.13) breaks on Gradle 9.6+, and Android Studio's bundled JDK 25 needs Gradle 9.1+. Stop the Gradle daemon (`mobile/android/gradlew --stop`) before `npm install`, or npm can fail with EBUSY on Windows.

## Data format

Plain JSON, one task per file, is deliberately chosen for portability: any language can parse it (Kotlin: `kotlinx.serialization` or `Gson`), it's human-readable, and it diffs cleanly in git.

```
data/
  lists.json          # [{ id, name, order, folderId }]
  folders.json        # [{ id, name, order }] (sidebar folders, one level deep)
  settings.json        # ranking, archive, appearance and extension settings (not secret, synced)
  tasks/
    <uuid>.json        # one Task per file (calendar imports use a UUID derived from the event)
```

`lists.json`, `folders.json` and `settings.json` are each a single shared file, and the last device to sync wins. If two devices both reorganize lists or folders before syncing, one device's changes are lost (tasks themselves are never affected). A list whose folder was deleted on another device just shows up at the top level.

See `src/shared/types.ts` for the exact `Task`, `TaskList`, and `SyncedSettings` shapes — that file is the source of truth for the on-disk format.

## Commands

```
npm run dev              # run the app in development (hot reload)
npm run typecheck        # type-check main/preload, renderer, the Chrome extension and the Android web code
npm test                 # unit tests (vitest)
npm run build            # type-check + production build (out/)
npm run dist             # build + package a portable Windows .exe (dist/)
npm run build:extension  # build the Chrome extension (extension/dist/)
npm run build:mobile     # build the Android web bundle (mobile/dist/) and copy it into mobile/android
npm run android:run      # build:mobile, then install and start on a phone or emulator
npm run android:apk      # build:mobile, then a debug APK (mobile/android/app/build/outputs/apk/debug/)
```

## Extensions

Open **Extensions** at the bottom of the sidebar. Built-in extensions are installed for all your devices at once (it's a synced setting), and each device does its own setup, like connecting an account or picking a folder. Installed extensions run as part of **Sync**: after pulling, extensions that create tasks run and Sync pushes again, then extensions that write elsewhere run on the final state. **Run now** in the marketplace runs one without syncing.

The marketplace also lists companion apps (the Chrome quick-add below, and watchwise for YouTube notes) with their setup steps.

### Obsidian

Mirrors your tasks into an Obsidian vault so they sit next to your notes, and lets you capture tasks from the vault:

```
<vault>/TODO/
  Tasks/<task title>.md   one note per task, with properties (todo_id, list, priority, status, starred, due, created, completed_at)
  Tasks.base              an Obsidian Base with "Open" and "Done" tables (written once, then yours to edit)
  Inbox.md                "- [ ] Call the bank #p1 📅 2026-12-01" lines become tasks on the next Sync, and are removed
```

- The app owns each task note except the **Vault notes** section at its end: text you write there survives every rewrite, so you can link a task to your other notes.
- Renaming a task renames its note. Deleting a task deletes its note. Notes the app didn't write are never touched, even in `TODO/Tasks/`.
- Notes are rewritten only when their content changes. Completed and archived tasks keep their notes unless you turn that off.
- Setup: Extensions › Obsidian › Install, then **Choose vault…** and pick the vault's top folder (the one containing `.obsidian`). If the vault itself syncs between computers (Google Drive, Obsidian Sync), choose it on one computer only.
- "Open note in Obsidian" in a task's detail panel opens its note (Obsidian must have opened that vault before).

### Google Calendar

On a device you connect, every **Sync** pulls, imports new events from the calendars you picked (today through *N* days ahead) as tasks, and pushes again. Each event is imported once: editing or deleting the task never brings it back, and later changes to the event (new time, cancellation) aren't carried over. Imported tasks get a 📅 marker and an "Open in Google Calendar" link, and can optionally be bumped to P1 once they're overdue.

Setup (you need your own OAuth client; the app doesn't ship one):

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Configure the **OAuth consent screen**: user type External, and add yourself as a test user.
3. Create credentials → **OAuth client ID** → application type **Desktop app**. Copy the client ID and secret.
4. ⚠️ While the consent screen is in **Testing** status, Google expires refresh tokens after **7 days** and you'd have to reconnect weekly. Switch it to **In production** to avoid that; without verification you'll see an "unverified app" warning when connecting, which is fine for personal use.
5. In the app: **Extensions → Google Calendar → Install**, paste the client ID and secret, click **Connect**, and finish signing in in your browser. Then pick calendars, the target list, how many days ahead, and the priority for imported tasks.

The client secret and refresh token are encrypted with `safeStorage` like the GitHub token. The selected calendars and import options are synced, but only devices you connect run the import. Access is read-only (`calendar.readonly`).

### Microsoft To Do

Imports your lists and tasks from the Microsoft To Do app installed on the same PC. It reads the offline copy the app keeps of each signed-in account (`%LOCALAPPDATA%\Packages\Microsoft.Todos_8wekyb3d8bbwe\LocalState\AccountsRoot\<account>\todosqlite.db`), read-only and from a copy in memory, so it needs no Microsoft sign-in or Graph API permissions. That matters for school and work accounts, where the tenant usually blocks third-party apps.

1. Open Microsoft To Do and let it sync. It can stay open.
2. **Extensions → Microsoft To Do → Install**, pick the account (each is described by its lists and task counts), choose whether to include completed tasks and the priority for imported tasks, then **Run now** (or **Sync**).

Your Tasks list goes into Tasks; other lists become lists (merged into an existing list with the same name); groups become folders; important tasks are starred; steps become a `- [ ]` checklist in the notes; due dates carry over. Completed tasks finished longer ago than the archive setting are imported straight into the archive. Flagged-email lists and reminders/repeats aren't imported. Each task is imported once (a per-device ledger plus ids derived from the Microsoft To Do ids), so while the extension stays installed, every Sync brings in only tasks added in Microsoft To Do since; uninstall it when you've moved over.

### Chrome quick add (companion)

Adds tasks from the browser without the desktop app running: it writes `data/tasks/<uuid>.json` straight to your tasks repo, and the app picks the task up on its next Sync.

- **Toolbar popup**: title and notes are prefilled with the tab's title and URL; pick a priority, a list and ★, then **Add**.
- **Right-click → Add to TODO** on a page, link or selected text opens the popup prefilled with that.

Setup:

1. `npm run build:extension`
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension/dist` folder.
3. Create a **separate** fine-grained PAT for the extension (only the tasks repo, *Contents: Read and write*) so it can be revoked on its own.
4. Open the extension's options (⚙ in the popup), enter the repo owner, name, branch and the token, then **Test connection**.

⚠️ The extension keeps its token in `chrome.storage.local`, which is *not* encrypted by the OS the way the desktop app's DPAPI-protected token is. Anyone with access to your Chrome profile could read it, which is another reason to give it its own narrowly scoped token.

## Docs

- `docs/ROADMAP.md`: what's done, what's next and open questions.
- `docs/KNOWLEDGE_BASE.md`: the plan for one searchable, backed-up knowledge base across tasks, video notes and Obsidian.
- `CLAUDE.md`: architecture notes for working on the code.
