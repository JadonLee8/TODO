import { app, shell } from 'electron'
import { createServer } from 'http'
import { createHash, randomBytes } from 'crypto'
import type { AddressInfo } from 'net'
import * as secureStore from '../../secureStore'

/**
 * Google OAuth for an installed ("Desktop app") client: PKCE plus a loopback redirect to a one-shot local
 * HTTP server. The refresh token is stored encrypted (see secureStore); access tokens live only in memory.
 * Plain fetch, no googleapis dependency, same as github.ts.
 */

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Google's endpoints. In development, TODO_GOOGLE_MOCK_BASE points all of them at a local mock server so the
 * flow can be exercised without real credentials; packaged builds always talk to Google.
 */
export function googleEndpoints() {
  const mock = !app.isPackaged ? process.env['TODO_GOOGLE_MOCK_BASE'] : undefined
  return mock
    ? { auth: `${mock}/auth`, token: `${mock}/token`, revoke: `${mock}/revoke`, api: `${mock}/calendar/v3` }
    : {
        auth: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        revoke: 'https://oauth2.googleapis.com/revoke',
        api: 'https://www.googleapis.com/calendar/v3'
      }
}

let accessToken: { value: string; expiresAt: number } | null = null

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(googleEndpoints().token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const data = (await res.json()) as TokenResponse
  if (!res.ok || data.error) {
    const err = new Error(data.error_description || data.error || `Token request failed (${res.status})`)
    ;(err as Error & { code?: string }).code = data.error
    throw err
  }
  return data
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = secureStore.loadLocalSettings().googleClientId
  const clientSecret = secureStore.loadSecret('google-client-secret')
  if (!clientId || !clientSecret) throw new Error('Add your Google OAuth client ID and secret in Settings first.')
  return { clientId, clientSecret }
}

/** Runs the consent flow in the system browser and stores the resulting refresh token. */
export async function connect(): Promise<void> {
  const { clientId, clientSecret } = credentials()
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Google sign-in.')), CONNECT_TIMEOUT_MS)
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        const error = url.searchParams.get('error')
        const gotCode = url.searchParams.get('code')
        if (!error && !gotCode) {
          res.writeHead(404).end() // e.g. /favicon.ico
          return
        }
        const ok = !error && url.searchParams.get('state') === state
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><title>TODO</title><body style="font-family:sans-serif;padding:40px">` +
            (ok ? 'Connected to Google Calendar. You can close this tab.' : 'Google sign-in failed. You can close this tab.') +
            `</body>`
        )
        clearTimeout(timer)
        if (error) reject(new Error(`Google sign-in was not completed (${error}).`))
        else if (!ok) reject(new Error('Google sign-in failed: state mismatch.'))
        else resolve(gotCode!)
      })

      const authUrl = new URL(googleEndpoints().auth)
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // offline + consent so Google always returns a refresh token, even on a reconnect.
        access_type: 'offline',
        prompt: 'consent'
      }).toString()
      void shell.openExternal(authUrl.toString())
    })

    const tokens = await tokenRequest({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Try disconnecting and connecting again.')
    secureStore.saveSecret('google-refresh-token', tokens.refresh_token)
    accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 }
  } finally {
    server.close()
  }
}

/** A valid access token, refreshed when needed. Throws if this device isn't connected. */
export async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) return accessToken.value
  const refreshToken = secureStore.loadSecret('google-refresh-token')
  if (!refreshToken) throw new Error('Not connected to Google Calendar.')
  const { clientId, clientSecret } = credentials()
  try {
    const tokens = await tokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
    accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 }
    return accessToken.value
  } catch (err) {
    // invalid_grant = the refresh token was revoked or expired (e.g. after 7 days in "Testing" status).
    if ((err as Error & { code?: string }).code === 'invalid_grant') {
      secureStore.clearSecret('google-refresh-token')
      accessToken = null
      throw new Error('Google access expired or was revoked. Connect again in Settings.')
    }
    throw err
  }
}

/** Forgets this device's Google connection, revoking the token with Google when possible. */
export async function disconnect(): Promise<void> {
  const refreshToken = secureStore.loadSecret('google-refresh-token')
  secureStore.clearSecret('google-refresh-token')
  accessToken = null
  if (refreshToken) {
    await fetch(`${googleEndpoints().revoke}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {})
  }
}
