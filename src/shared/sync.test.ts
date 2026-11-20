import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncNow } from './sync'
import { createMemoryCacheStore } from './memoryCacheStore'
import type { CacheStore } from './cacheStore'
import { MAIN_LIST_ID, type Task } from './types'

/** An in-memory stand-in for the parts of GitHub's REST API the sync uses, for the repo o/r on branch main. */
function fakeGitHub() {
  const files = new Map<string, { content: string; sha: string }>()
  const requests: Array<{ method: string; path: string }> = []
  let nextSha = 1
  let pendingTree: Array<{ path: string; content: string }> = []
  /** Runs before a request is answered: lets a test edit the cache while a request is "in flight". */
  let beforeResponse: ((method: string, path: string) => void) | null = null

  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
  const tree = () => ({ tree: [...files].map(([path, f]) => ({ path, sha: f.sha, type: 'blob' })) })
  const put = (path: string, content: string) => {
    const sha = `sha${nextSha++}`
    files.set(path, { content, sha })
    return sha
  }

  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = decodeURIComponent(url.replace('https://api.github.com/repos/o/r', ''))
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
    requests.push({ method, path })
    beforeResponse?.(method, path)

    if (path.startsWith('/contents/')) {
      const file = path.slice('/contents/'.length).replace(/\?ref=.*$/, '')
      const existing = files.get(file)
      if (method === 'GET') {
        return existing ? json({ content: Buffer.from(existing.content).toString('base64'), encoding: 'base64', sha: existing.sha }) : json({}, 404)
      }
      if ((existing?.sha ?? undefined) !== (body.sha as string | undefined)) return json({}, 409)
      if (method === 'PUT') return json({ content: { sha: put(file, Buffer.from(body.content as string, 'base64').toString()) } })
      files.delete(file)
      return json({})
    }
    if (path === '/git/trees/main?recursive=1' || path === '/git/trees/tree0?recursive=1' || path === '/git/trees/tree1?recursive=1') return json(tree())
    if (path === '/git/ref/heads/main') return json({ object: { sha: 'head' } })
    if (path === '/git/commits/head') return json({ tree: { sha: 'tree0' } })
    if (path === '/git/trees' && method === 'POST') {
      pendingTree = body.tree as typeof pendingTree
      return json({ sha: 'tree1' }, 201)
    }
    if (path === '/git/commits' && method === 'POST') return json({ sha: 'commit1' }, 201)
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      for (const f of pendingTree) put(f.path, f.content)
      return json({})
    }
    return json({ message: `unexpected ${method} ${path}` }, 500)
  })

  return {
    files,
    requests,
    task: (id: string) => JSON.parse(files.get(`data/tasks/${id}.json`)!.content) as Task,
    onRequest: (hook: typeof beforeResponse) => (beforeResponse = hook)
  }
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    listId: MAIN_LIST_ID,
    title: `Task ${id}`,
    notes: '',
    priority: 3,
    starred: false,
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    archived: false,
    dueDate: null,
    source: null,
    ...over
  }
}

const edit = (cache: CacheStore, t: Task) => {
  cache.writeTaskLocal(t)
  cache.markTaskDirty(t.id)
}
const sync = (cache: CacheStore) => syncNow(cache, 'token', 'o', 'r', 'main')

describe('syncNow', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pushes a new task from one device and pulls it on another', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    edit(a, task('1'))

    expect(await sync(a)).toMatchObject({ pushed: 1, pulled: 0, error: null })
    expect(github.task('1').title).toBe('Task 1')
    expect(a.getSyncMeta().dirtyTaskIds).toEqual([])

    expect(await sync(b)).toMatchObject({ pushed: 0, pulled: 1 })
    expect(b.getTask('1')).toEqual(task('1'))
    // Nothing changed: a second sync moves nothing.
    expect(await sync(b)).toMatchObject({ pushed: 0, pulled: 0 })
  })

  it('pushes edits and deletions, and removes tasks deleted elsewhere', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    edit(a, task('1'))
    edit(a, task('2'))
    await sync(a)
    await sync(b)

    edit(a, task('1', { title: 'Renamed' }))
    a.removeTaskLocal('2')
    a.markTaskDeleted('2')
    expect(await sync(a)).toMatchObject({ pushed: 2 })
    expect(github.files.has('data/tasks/2.json')).toBe(false)

    await sync(b)
    expect(b.getTask('1')?.title).toBe('Renamed')
    expect(b.getTask('2')).toBeNull()
  })

  it('surfaces an edit on both sides as a conflict and waits for the user before pushing', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    edit(a, task('1'))
    await sync(a)
    await sync(b)

    edit(a, task('1', { title: 'From A' }))
    await sync(a)
    edit(b, task('1', { title: 'From B' }))
    const result = await sync(b)
    expect(result.conflicts).toMatchObject([{ taskId: '1', local: { title: 'From B' }, remote: { title: 'From A' }, base: { title: 'Task 1' } }])
    expect(b.getSyncMeta().conflictTaskIds).toEqual(['1'])

    // Syncing again (as auto-sync would) must not push the local side over the remote one.
    expect(await sync(b)).toMatchObject({ pushed: 0, conflicts: [] })
    expect(github.task('1').title).toBe('From A')
    expect(b.getTask('1')?.title).toBe('From B')

    // Keep local: what the conflict dialog does.
    b.markTaskDirty('1')
    b.clearTaskConflict('1')
    expect(await sync(b)).toMatchObject({ pushed: 1 })
    expect(github.task('1').title).toBe('From B')
  })

  it('keeps the remote side when the user picks it', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    edit(a, task('1'))
    await sync(a)
    await sync(b)
    edit(a, task('1', { title: 'From A' }))
    await sync(a)
    edit(b, task('1', { title: 'From B' }))
    await sync(b)

    b.acceptRemoteTask(b.getConflictRemote('1')!)
    b.clearTaskConflict('1')
    expect(await sync(b)).toMatchObject({ pushed: 0 })
    expect(b.getTask('1')?.title).toBe('From A')
    expect(github.task('1').title).toBe('From A')
  })

  it('keeps the remote side without asking when both sides made the same change at different times', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    edit(a, task('1', { completed: true, completedAt: '2026-01-02T00:00:00.000Z' }))
    await sync(a)
    await sync(b)

    // Both devices auto-archive it, a minute apart.
    edit(a, task('1', { completed: true, completedAt: '2026-01-02T00:00:00.000Z', archived: true, updatedAt: '2026-01-09T00:01:00.000Z' }))
    await sync(a)
    edit(b, task('1', { completed: true, completedAt: '2026-01-02T00:00:00.000Z', archived: true, updatedAt: '2026-01-09T00:00:00.000Z' }))
    expect(await sync(b)).toMatchObject({ pushed: 0, conflicts: [], error: null })
    expect(b.getSyncMeta().conflictTaskIds).toEqual([])
    expect(b.getSyncMeta().dirtyTaskIds).toEqual([])
    expect(b.getTask('1')).toEqual(github.task('1'))

    // And it pulls later edits from elsewhere as usual.
    edit(a, task('1', { title: 'Later', completed: true, archived: true }))
    await sync(a)
    expect(await sync(b)).toMatchObject({ pulled: 1 })
    expect(b.getTask('1')?.title).toBe('Later')
  })

  it('clears a saved conflict whose sides differ only in timestamps', async () => {
    const github = fakeGitHub()
    const b = createMemoryCacheStore()
    edit(b, task('1'))
    await sync(b)
    // A conflict saved by an older version of the sync.
    const remote = github.task('1')
    b.writeTaskLocal(task('1', { updatedAt: '2026-01-05T00:00:00.000Z' }))
    b.markTaskDirty('1')
    b.markTaskConflict('1', remote)

    expect(await sync(b)).toMatchObject({ pushed: 0, conflicts: [], error: null })
    expect(b.getSyncMeta().conflictTaskIds).toEqual([])
    expect(b.getConflictRemote('1')).toBeNull()
    expect(b.getTask('1')).toEqual(remote)
  })

  it('still asks when the sides differ in more than timestamps', async () => {
    fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    edit(a, task('1'))
    await sync(a)
    await sync(b)
    edit(a, task('1', { archived: true, updatedAt: '2026-01-09T00:01:00.000Z' }))
    await sync(a)
    edit(b, task('1', { completed: true, updatedAt: '2026-01-09T00:00:00.000Z' }))
    expect((await sync(b)).conflicts).toHaveLength(1)
  })

  it('pushes many new tasks as one commit', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    for (let i = 0; i < 12; i++) edit(a, task(`t${i}`))

    expect(await sync(a)).toMatchObject({ pushed: 12, pulled: 0, error: null })
    expect(github.requests.filter((r) => r.method === 'PUT')).toEqual([])
    expect(github.files.size).toBe(12)
    expect(a.getSyncMeta().dirtyTaskIds).toEqual([])
    expect(Object.keys(a.getSyncMeta().fileShas)).toHaveLength(12)

    // The recorded shas are the real ones: an edit afterwards goes through as a normal update.
    edit(a, task('t3', { title: 'Edited' }))
    expect(await sync(a)).toMatchObject({ pushed: 1, conflicts: [] })
    expect(github.task('t3').title).toBe('Edited')
  })

  it('keeps an edit made while its task was being pushed', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    edit(a, task('1'))
    edit(a, task('2'))
    github.onRequest((method, path) => {
      if (method !== 'PUT' || !path.endsWith('/1.json')) return
      github.onRequest(null)
      edit(a, task('1', { title: 'Edited mid-sync' })) // the task being pushed
      edit(a, task('3')) // a new task created during the sync
    })

    await sync(a)
    expect(github.task('1').title).toBe('Task 1')
    expect(a.getSyncMeta().dirtyTaskIds.sort()).toEqual(['1', '3'])
    expect(a.getTask('1')?.title).toBe('Edited mid-sync')

    expect(await sync(a)).toMatchObject({ pushed: 2, conflicts: [] })
    expect(github.task('1').title).toBe('Edited mid-sync')
    expect(github.files.has('data/tasks/3.json')).toBe(true)
  })

  it('syncs lists last-writer-wins and keeps a list edit made during the push', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    const b = createMemoryCacheStore()
    const lists = (...names: string[]) => names.map((name, order) => ({ id: name, name, order }))

    a.writeListsLocal(lists('one'))
    a.markListsDirty()
    await sync(a)
    await sync(b)
    expect(b.getLists()).toEqual(lists('one'))

    // Both change the lists; A syncs first, so B's change is replaced by A's.
    a.writeListsLocal(lists('one', 'from-a'))
    a.markListsDirty()
    b.writeListsLocal(lists('one', 'from-b'))
    b.markListsDirty()
    await sync(a)
    await sync(b)
    expect(b.getLists()).toEqual(lists('one', 'from-a'))
    expect(b.getSyncMeta().listsDirty).toBe(false)

    // An edit made while lists.json is being pushed stays dirty and goes up next time.
    a.writeListsLocal(lists('one', 'from-a', 'two'))
    a.markListsDirty()
    github.onRequest((method, path) => {
      if (method !== 'PUT' || !path.endsWith('lists.json')) return
      github.onRequest(null)
      a.writeListsLocal(lists('one', 'from-a', 'two', 'three'))
      a.markListsDirty()
    })
    await sync(a)
    expect(a.getSyncMeta().listsDirty).toBe(true)
    expect(a.getLists()).toHaveLength(4)
    await sync(a)
    expect(JSON.parse(github.files.get('data/lists.json')!.content)).toHaveLength(4)
    expect(a.getSyncMeta().listsDirty).toBe(false)
  })

  it('reports a failure and keeps what was already pushed', async () => {
    const github = fakeGitHub()
    const a = createMemoryCacheStore()
    edit(a, task('1'))
    edit(a, task('2'))
    github.onRequest((method, path) => {
      if (method === 'PUT' && path.endsWith('/2.json')) throw new Error('network down')
    })
    const result = await sync(a)
    expect(result).toMatchObject({ pushed: 1, error: 'network down' })
    expect(a.getSyncMeta().dirtyTaskIds).toEqual(['2'])
  })
})
