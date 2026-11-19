import { describe, expect, it } from 'vitest'
import { sharedTextToTask } from './share'

describe('sharedTextToTask', () => {
  it('uses a browser share’s page title as the title and the link as the notes', () => {
    expect(sharedTextToTask({ subject: 'How to bake bread', text: 'https://example.com/bread' })).toEqual({
      title: 'How to bake bread',
      notes: 'https://example.com/bread'
    })
  })

  it('names the task by the first non-link line and keeps the whole text in the notes', () => {
    const text = 'https://youtu.be/abc\nGreat talk on testing\nwatch later'
    expect(sharedTextToTask({ text })).toEqual({ title: 'Great talk on testing', notes: text })
  })

  it('titles a bare link by the link, without repeating it in the notes', () => {
    expect(sharedTextToTask({ text: ' https://example.com/x \n' })).toEqual({ title: 'https://example.com/x', notes: '' })
  })

  it('keeps plain one-line text as just a title', () => {
    expect(sharedTextToTask({ text: 'Buy milk' })).toEqual({ title: 'Buy milk', notes: '' })
    expect(sharedTextToTask({ subject: 'Buy milk', text: 'Buy milk' })).toEqual({ title: 'Buy milk', notes: '' })
  })

  it('shortens a long title but keeps the full text', () => {
    const text = 'word '.repeat(60).trim()
    const result = sharedTextToTask({ text })!
    expect(result.title.length).toBeLessThanOrEqual(160)
    expect(result.title.endsWith('…')).toBe(true)
    expect(result.notes).toBe(text)
  })

  it('ignores an empty share', () => {
    expect(sharedTextToTask({ subject: '  ', text: '\n' })).toBeNull()
    expect(sharedTextToTask({})).toBeNull()
  })
})
