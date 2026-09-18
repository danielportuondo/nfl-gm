import type {
  Contract,
  DataSource,
  EngineContext,
  EngineModules,
  GameSettings,
  LeagueState,
  NeedProfile,
  PersistenceModule,
  PlayerId,
  Position,
  SaveSlotMeta,
  Season,
  StandingRow,
  StaticData,
  TeamId,
  TradeEvaluation,
  TradeProposal,
} from '@contracts/index'
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
  /**
   * Non-user-team WeekReport events (docs/HANDOFF.md Phase 3E follow-up): the Dashboard can read this
   * later for a full log. Only events involving the user's team become toasts.
   */
  alerts: string[]
  /** Metadata for the 'default' save slot, if one exists; drives the New Game screen's Continue affordance. */
  savedGame: SaveSlotMeta | null
  /** Ephemeral AI-initiated season trade offers fetched by the Trade Center; not part of LeagueState. */
  tradeOffers: TradeProposal[]
  busy: {
    newGame: boolean
    simWeek: boolean
    advancePhase: boolean
    save: boolean
    draft: boolean
    trade: boolean
    fa: boolean
    simToNextEvent: boolean
    simSeason: boolean
  }
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
    /** Loads the 'default' save and enters the game (New Game screen's Continue affordance). */
    continueGame: () => Promise<void>
    /** Resets a HORIZON_EXPIRED outcome so the user can keep running the front office (End Game screen). */
    keepPlaying: () => void
    /** Cap in $M for any season (this or a future one), for Finances' "next season" tile. Null while data is loading. */
    capFor: (season: Season) => number | null

    // --- Draft Room ------------------------------------------------------------------------
    startDraft: () => Promise<void>
    makePick: (playerId: PlayerId) => Promise<void>
    autoPick: () => Promise<void>
    simToMyPick: () => Promise<void>
    finishDraft: () => Promise<void>
    /** Consensus-only positional need, for the board's need badges. Null when not built yet. */
    teamNeeds: (teamId: TeamId) => NeedProfile | null

    // --- Trade Center ------------------------------------------------------------------------
    /** Pure evaluation for the live acceptance bar; never mutates state, never toasts. */
    evaluateTrade: (proposal: TradeProposal) => TradeEvaluation
    proposeTrade: (proposal: TradeProposal) => Promise<void>
    /** Accept/decline an AI-initiated offer (draftRoom.pendingOffers or a fetched season offer). */
    respondToOffer: (proposal: TradeProposal, accept: boolean) => Promise<void>
    /** Fetches AI-initiated season trade offers into `tradeOffers`. */
    refreshTradeOffers: () => Promise<void>

    // --- Free Agency ------------------------------------------------------------------------
    offerContract: (playerId: PlayerId, contract: Contract) => Promise<void>
    resign: (playerId: PlayerId, contract: Contract) => Promise<void>
    release: (playerId: PlayerId) => Promise<void>
    signUdfa: (playerIds: PlayerId[]) => Promise<void>
    /** The expiring player's ask for the re-sign phase. Null when not built yet. */
    resignAsk: (playerId: PlayerId) => number | null
    /** This season's cap in $M, including the post-data growth rule; null while data is loading. */
    capThisSeason: () => number | null
    /** P(accept) before any offer is made, for the offer form's live acceptance odds. Null when not built yet. */
    offerOdds: (playerId: PlayerId, contract: Contract) => number | null

    // --- Schedule / season -------------------------------------------------------------------
    simToNextEvent: () => Promise<void>
    simSeason: () => Promise<void>

    // --- Standings ---------------------------------------------------------------------------
    /** Current standings with ranks and clinch flags. Empty array when not built yet. */
    standings: () => StandingRow[]
  }
}
