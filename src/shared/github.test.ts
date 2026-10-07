import { describe, expect, it } from 'vitest'
import { base64ToUtf8, utf8ToBase64 } from './github'

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
