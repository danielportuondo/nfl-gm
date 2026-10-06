import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

export interface NavItem {
  id: string
  label: string
  disabled?: boolean
  /** Waiting items (e.g. trade offers); shown as a count, hidden at zero. */
  badge?: number
}

interface RailProps {
  items: NavItem[]
  current: string
  onSelect: (id: string) => void
}

const TAB_SLOTS = 4

function plural(n: number): string {
  return `${n} offer${n === 1 ? '' : 's'}`
}

function NavLabel({ label, badge }: { label: string; badge?: number }) {
  if (!badge || badge <= 0) return <>{label}</>
  return (
    <>
      {label}
      <span className="gg-nav-badge" aria-hidden="true">
        {badge}
      </span>
      <span className="gg-visually-hidden">, {plural(badge)}</span>
    </>
  )
}

/** Left rail (desktop) and bottom tab bar (≤720px), same nav data, arrow-key roving tabindex. */
export function Rail({ items, current, onSelect }: RailProps) {
  const railRefs = useRef<Array<HTMLButtonElement | null>>([])
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  const primary = items.length > TAB_SLOTS + 1 ? items.slice(0, TAB_SLOTS) : items
  const overflow = items.length > TAB_SLOTS + 1 ? items.slice(TAB_SLOTS) : []

  useEffect(() => {
    if (!moreOpen) return
    function onDocClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  function move(
    refs: RefObject<Array<HTMLButtonElement | null>>,
    list: NavItem[],
    e: KeyboardEvent,
    forwardKey: string,
    backwardKey: string,
  ) {
    if (e.key !== forwardKey && e.key !== backwardKey) return
    e.preventDefault()
    const enabled = list.map((it, i) => ({ it, i })).filter((x) => !x.it.disabled)
    if (enabled.length === 0) return
    const curIdx = enabled.findIndex((x) => x.it.id === current)
    const dir = e.key === forwardKey ? 1 : -1
    const next =
      enabled[
        ((((curIdx === -1 ? 0 : curIdx) + dir) % enabled.length) + enabled.length) % enabled.length
      ]!
    onSelect(next.it.id)
    refs.current[next.i]?.focus()
  }

  const overflowActive = overflow.some((it) => it.id === current)

  return (
    <>
      <nav className="gg-rail" aria-label="Main">
        {items.map((it, i) => (
          <button
            key={it.id}
            ref={(el) => {
              railRefs.current[i] = el
            }}
            type="button"
            className="gg-rail__item"
            aria-current={it.id === current ? 'page' : undefined}
            disabled={it.disabled}
            onClick={() => !it.disabled && onSelect(it.id)}
            onKeyDown={(e) => move(railRefs, items, e, 'ArrowDown', 'ArrowUp')}
          >
            <NavLabel label={it.label} badge={it.badge} />
          </button>
        ))}
      </nav>
      <nav className="gg-tabbar" aria-label="Main">
        {primary.map((it, i) => (
          <button
            key={it.id}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            className="gg-tabbar__item"
            aria-current={it.id === current ? 'page' : undefined}
            disabled={it.disabled}
            onClick={() => !it.disabled && onSelect(it.id)}
            onKeyDown={(e) => move(tabRefs, primary, e, 'ArrowRight', 'ArrowLeft')}
          >
            <NavLabel label={it.label} badge={it.badge} />
          </button>
        ))}
        {overflow.length > 0 && (
          <div className="gg-tabbar__more" ref={moreRef}>
            {moreOpen && (
              <div className="gg-tabbar__more-menu" role="menu" aria-label="More screens">
                {overflow.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    role="menuitem"
                    className="gg-tabbar__more-item"
                    aria-current={it.id === current ? 'page' : undefined}
                    disabled={it.disabled}
                    onClick={() => {
                      if (!it.disabled) {
                        onSelect(it.id)
                        setMoreOpen(false)
                      }
                    }}
                  >
                    <NavLabel label={it.label} badge={it.badge} />
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="gg-tabbar__item"
              aria-current={overflowActive && !moreOpen ? 'page' : undefined}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <NavLabel
                label="More"
                badge={overflow.reduce((sum, it) => sum + (it.badge ?? 0), 0)}
              />
            </button>
          </div>
        )}
      </nav>
    </>
  )
}
