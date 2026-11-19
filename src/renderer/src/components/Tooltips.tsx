import { useEffect, useState } from 'react'

/** How long the pointer rests on an element before its tooltip shows. */
const SHOW_DELAY_MS = 450
/** Moving straight from one tooltip to the next shows the next one at once, like native tooltips. */
const WARM_WINDOW_MS = 300
const GAP = 6
const EDGE = 8

/**
 * Styled tooltips in place of the native `title` popups. Any element with `data-tooltip="..."` gets one, on hover
 * or keyboard focus. Mounted once; it watches the whole document, so components only need the attribute.
 * Icon-only controls still need an aria-label: the tooltip is visual only.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    // Hover tooltips have no place on a touch screen, where a tap would leave one hanging.
    if (window.api.platform !== 'desktop') return
    let timer: number | undefined
    let current: Element | null = null
    let lastHidden = 0

    const show = (target: Element) => {
      const text = target.getAttribute('data-tooltip')
      if (!text) return
      current = target
      window.clearTimeout(timer)
      const delay = Date.now() - lastHidden < WARM_WINDOW_MS ? 0 : SHOW_DELAY_MS
      timer = window.setTimeout(() => setTip({ text, anchor: target.getBoundingClientRect() }), delay)
    }
    const hide = () => {
      window.clearTimeout(timer)
      if (current) lastHidden = Date.now()
      current = null
      setTip(null)
    }
    const targetOf = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tooltip]') : null)

    const onOver = (e: Event) => {
      const target = targetOf(e)
      if (target === current) return
      if (target) show(target)
      else hide()
    }
    const onFocus = (e: Event) => {
      const target = targetOf(e)
      if (target && (e.target as Element).matches(':focus-visible')) show(target)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()

    document.addEventListener('pointerover', onOver)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Place it below the element, centered, flipping above and nudging sideways to stay in the window.
  useEffect(() => {
    if (!tip || !el) return setPos(null)
    const { width, height } = el.getBoundingClientRect()
    const a = tip.anchor
    const below = a.bottom + GAP
    const top = below + height > window.innerHeight - EDGE ? a.top - GAP - height : below
    const left = Math.min(Math.max(a.left + a.width / 2 - width / 2, EDGE), window.innerWidth - width - EDGE)
    setPos({ left, top })
  }, [tip, el])

  if (!tip) return null
  return (
    <div ref={setEl} className="tooltip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      {tip.text}
    </div>
  )
}
