/**
 * Thin client over the GitHub REST "Contents" and "Git Trees" APIs.
 * Each putFile/deleteFile call creates exactly one commit on the target branch —
 * that's what gives us "a commit every time a task is added or removed" for free,
 * and each file's `sha` doubles as an optimistic-concurrency token for conflict detection.
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
  const content = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
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
      content: Buffer.from(content, 'utf8').toString('base64'),
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

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
