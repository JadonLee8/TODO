# One knowledge base for everything

Research notes and a plan (November 2026). The goal: tasks from this app, video notes from watchwise, Obsidian notes and
anything added later live in one place that's easy to back up, and you can ask an AI questions across all of it. This
repo only does the TODO part. This document is the plan the other parts plug into.

## Recommendation in one paragraph

Make the **Obsidian vault the hub**. Every app writes plain Markdown notes with YAML properties into **its own folder**
of the vault (`TODO/`, `YouTube/`, ...), and each app stays the owner of its own data. On top of that, build a
**throwaway index**: one SQLite file with full-text search (FTS5) and vector search (sqlite-vec), rebuilt from the vault
whenever it changes. Expose it to Claude through an **MCP server**. Backups only need the vault, because the index can
always be rebuilt.

```
 TODO app ──(Obsidian extension)──▶ vault/TODO/      ┐
 watchwise ───────────────────────▶ vault/YouTube/   ├─▶ index.sqlite ─▶ MCP server ─▶ Claude
 you, in Obsidian ────────────────▶ vault/…          ┘   (FTS5 + vectors,   (search, filter,
                                                          rebuilt anytime)   read note)
 Backups: the vault (git + an encrypted off-site copy). The tasks repo on GitHub is already a backup of the tasks.
```

## Why this shape

| Option | Verdict |
| --- | --- |
| **Markdown vault + derived index (recommended)** | Readable by people and by every tool. Obsidian is the viewer for free (search, graph, Bases tables). Backing up means copying one folder. No server to run. watchwise already writes this way. |
| One central database (Postgres, Supabase, Notion) that every app writes to | Every app needs a client and credentials for it, you have to run it or pay for it, and the data stops being readable without it. It's worth it only for many writers or multiple users. |
| Make the vault the *source of truth* for tasks (Obsidian Tasks plugin) | Loses what this app is built on: one commit per change, conflict detection, the Chrome quick-add, the planned Android app. The vault gets a *mirror* instead. |
| A hosted "second brain" (Mem, Supermemory, Khoj Cloud) | Your data lives in someone else's product. Khoj Cloud has been shut down, which shows the risk. |

Rules that keep it from turning into a mess:

1. **One writer per folder.** The TODO app owns `TODO/`, watchwise owns `YouTube/`. Apps don't edit each other's notes.
   Both tools keep a section the user owns (`## Vault notes` here, `## Notes` in watchwise) for your own additions.
2. **Properties over prose for facts.** Status, dates, priority, channel and duration are YAML properties, so questions
   like "what did I finish in October?" are answered with an exact query, not a semantic-search guess.
3. **The index is disposable.** Never store anything only in SQLite. If the index breaks, delete it and rebuild.

## What exists today (the TODO part, built in this repo)

The **Obsidian extension** (Extensions → Obsidian) writes:

- `TODO/Tasks/<title>.md`: one note per task, with properties `todo_id`, `list`, `priority`, `status`
  (open/done/archived), `starred`, `due`, `created`, `completed_at`, `source` and the tag `todo`. Completed and archived
  tasks are kept by default, so the vault holds a history of finished work.
- `TODO/Tasks.base`: an Obsidian Base with "Open" and "Done" table views.
- `TODO/Inbox.md`: unchecked `- [ ]` items become tasks on the next Sync (`#p1`–`#p5` and `📅 YYYY-MM-DD` work), so you
  can capture tasks while you write notes.

It writes plain files, so it needs no Obsidian plugin, and only rewrites a note when its content changes, so Google Drive
or Obsidian Sync doesn't churn. If the vault syncs between computers, set the vault path on one computer only.

## The other parts, in order

1. **Point everything at one vault.** watchwise already writes to your vault in Google Drive. Set the TODO app's
   Obsidian extension to the same vault on your main computer.
2. **Backups.** The vault is the only thing that needs backing up:
   - Version history: the Obsidian Git community plugin, committing every few minutes to a *private* GitHub repo.
     Ignore `.obsidian/workspace*` and `.trash/`.
   - An encrypted off-site copy: restic to Backblaze B2 or S3, weekly, from a scheduled task. Test a restore once.
   - Google Drive is sync, not backup: a deletion there syncs everywhere.
3. **Ask questions: start with an existing indexer.** Several open-source MCP servers already do SQLite FTS5 +
   sqlite-vec hybrid search over an Obsidian vault and plug into Claude Desktop and Claude Code:
   [obsidian-hybrid-search](https://github.com/flowing-abyss/obsidian-hybrid-search) (plugin + CLI + MCP),
   [qkb](https://github.com/miguelarios/qkb) (BM25 + vectors, keyword search works before embeddings finish) and
   [vault-cortex](https://github.com/shcallaway/vault-cortex) (also a reranker; can be self-hosted for remote access).
   [Basic Memory](https://github.com/basicmachines-co/basic-memory) is the same idea aimed at letting the AI write notes
   too (AGPL). Try one against the vault for a couple of weeks before building anything.
4. **Then, if needed, a small custom MCP server** that adds typed tools the generic ones can't do well, because they work
   on the structured properties rather than text:
   - `tasks(status, list, completed_between, due_before)`, `videos(watched_between, channel)`
   - `search(query, folders)` as hybrid BM25 + vector with reciprocal-rank fusion
   - `read(path)`
   Schema: `notes(path, folder, title, body, mtime)`, `properties(path, key, value)`, an FTS5 table over title + body,
   and a `vec0` table of chunk embeddings. Embeddings can run locally (EmbeddingGemma through Ollama or
   transformers.js) or through an embeddings API. Local keeps everything on your machine.
5. **New sources follow the same pattern.** Browser bookmarks, reading highlights, journal: each gets its own folder and
   writes Markdown with properties. The index and MCP server pick them up without changes.

## Open questions

- Should the index and MCP server be a new project (e.g. `Programming/vault-index`) or a mode of an existing tool? Its
  own project is better: it serves every source, not just TODO.
- Remote access (asking from your phone) needs the MCP server hosted somewhere with auth. vault-cortex supports this.
  Decide after local use proves useful.
- Fully local embeddings, or an API? Local is private and free per query but slower to build the first index.

## Sources

- Obsidian Bases (core plugin since 1.9; table, card, list and map views):
  [forum.obsidian.md/tag/bases](https://forum.obsidian.md/tag/bases). Kanban over Bases is still a community plugin,
  e.g. [Kanban Bases View](https://www.obsidianstats.com/plugins/kanban-bases-view).
- Ways into a vault from an external app: [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)
  (HTTP + API key, has an MCP mode; needs Obsidian running) and
  [Advanced URI](https://publish.obsidian.md/advanced-uri-doc) (`obsidian://` links). Plain files were chosen here because
  they work with Obsidian closed and need no plugin.
- Hybrid search MCP servers: the four linked in step 3, plus
  [obsidian-knowledge-mcp](https://github.com/nekottyo/obsidian-knowledge-mcp) (bge-m3 via Ollama, RRF k=60) and
  [engraph](https://github.com/devwhodevs/engraph).
- Memory-style alternatives compared: [hjarni.com/best-mcp-knowledge-base](https://hjarni.com/best-mcp-knowledge-base)
  (written by a competing product, so read it with that in mind).
- Local embeddings: [EmbeddingGemma 2](https://developers.googleblog.com/google-ai-edge-with-embeddinggemma-2/) and
  [embedding models compared](https://surrealdb.com/blog/embedding-models-comparison).
- Backups: [Obsidian Git](https://github.com/Vinzent03/obsidian-git) and
  [encrypted automated backups](https://forum.obsidian.md/t/encrypted-automated-backups/1250).
