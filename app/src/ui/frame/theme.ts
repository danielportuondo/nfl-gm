export type Theme = 'dark' | 'light' | 'system'

const KEY = 'gg-theme'

/** Reads the persisted theme choice; falls back to "system" when storage is unavailable (docs/DESIGN.md §10). */
export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    /* private mode / disabled storage: fall back silently */
  }
  return 'system'
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* ignore */
  }
}

/** Applies (or clears, for "system") the data-theme attribute tokens.css keys off. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
