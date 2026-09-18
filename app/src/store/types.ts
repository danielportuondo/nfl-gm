import type { DataSource, EngineContext, EngineModules, GameSettings, LeagueState, PersistenceModule, PlayerId, Position, StaticData, TeamId } from '@contracts/index'
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

export type DataStatus = 'loading' | 'ready' | 'error'

export interface StoreConfig {
  mode?: Mode
  modules?: Partial<EngineModules>
  persistence?: PersistenceModule
  /** Engine mode: static data, season chunks and trajectories come from here (HttpDataSource in the app). */
  dataSource?: DataSource
  /** Overrides the ctx built from `data`/trajectories — mainly for tests. */
  ctx?: Partial<Pick<EngineContext, 'trajectories' | 'seasonData'>>
}

export interface GameStoreState {
  mode: Mode
  state: LeagueState | null
  data: StaticData | null
  dataStatus: DataStatus
  dataError: string | null
  screen: ScreenId
  selectedPlayerId: PlayerId | null
  theme: Theme
  toasts: ToastItem[]
  busy: { newGame: boolean; simWeek: boolean; advancePhase: boolean; save: boolean }
  actions: {
    /** Engine mode loads the start season's chunks (and the next two drafts') before building the league. */
    newGame: (opts: NewGameInput) => Promise<void>
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
