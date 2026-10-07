# TODO

A simple, priority-ranked task app that uses a GitHub repo as its backend, so every add/edit/delete is a version-controlled commit and tasks sync across devices.

## Stack

Electron + React + TypeScript, built with [`electron-vite`](https://electron-vite.org). No Redux, no ORM, no server — the main process is the only thing that talks to GitHub or touches your token; the renderer (UI) only talks to the main process over Electron's IPC.

## How it works

- **Storage**: each task is its own JSON file (`data/tasks/<uuid>.json`) in a GitHub repo you choose, plus `data/lists.json` and `data/settings.json`. One file per task means every change is a clean, isolated git diff, and conflicts only happen when the *same* task is edited on two devices before syncing — never unrelated tasks.
- **Commits**: every push to GitHub goes through the Contents API, which creates one real commit per file write — so adding/editing/deleting a task is a commit, automatically.
- **Sync**: manual, via the Sync button. It pushes everything you changed locally, then pulls anything new from GitHub. If a task was edited differently on two devices, it shows up with a reddened row and a "SYNC CONFLICT" tag — click it to see a side-by-side diff and pick which version wins.
- **Token security**: your GitHub personal access token is encrypted at rest using Electron's `safeStorage` (Windows DPAPI, tied to your Windows user account) and only ever decrypted in memory in the main process. The renderer (and the GitHub repo) never sees it.
- **Priority ranking** (main "Tasks" list only): P1 tasks always sort first (oldest first). P4 always sorts above P5 (oldest first within each). P2/P3 are blended by an adjustable age-vs-priority weight in Settings. Other lists (e.g. "Wishlist Projects", "To 3D Print") behave like a normal to-do list, sorted by creation date — priority ranking is specific to the main Tasks view, since these are backlog/reference lists.
- **Completed tasks** collapse into a "Completed" section and auto-archive (drop out of the list entirely) after a configurable number of days.

## First-time setup

1. **Create a GitHub repo** to hold your tasks (can be private). It can be empty — the app will create `data/...` files in it as needed.
2. **Create a fine-grained personal access token**: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories** → your tasks repo.
   - Permissions: **Contents: Read and write**. Nothing else is needed.
3. Run the app (`npm run dev`, or the built portable `.exe`), open **Settings**, and fill in:
   - Repo owner, repo name, branch (usually `main`)
   - Paste the token and click **Save token**, then **Test connection** to confirm.
4. Click **Sync** to do your first push/pull.

## Data format (for a future Android app / widget)

Plain JSON, one task per file, is deliberately chosen for portability: any language can parse it (Kotlin: `kotlinx.serialization` or `Gson`), it's human-readable, and it diffs cleanly in git.

```
data/
  lists.json          # [{ id, name, order, folderId }]
  folders.json        # [{ id, name, order }] (sidebar folders, one level deep)
  settings.json        # ranking + archive settings (not secret, synced)
  tasks/
    <uuid>.json        # one Task per file
```

`lists.json`, `folders.json` and `settings.json` are each a single shared file, and the last device to sync wins. If two devices both reorganize lists or folders before syncing, one device's changes are lost (tasks themselves are never affected). A list whose folder was deleted on another device just shows up at the top level.

See `src/shared/types.ts` for the exact `Task`, `TaskList`, and `SyncedSettings` shapes — that file is the source of truth for the on-disk format.

## Commands

```
npm run dev        # run the app in development (hot reload)
npm run typecheck  # type-check main/preload + renderer
npm run build       # type-check + production build (out/)
npm run dist        # build + package a portable Windows .exe (dist/)
```

## Not yet implemented

These are stubbed in Settings but require you to register OAuth credentials I can't create on your behalf:

- **Microsoft To Do import** — needs an Azure AD app registration for Microsoft Graph.
- **Google Calendar integration** — needs a Google Cloud OAuth client (Desktop app type): pick calendars, auto-import events as tasks within a date range, and auto-promote overdue ones to P1.

Once you have those credentials, they can be wired in as a follow-up.
