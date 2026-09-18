/**
 * Hand-rolled hash router (no react-router: not installed, none added). Routes: #/new-game,
 * #/dashboard, #/roster, #/player/<id>, #/about.
 */
export type ScreenId = 'new-game' | 'dashboard' | 'roster' | 'player' | 'about'

export interface Route {
  screen: ScreenId
  playerId: string | null
}

const SCREENS: ScreenId[] = ['new-game', 'dashboard', 'roster', 'player', 'about']

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [seg, param] = clean.split('/')
  const screen = (SCREENS as string[]).includes(seg ?? '') ? (seg as ScreenId) : 'new-game'
  return { screen, playerId: screen === 'player' ? (param ?? null) : null }
}

export function buildHash(screen: ScreenId, playerId?: string | null): string {
  if (screen === 'player' && playerId) return `#/player/${playerId}`
  return `#/${screen}`
}

export function currentRoute(): Route {
  if (typeof window === 'undefined') return { screen: 'new-game', playerId: null }
  return parseHash(window.location.hash)
}
