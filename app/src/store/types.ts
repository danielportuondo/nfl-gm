import type { EngineContext, EngineModules, GameSettings, LeagueState, PersistenceModule, PlayerId, Position, StaticData, TeamId } from '@contracts/index'
import type { Theme } from '../ui/frame'
import type { ToastItem } from '../ui/primitives'
import type { ScreenId } from './router'

export type Mode = 'mock' | 'engine'

export interface NewGameInput {
  startSeason: number
  userTeam: TeamId
  horizonSeasons: number
  settings: GameSettings
}

export interface StoreConfig {
  mode?: Mode
  modules?: Partial<EngineModules>
  persistence?: PersistenceModule
  /** Overrides the ctx built from `data`/trajectories — mainly for tests. */
  ctx?: Partial<Pick<EngineContext, 'trajectories' | 'seasonData'>>
}

export interface GameStoreState {
  mode: Mode
  state: LeagueState | null
  data: StaticData | null
  screen: ScreenId
  selectedPlayerId: PlayerId | null
  theme: Theme
  toasts: ToastItem[]
  busy: { simWeek: boolean; advancePhase: boolean; save: boolean }
  actions: {
    newGame: (opts: NewGameInput) => void
    goTo: (screen: ScreenId, playerId?: PlayerId | null) => void
    selectPlayer: (id: PlayerId | null) => void
    setTheme: (theme: Theme) => void
    /** Reorders the user's own depth chart (docs/DESIGN.md §11 Roster). Local to LeagueState; no engine call. */
    setDepthChart: (pos: Position, order: PlayerId[]) => void
    simWeek: () => Promise<void>
    advancePhase: () => Promise<void>
    save: () => Promise<void>
    dismissToast: (id: string) => void
  }
}
