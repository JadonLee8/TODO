/**
 * A small key-value store on IndexedDB. The cache lives in memory (shared/memoryCacheStore.ts) and every change is
 * written behind to here; on startup everything is read back. IndexedDB is private to the app and survives restarts.
 */

const DB_NAME = 'todo'
const STORE = 'records'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface RecordStore {
  /** Everything stored, as [key, value] pairs. */
  entries: Array<[string, unknown]>
  /** Queues a write (`undefined` deletes). Writes made in the same tick share one transaction. */
  set(key: string, value: unknown): void
  /** Resolves once every queued write is on disk. */
  flush(): Promise<void>
}

export async function openRecordStore(): Promise<RecordStore> {
  const db = await openDb()
  const entries = await new Promise<Array<[string, unknown]>>((resolve, reject) => {
    const out: Array<[string, unknown]> = []
    const req = db.transaction(STORE).objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return resolve(out)
      out.push([cursor.key as string, cursor.value])
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })

  let queued = new Map<string, unknown>()
  let pending: Promise<void> = Promise.resolve()
  let scheduled = false

  function commit(): void {
    scheduled = false
    const batch = queued
    queued = new Map()
    const write = new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const [key, value] of batch) {
        if (value === undefined) store.delete(key)
        else store.put(value, key)
      }
      tx.oncomplete = () => resolve()
      // A failed write only loses that change from disk; the in-memory cache is still right for this session.
      tx.onerror = tx.onabort = () => {
        console.error('Could not save to local storage', tx.error)
        resolve()
      }
    })
    pending = pending.then(() => write)
  }

  return {
    entries,
    set(key, value) {
      queued.set(key, value)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(commit)
      }
    },
    async flush() {
      if (scheduled) commit()
      await pending
    }
  }
}
