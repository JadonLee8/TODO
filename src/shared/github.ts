/**
 * Thin client over the GitHub REST "Contents" and "Git Trees" APIs.
 * Each putFile/deleteFile call creates exactly one commit on the target branch —
 * that's what gives us "a commit every time a task is added or removed" for free,
 * and each file's `sha` doubles as an optimistic-concurrency token for conflict detection.
 * Environment-agnostic (fetch + TextEncoder), shared by the Electron main process and the Chrome extension.
 */

const API_BASE = 'https://api.github.com'

export class GitHubConflictError extends Error {
  constructor(public path: string) {
    super(`Conflict updating ${path}: remote content changed since last sync`)
    this.name = 'GitHubConflictError'
  }
}

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
}

async function request(token: string, path: string, options: RequestOptions = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  return res
}

export async function verifyToken(token: string): Promise<{ login: string }> {
  const res = await request(token, '/user')
  if (!res.ok) throw new GitHubApiError(res.status, 'Invalid or expired GitHub token')
  const data = (await res.json()) as { login: string }
  return { login: data.login }
}

export async function verifyRepoAccess(token: string, owner: string, repo: string): Promise<void> {
  const res = await request(token, `/repos/${owner}/${repo}`)
  if (!res.ok) {
    throw new GitHubApiError(res.status, `Cannot access ${owner}/${repo}: ${res.status === 404 ? 'not found' : 'access denied'}`)
  }
}

export interface RemoteTreeEntry {
  path: string
  sha: string
}

/** Lists all blob paths+shas under the repo, restricted to files under `data/`. */
export async function getDataTree(token: string, owner: string, repo: string, branch: string): Promise<RemoteTreeEntry[]> {
  const res = await request(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (res.status === 404) return [] // empty/uninitialized repo or branch doesn't exist yet
  if (!res.ok) throw new GitHubApiError(res.status, `Failed to list repo tree (${res.status})`)
  const data = (await res.json()) as { tree: Array<{ path: string; sha: string; type: string }> }
  return data.tree.filter((e) => e.type === 'blob' && e.path.startsWith('data/')).map((e) => ({ path: e.path, sha: e.sha }))
}

export interface RemoteFile {
  content: string
  sha: string
}

export async function getFileContent(token: string, owner: string, repo: string, path: string, branch: string): Promise<RemoteFile | null> {
  const res = await request(token, `/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new GitHubApiError(res.status, `Failed to read ${path} (${res.status})`)
  const data = (await res.json()) as { content: string; encoding: string; sha: string }
  const content = data.encoding === 'base64' ? base64ToUtf8(data.content) : data.content
  return { content, sha: data.sha }
}

/** Creates or updates a file. Omit `sha` to create a new file. Returns the new blob sha. */
export async function putFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
  message: string,
  sha?: string
): Promise<string> {
  const res = await request(token, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: {
      message,
      content: utf8ToBase64(content),
      branch,
      ...(sha ? { sha } : {})
    }
  })
  if (res.status === 409 || res.status === 422) throw new GitHubConflictError(path)
  if (!res.ok) throw new GitHubApiError(res.status, `Failed to write ${path} (${res.status})`)
  const data = (await res.json()) as { content: { sha: string } }
  return data.content.sha
}

export async function deleteFile(token: string, owner: string, repo: string, path: string, branch: string, message: string, sha: string): Promise<void> {
  const res = await request(token, `/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    body: { message, sha, branch }
  })
  if (res.status === 409 || res.status === 422) throw new GitHubConflictError(path)
  if (res.status === 404) return // already gone
  if (!res.ok) throw new GitHubApiError(res.status, `Failed to delete ${path} (${res.status})`)
}

/**
 * Adds many new files in a single commit through the Git Data API: one tree, one commit and one ref update, instead
 * of a Contents API request per file (GitHub allows only about 80 content-creating requests a minute and 500 an hour).
 * Only for files that don't exist yet. Returns each path's blob sha, or null when it can't be done safely: the branch
 * doesn't exist, one of the paths already exists, or the branch moved while committing. Callers then fall back to
 * putFile, which detects conflicts per file.
 */
export async function commitNewFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  message: string
): Promise<Map<string, string> | null> {
  const base = `/repos/${owner}/${repo}/git`
  const json = async <T>(res: Response, what: string): Promise<T> => {
    if (!res.ok) throw new GitHubApiError(res.status, `Failed to ${what} (${res.status})`)
    return (await res.json()) as T
  }

  const refRes = await request(token, `${base}/ref/heads/${encodePath(branch)}`)
  if (refRes.status === 404 || refRes.status === 409) return null // no branch yet (409 = empty repo)
  const headSha = (await json<{ object: { sha: string } }>(refRes, 'read the branch')).object.sha
  const head = await json<{ tree: { sha: string } }>(await request(token, `${base}/commits/${headSha}`), 'read the latest commit')

  const existing = await json<{ tree: Array<{ path: string }> }>(await request(token, `${base}/trees/${head.tree.sha}?recursive=1`), 'list the repo')
  const existingPaths = new Set(existing.tree.map((e) => e.path))
  if (files.some((f) => existingPaths.has(f.path))) return null

  const tree = await json<{ sha: string }>(
    await request(token, `${base}/trees`, {
      method: 'POST',
      body: { base_tree: head.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }
    }),
    'create the tree'
  )
  const commit = await json<{ sha: string }>(
    await request(token, `${base}/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [headSha] } }),
    'create the commit'
  )
  // Not forced: fails with 422 if someone pushed since we read the branch. The orphaned commit is harmless.
  const update = await request(token, `${base}/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } })
  if (update.status === 422 || update.status === 409) return null
  await json(update, 'update the branch')

  const created = await json<{ tree: Array<{ path: string; sha: string }> }>(await request(token, `${base}/trees/${tree.sha}?recursive=1`), 'list the new commit')
  const wanted = new Set(files.map((f) => f.path))
  return new Map(created.tree.filter((e) => wanted.has(e.path)).map((e) => [e.path, e.sha]))
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

// Base64 <-> UTF-8 without Node's Buffer, so this client also runs in the browser extension.

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function base64ToUtf8(b64: string): string {
  // GitHub wraps base64 content at 60 columns.
  const binary = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}
