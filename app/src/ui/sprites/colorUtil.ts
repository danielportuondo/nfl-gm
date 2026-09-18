/**
 * Small color helpers for team-scoped rendering. No dependency on state.truth or any engine module.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG-ish relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/**
 * Chooses whichever of the two on-color tokens reads legibly against a team primary color.
 * Approximated by luminance: a light team primary gets the dark ("line") token, a dark one the
 * light ("text-1" / "text-inverse") token (docs/DESIGN.md §2.1 --on-team-primary).
 */
export function pickOnTeamColor(primaryHex: string): 'var(--line)' | 'var(--text-inverse)' {
  return relativeLuminance(primaryHex) > 0.5 ? 'var(--line)' : 'var(--text-inverse)'
}
