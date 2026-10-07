import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { EditableLocalSettings, LocalSettings } from '@shared/types'
import { DEFAULT_LOCAL_SETTINGS } from '@shared/types'

/**
 * Secrets (the GitHub PAT, Google OAuth client secret and refresh token) are encrypted at rest with
 * Electron's `safeStorage`, which on Windows delegates to DPAPI (tied to the current OS user account).
 * Decrypted values only ever live in this process's memory and are never sent to the renderer.
 */

export type SecretName = 'github-token' | 'google-client-secret' | 'google-refresh-token'

function secretPath(name: SecretName): string {
  return join(app.getPath('userData'), `${name}.enc`)
}

function localSettingsPath(): string {
  return join(app.getPath('userData'), 'local-settings.json')
}

export function hasSecret(name: SecretName): boolean {
  return existsSync(secretPath(name))
}

export function saveSecret(name: SecretName, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is not available on this machine')
  }
  writeFileSync(secretPath(name), safeStorage.encryptString(value))
}

export function loadSecret(name: SecretName): string | null {
  if (!existsSync(secretPath(name))) return null
  return safeStorage.decryptString(readFileSync(secretPath(name)))
}

export function clearSecret(name: SecretName): void {
  if (existsSync(secretPath(name))) rmSync(secretPath(name))
}

export const saveToken = (token: string): void => saveSecret('github-token', token)
export const loadToken = (): string | null => loadSecret('github-token')
export const clearToken = (): void => clearSecret('github-token')

function loadRawLocalSettings(): Partial<EditableLocalSettings> {
  return existsSync(localSettingsPath()) ? (JSON.parse(readFileSync(localSettingsPath(), 'utf8')) as Partial<EditableLocalSettings>) : {}
}

export function loadLocalSettings(): LocalSettings {
  const raw = loadRawLocalSettings()
  return {
    ...DEFAULT_LOCAL_SETTINGS,
    ...raw,
    hasToken: hasSecret('github-token'),
    hasGoogleClientSecret: hasSecret('google-client-secret'),
    googleConnected: hasSecret('google-refresh-token')
  }
}

/** Merges the given fields into the stored local settings. */
export function saveLocalSettings(settings: Partial<EditableLocalSettings>): void {
  writeFileSync(localSettingsPath(), JSON.stringify({ ...loadRawLocalSettings(), ...settings }, null, 2))
}
