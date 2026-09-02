import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { LocalSettings } from '@shared/types'
import { DEFAULT_LOCAL_SETTINGS } from '@shared/types'

/**
 * The GitHub PAT is encrypted at rest with Electron's `safeStorage`, which on Windows
 * delegates to DPAPI (tied to the current OS user account). The decrypted token only ever
 * lives in this process's memory, and is never sent to the renderer.
 */

function tokenPath(): string {
  return join(app.getPath('userData'), 'github-token.enc')
}

function localSettingsPath(): string {
  return join(app.getPath('userData'), 'local-settings.json')
}

export function hasStoredToken(): boolean {
  return existsSync(tokenPath())
}

export function saveToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is not available on this machine')
  }
  const encrypted = safeStorage.encryptString(token)
  writeFileSync(tokenPath(), encrypted)
}

export function loadToken(): string | null {
  if (!existsSync(tokenPath())) return null
  const encrypted = readFileSync(tokenPath())
  return safeStorage.decryptString(encrypted)
}

export function clearToken(): void {
  if (existsSync(tokenPath())) rmSync(tokenPath())
}

export function loadLocalSettings(): LocalSettings {
  if (!existsSync(localSettingsPath())) return { ...DEFAULT_LOCAL_SETTINGS, hasToken: hasStoredToken() }
  const raw = JSON.parse(readFileSync(localSettingsPath(), 'utf8')) as Partial<LocalSettings>
  return { ...DEFAULT_LOCAL_SETTINGS, ...raw, hasToken: hasStoredToken() }
}

export function saveLocalSettings(settings: Omit<LocalSettings, 'hasToken'>): void {
  writeFileSync(localSettingsPath(), JSON.stringify(settings, null, 2))
}
