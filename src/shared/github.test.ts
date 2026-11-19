import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64ToUtf8, commitNewFiles, utf8ToBase64 } from './github'

describe('base64 helpers', () => {
  it('match Node Buffer encoding, including non-ASCII text', () => {
    const text = '{"title":"Café ☕ — 日本語 🚀"}'
    expect(utf8ToBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text)
  })

  it('decode GitHub-style line-wrapped base64', () => {
    const text = 'x'.repeat(200)
    const wrapped = Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\n')
    expect(base64ToUtf8(wrapped)).toBe(text)
  })

  it('handle large inputs', () => {
    const text = 'é'.repeat(100_000)
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text)
  })
})

describe('commitNewFiles', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A fake GitHub: the branch at `head`, whose tree holds `existing`; `moved` makes the ref update fail. */
  function fakeGitHub(existing: string[], moved = false) {
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.github.com/repos/o/r/git', '')
      const method = init.method ?? 'GET'
      const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
      calls.push({ method, path, body })
      const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
      if (path === '/ref/heads/main') return ok({ object: { sha: 'head' } })
      if (path === '/commits/head') return ok({ tree: { sha: 'tree0' } })
      if (path === '/trees/tree0?recursive=1') return ok({ tree: existing.map((p) => ({ path: p, sha: 'old' })) })
      if (path === '/trees' && method === 'POST') return ok({ sha: 'tree1' }, 201)
      if (path === '/commits' && method === 'POST') return ok({ sha: 'commit1' }, 201)
      if (path === '/refs/heads/main') return moved ? ok({ message: 'Update is not a fast forward' }, 422) : ok({})
      if (path === '/trees/tree1?recursive=1') return ok({ tree: [{ path: 'data/tasks/a.json', sha: 'sha-a' }, { path: 'data/tasks/b.json', sha: 'sha-b' }] })
      return ok({ message: 'unexpected' }, 500)
    })
    return calls
  }

  const files = [
    { path: 'data/tasks/a.json', content: '{"id":"a"}' },
    { path: 'data/tasks/b.json', content: '{"id":"b"}' }
  ]

  it('commits all files at once on top of the branch head and returns their shas', async () => {
    const calls = fakeGitHub(['data/lists.json'])
    const shas = await commitNewFiles('t', 'o', 'r', 'main', files, 'Add 2 tasks')
    expect(shas).toEqual(new Map([['data/tasks/a.json', 'sha-a'], ['data/tasks/b.json', 'sha-b']]))
    expect(calls.find((c) => c.path === '/trees' && c.method === 'POST')?.body).toMatchObject({
      base_tree: 'tree0',
      tree: [{ path: 'data/tasks/a.json', mode: '100644', type: 'blob', content: '{"id":"a"}' }, { path: 'data/tasks/b.json' }]
    })
    expect(calls.find((c) => c.path === '/commits')?.body).toEqual({ message: 'Add 2 tasks', tree: 'tree1', parents: ['head'] })
    expect(calls.find((c) => c.path === '/refs/heads/main')?.body).toEqual({ sha: 'commit1', force: false })
  })

  it('gives up without writing when a file already exists', async () => {
    const calls = fakeGitHub(['data/tasks/b.json'])
    expect(await commitNewFiles('t', 'o', 'r', 'main', files, 'Add 2 tasks')).toBeNull()
    expect(calls.some((c) => c.method !== 'GET')).toBe(false)
  })

  it('gives up when the branch moved while committing', async () => {
    fakeGitHub([], true)
    expect(await commitNewFiles('t', 'o', 'r', 'main', files, 'Add 2 tasks')).toBeNull()
  })
})
