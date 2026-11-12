import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Says exactly what happens, e.g. "Delete list". */
  confirmLabel: string
  cancelLabel?: string
  /** `danger` (red) for changes that lose or overwrite something; `accent` for milder ones. */
  tone?: 'danger' | 'accent'
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<Confirm | null>(null)

/** The app's own "are you sure?" dialog, in place of the browser's confirm(). */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmCtx)
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider')
  return confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)

  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setRequest({ options, resolve })), [])

  const close = (ok: boolean) => {
    request?.resolve(ok)
    setRequest(null)
  }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {request && <Dialog options={request.options} onClose={close} />}
    </ConfirmCtx.Provider>
  )
}

function Dialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const { title, message, confirmLabel, cancelLabel = 'Cancel', tone = 'accent' } = options
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Destructive dialogs start on Cancel, so a stray Enter doesn't delete anything.
    ;(tone === 'danger' ? cancelRef : confirmRef).current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tone, onClose])

  return (
    <div className="overlay centered dialog-overlay" onMouseDown={() => onClose(false)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={message ? 'dialog-message' : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keep Tab inside the dialog's two buttons.
          if (e.key !== 'Tab') return
          e.preventDefault()
          ;(document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus()
        }}
      >
        <h2 id="dialog-title">{title}</h2>
        {message && (
          <div id="dialog-message" className="dialog-message">
            {message}
          </div>
        )}
        <div className="dialog-buttons">
          <button ref={cancelRef} className="btn" onClick={() => onClose(false)}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} className={`btn ${tone === 'danger' ? 'danger-solid' : 'accent'}`} onClick={() => onClose(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
