import { useRef, type KeyboardEvent, type RefObject } from 'react'

export interface NavItem {
  id: string
  label: string
  disabled?: boolean
}

interface RailProps {
  items: NavItem[]
  current: string
  onSelect: (id: string) => void
}

/** Left rail (desktop) and bottom tab bar (≤720px), same nav data, arrow-key roving tabindex. */
export function Rail({ items, current, onSelect }: RailProps) {
  const railRefs = useRef<Array<HTMLButtonElement | null>>([])
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function move(refs: RefObject<Array<HTMLButtonElement | null>>, e: KeyboardEvent, forwardKey: string, backwardKey: string) {
    if (e.key !== forwardKey && e.key !== backwardKey) return
    e.preventDefault()
    const enabled = items.map((it, i) => ({ it, i })).filter((x) => !x.it.disabled)
    if (enabled.length === 0) return
    const curIdx = enabled.findIndex((x) => x.it.id === current)
    const dir = e.key === forwardKey ? 1 : -1
    const next = enabled[(((curIdx === -1 ? 0 : curIdx) + dir) % enabled.length + enabled.length) % enabled.length]!
    onSelect(next.it.id)
    refs.current[next.i]?.focus()
  }

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
            onKeyDown={(e) => move(railRefs, e, 'ArrowDown', 'ArrowUp')}
          >
            {it.label}
          </button>
        ))}
      </nav>
      <nav className="gg-tabbar" aria-label="Main">
        {items.slice(0, 5).map((it, i) => (
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
            onKeyDown={(e) => move(tabRefs, e, 'ArrowRight', 'ArrowLeft')}
          >
            {it.label}
          </button>
        ))}
      </nav>
    </>
  )
}
