/**
 * Zustand bridge between the UI and the engine (docs/HANDOFF.md §6.11). Works in two modes:
 *  - "mock": `newGame` builds a LeagueState directly from `mockLeague`/`mockStatic` so screens have
 *    real-shaped data before the engine exists.
 *  - "engine": `newGame`/`simWeek`/`advancePhase`/`save` go through `EngineModules`/`PersistenceModule`.
 *    Static data loads from the `DataSource` at creation; season chunks and trajectories load on demand
 *    (new game, and ahead of each phase change) and stay in this closure, never in the store state.
 *    Modules still under construction throw NotImplementedError — callers see a "Not built yet" toast.
 * Screens read ratings only from `state.scouting`; nothing here ever touches `state.truth`.
 */
import { create } from 'zustand'
import {
  NotImplementedError,
  SeasonNotLoadedError,
  type Contract,
  type EngineContext,
  type LeagueState,
  type NeedProfile,
  type PlayerId,
  type Position,
  type Season,
  type SeasonData,
  type StandingRow,
  type TeamId,
  type TradeEvaluation,
  type TradeProposal,
  type TrajectoryTable,
} from '@contracts/index'
import { HttpDataSource } from '@data/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { applyTheme, loadTheme, persistTheme, type Theme } from '../ui/frame'
import type { ToastItem } from '../ui/primitives'
import { defaultEngineModules, defaultPersistence } from './engineDefaults'
import { buildHash, currentRoute, type ScreenId } from './router'
import type { GameStoreState, NewGameInput, StoreConfig } from './types'

export type { GameStoreState, NewGameInput, StoreConfig, Mode, DataStatus } from './types'
export type { ScreenId } from './router'

/** newGame needs the start season plus the next two draft classes (contracts/engine/draft.ts convention). */
const DRAFTS_AHEAD = 2

function makeToastId(): string {
  return `toast-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function makeSeed(startSeason: number, userTeam: string): string {
  return `${startSeason}-${userTeam}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Docs/HANDOFF.md Phase 3E follow-up: WeekReport events are free-text, so this is a best-effort
 * heuristic (team id or a user-roster player's name appears in the text) — good enough to keep the
 * toast stream to "your team" while everything still lands in `alerts` for the Dashboard's log.
 */
function eventMentionsUser(event: string, state: LeagueState): boolean {
  if (event.includes(state.userTeam)) return true
  const team = state.teams[state.userTeam]
  if (!team) return false
  return team.roster.some((slot) => {
    const name = state.players[slot.playerId]?.name
    return name ? event.includes(name) : false
  })
}

/** Creates an isolated store instance (the app uses the `useGameStore` singleton below; tests may want their own). */
export function createGameStore(config: StoreConfig = {}) {
  const mode = config.mode ?? 'mock'
  const modules = { ...defaultEngineModules, ...config.modules }
  const persistence = config.persistence ?? defaultPersistence
  const dataSource = mode === 'engine' ? config.dataSource : undefined
  let trajectories: TrajectoryTable = config.ctx?.trajectories ?? {}
  let trajectoriesLoaded = config.ctx?.trajectories !== undefined || !dataSource
  const chunks = new Map<Season, SeasonData>()

  const initialTheme = loadTheme()
  if (typeof document !== 'undefined') applyTheme(initialTheme)
  const initialRoute = currentRoute()

  return create<GameStoreState>()((set, get, api) => {
    function addToast(text: string, tone: ToastItem['tone'] = 'info') {
      set((s) => ({ toasts: [...s.toasts, { id: makeToastId(), text, tone }] }))
    }

    function reportNotBuilt(fallback: string, err: unknown) {
      if (err instanceof NotImplementedError) addToast('Not built yet', 'warn')
      else addToast(err instanceof Error && err.message ? `${fallback} ${err.message}` : fallback, 'error')
    }

    /** Toasts events touching the user's team; everything else goes to `alerts` (Phase 3E follow-up). */
    function routeEvents(events: string[], resultState: LeagueState) {
      const toastEvents: string[] = []
      const otherEvents: string[] = []
      for (const e of events) (eventMentionsUser(e, resultState) ? toastEvents : otherEvents).push(e)
      if (otherEvents.length > 0) set((s) => ({ alerts: [...s.alerts, ...otherEvents] }))
      for (const e of toastEvents) addToast(e, 'info')
    }

    const seasonData: EngineContext['seasonData'] =
      config.ctx?.seasonData ??
      ((season) => {
        const chunk = chunks.get(season)
        if (chunk) return chunk
        const latest = get().data?.manifest.latestRealSeason
        if (latest !== undefined && season > latest) return undefined
        throw new SeasonNotLoadedError(season)
      })

    function buildCtx(): EngineContext {
      const data = get().data
      if (!data) throw new Error('League data is still loading.')
      return { data, trajectories, seasonData, modules }
    }

    /** §6.9: autosave at every phase transition and every 4 weeks. Fire-and-forget; a failure only toasts. */
    function autosave(league: LeagueState): void {
      if (mode === 'mock') return
      persistence.save('default', league).catch((err: unknown) => {
        addToast(`Autosave failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    }

    // Roster moves between transitions (cuts, signings, picks) would otherwise be lost to a reload;
    // a short debounce keeps a burst of cuts to one write.
    let autosaveTimer: ReturnType<typeof setTimeout> | undefined
    api.subscribe((next, prev) => {
      if (mode === 'mock' || !next.state || next.state === prev.state) return
      if (autosaveTimer !== undefined) clearTimeout(autosaveTimer)
      autosaveTimer = setTimeout(() => autosave(next.state!), 1000)
    })

    /** Pick the last game back up after a reload; a missing slot just leaves the new-game screen up. */
    async function restoreSave(): Promise<void> {
      if (mode === 'mock' || get().state) return
      let league: LeagueState
      try {
        league = await persistence.load('default')
      } catch {
        return
      }
      try {
        await ensureLoaded(league.season, league.season + 1 + DRAFTS_AHEAD)
        if (get().state) return
        set({ state: league })
        if (get().screen === 'new-game') get().actions.goTo('dashboard')
      } catch (err) {
        reportNotBuilt('Could not restore the saved game.', err)
      }
    }

    /** Loads trajectories once and every in-history chunk in [from, to] that is not cached yet. */
    async function ensureLoaded(from: Season, to: Season): Promise<void> {
      if (!dataSource) return
      const latest = get().data?.manifest.latestRealSeason ?? to
      const wanted: Season[] = []
      for (let s = from; s <= Math.min(to, latest); s++) if (!chunks.has(s)) wanted.push(s)
      const loads: Promise<void>[] = wanted.map((s) => dataSource.loadSeason(s).then((chunk) => void chunks.set(s, chunk)))
      if (!trajectoriesLoaded) {
        loads.push(
          dataSource.loadTrajectories().then((table) => {
            trajectories = table
            trajectoriesLoaded = true
          }),
        )
      }
      await Promise.all(loads)
    }

    if (dataSource) {
      dataSource
        .loadStatic()
        .then((data) => {
          set({ data, dataStatus: 'ready', dataError: null })
          return restoreSave()
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          set({ dataStatus: 'error', dataError: message })
          addToast(`Could not load league data: ${message}`, 'error')
        })
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        const route = currentRoute()
        set({ screen: route.screen, selectedPlayerId: route.playerId })
      })
    }

    return {
      mode,
      state: null,
      data: dataSource ? null : mockStatic(),
      dataStatus: dataSource ? 'loading' : 'ready',
      dataError: null,
      screen: initialRoute.screen,
      selectedPlayerId: initialRoute.playerId,
      theme: initialTheme,
      toasts: [],
      alerts: [],
      tradeOffers: [],
      busy: {
        newGame: false,
        simWeek: false,
        advancePhase: false,
        save: false,
        draft: false,
        trade: false,
        fa: false,
        simToNextEvent: false,
        simSeason: false,
      },
      actions: {
        async newGame(opts: NewGameInput) {
          if (mode === 'mock') {
            const league = mockLeague({
              seed: makeSeed(opts.startSeason, opts.userTeam),
              season: opts.startSeason,
              userTeam: opts.userTeam,
              horizonSeasons: opts.horizonSeasons,
              settings: opts.settings,
            })
            set({ state: league })
            get().actions.goTo('dashboard')
            return
          }
          set((s) => ({ busy: { ...s.busy, newGame: true } }))
          try {
            await ensureLoaded(opts.startSeason, opts.startSeason + DRAFTS_AHEAD)
            const ctx = buildCtx()
            const league = modules.league.newGame(
              { seed: makeSeed(opts.startSeason, opts.userTeam), startSeason: opts.startSeason, userTeam: opts.userTeam, horizonSeasons: opts.horizonSeasons, settings: opts.settings },
              ctx,
            )
            set({ state: league })
            autosave(league)
            get().actions.goTo('dashboard')
          } catch (err) {
            reportNotBuilt('Could not start a new game.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, newGame: false } }))
          }
        },

        goTo(screen: ScreenId, playerId: PlayerId | null = null) {
          if (typeof window !== 'undefined') window.location.hash = buildHash(screen, playerId)
          set({ screen, selectedPlayerId: playerId })
        },

        selectPlayer(id: PlayerId | null) {
          if (id) get().actions.goTo('player', id)
          else set({ selectedPlayerId: null })
        },

        setTheme(theme: Theme) {
          applyTheme(theme)
          persistTheme(theme)
          set({ theme })
        },

        async simWeek() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, simWeek: true } }))
          try {
            const ctx = buildCtx()
            const report = modules.league.simWeek(league, ctx)
            set({ state: report.state })
            routeEvents(report.events, report.state)
            if (report.state.phase !== league.phase || report.state.week % 4 === 0) autosave(report.state)
          } catch (err) {
            reportNotBuilt('Could not sim the week.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, simWeek: false } }))
          }
        },

        async advancePhase() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, advancePhase: true } }))
          try {
            // The rollover needs next season's chunk (schedule, rosters) and the drafts after it.
            await ensureLoaded(league.season + 1, league.season + 1 + DRAFTS_AHEAD)
            const ctx = buildCtx()
            const next = modules.league.advancePhase(league, ctx)
            set({ state: next })
            autosave(next)
          } catch (err) {
            reportNotBuilt('Could not advance the phase.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, advancePhase: false } }))
          }
        },

        async save() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, save: true } }))
          try {
            await persistence.save('default', league)
            addToast('Saved', 'success')
          } catch (err) {
            reportNotBuilt('Could not save.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, save: false } }))
          }
        },

        setDepthChart(pos: Position, order: PlayerId[]) {
          const league = get().state
          if (!league) return
          const team = league.teams[league.userTeam]
          if (!team) return
          set({
            state: {
              ...league,
              teams: {
                ...league.teams,
                [league.userTeam]: { ...team, depthChart: { ...team.depthChart, [pos]: order } },
              },
            },
          })
        },

        dismissToast(id: string) {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        },

        // --- Draft Room --------------------------------------------------------------------------
        async startDraft() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, draft: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.draft.startDraft(league, ctx)
            set({ state: next })
          } catch (err) {
            reportNotBuilt('Could not start the draft.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, draft: false } }))
          }
        },

        async makePick(playerId: PlayerId) {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, draft: true } }))
          try {
            const ctx = buildCtx()
            const picked = modules.draft.userPick(league, playerId, ctx)
            const next = modules.draft.advance(picked, ctx)
            set({ state: next })
          } catch (err) {
            reportNotBuilt('Could not make the pick.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, draft: false } }))
          }
        },

        async autoPick() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, draft: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.draft.advance(league, ctx, { auto: true })
            set({ state: next })
          } catch (err) {
            reportNotBuilt('Could not auto-pick.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, draft: false } }))
          }
        },

        async simToMyPick() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, draft: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.draft.advance(league, ctx)
            set({ state: next })
          } catch (err) {
            reportNotBuilt('Could not sim to your pick.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, draft: false } }))
          }
        },

        async finishDraft() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, draft: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.draft.autoDraftToEnd(league, ctx)
            set({ state: next })
          } catch (err) {
            reportNotBuilt('Could not finish the draft.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, draft: false } }))
          }
        },

        teamNeeds(teamId: TeamId): NeedProfile | null {
          const league = get().state
          if (!league) return null
          try {
            return modules.draft.teamNeeds(league, teamId)
          } catch {
            return null
          }
        },

        // --- Trade Center --------------------------------------------------------------------------
        evaluateTrade(proposal: TradeProposal): TradeEvaluation {
          const fallback: TradeEvaluation = { valueIn: 0, valueOut: 0, needAdj: 0, margin: 0, p: 0, valid: false, reasons: [] }
          const league = get().state
          if (!league) return fallback
          try {
            const ctx = buildCtx()
            return modules.trade.evaluate(league, proposal, ctx)
          } catch (err) {
            const reason = err instanceof NotImplementedError ? 'Not built yet' : err instanceof Error ? err.message : 'Could not evaluate.'
            return { ...fallback, reasons: [reason] }
          }
        },

        async proposeTrade(proposal: TradeProposal) {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, trade: true } }))
          try {
            const ctx = buildCtx()
            const rng = modules.rng.fromSeed(league.seed, league.season, league.week, 'userTrade', proposal.id)
            const outcome = modules.trade.submit(league, proposal, ctx, rng)
            set({ state: outcome.state })
            addToast(outcome.accepted ? 'Trade accepted' : 'They passed on that trade', outcome.accepted ? 'success' : 'warn')
          } catch (err) {
            reportNotBuilt('Could not offer the trade.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, trade: false } }))
          }
        },

        async respondToOffer(proposal: TradeProposal, accept: boolean) {
          const league = get().state
          if (!league) return
          if (!accept) {
            set((s) => ({
              state:
                s.state && s.state.draftRoom
                  ? { ...s.state, draftRoom: { ...s.state.draftRoom, pendingOffers: s.state.draftRoom.pendingOffers.filter((o) => o.id !== proposal.id) } }
                  : s.state,
              tradeOffers: s.tradeOffers.filter((o) => o.id !== proposal.id),
            }))
            addToast('Declined', 'info')
            return
          }
          set((s) => ({ busy: { ...s.busy, trade: true } }))
          try {
            const ctx = buildCtx()
            const rng = modules.rng.fromSeed(league.seed, league.season, league.week, 'userTrade', proposal.id)
            const outcome = modules.trade.submit(league, proposal, ctx, rng)
            const resultState = outcome.state.draftRoom
              ? { ...outcome.state, draftRoom: { ...outcome.state.draftRoom, pendingOffers: outcome.state.draftRoom.pendingOffers.filter((o) => o.id !== proposal.id) } }
              : outcome.state
            set((s) => ({ state: resultState, tradeOffers: s.tradeOffers.filter((o) => o.id !== proposal.id) }))
            addToast(outcome.accepted ? 'Trade accepted' : 'Trade fell through', outcome.accepted ? 'success' : 'warn')
          } catch (err) {
            reportNotBuilt('Could not respond to the offer.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, trade: false } }))
          }
        },

        async refreshTradeOffers() {
          const league = get().state
          if (!league) return
          try {
            const ctx = buildCtx()
            const rng = modules.rng.fromSeed(league.seed, league.season, league.week, 'aiOffers')
            const offers = modules.trade.generateAiOffers(league, ctx, rng, 'season')
            set({ tradeOffers: offers })
          } catch (err) {
            reportNotBuilt('Could not check for offers.', err)
          }
        },

        // --- Free Agency ---------------------------------------------------------------------------
        async offerContract(playerId: PlayerId, contract: Contract) {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, fa: true } }))
          try {
            const ctx = buildCtx()
            const rng = modules.rng.fromSeed(league.seed, league.season, league.week, 'userFaOffer', playerId)
            const result = modules.fa.offer(league, league.userTeam, playerId, contract, ctx, rng)
            set({ state: result.state })
            addToast(result.accepted ? 'Signed' : 'The player passed on the offer', result.accepted ? 'success' : 'warn')
          } catch (err) {
            reportNotBuilt('Could not make the offer.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, fa: false } }))
          }
        },

        async resign(playerId: PlayerId, contract: Contract) {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, fa: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.fa.resign(league, playerId, contract, ctx)
            set({ state: next })
            addToast('Re-signed', 'success')
          } catch (err) {
            reportNotBuilt('Could not re-sign.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, fa: false } }))
          }
        },

        async release(playerId: PlayerId) {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, fa: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.fa.release(league, league.userTeam, playerId, ctx)
            set({ state: next })
            addToast('Released', 'info')
          } catch (err) {
            reportNotBuilt('Could not release the player.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, fa: false } }))
          }
        },

        async signUdfa(playerIds: PlayerId[]) {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, fa: true } }))
          try {
            const ctx = buildCtx()
            const next = modules.draft.runUdfa(league, ctx, playerIds)
            set({ state: next })
            addToast(playerIds.length > 0 ? 'UDFA signings complete' : 'No UDFA signings made', 'success')
          } catch (err) {
            reportNotBuilt('Could not sign UDFA players.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, fa: false } }))
          }
        },

        capThisSeason(): number | null {
          const league = get().state
          if (!league) return null
          try {
            return modules.fa.capFor(league.season, buildCtx())
          } catch {
            return null
          }
        },

        resignAsk(playerId: PlayerId): number | null {
          const league = get().state
          if (!league) return null
          try {
            const ctx = buildCtx()
            return modules.fa.resignAsk(league, playerId, ctx)
          } catch {
            return null
          }
        },

        // --- Schedule / season loop ------------------------------------------------------------------
        async simToNextEvent() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, simToNextEvent: true } }))
          try {
            let current = league
            const startPhase = current.phase
            const MAX_WEEKS = 30
            for (let i = 0; i < MAX_WEEKS; i++) {
              if (current.phase !== 'REGULAR' && current.phase !== 'PLAYOFFS') break
              const ctx = buildCtx()
              const report = modules.league.simWeek(current, ctx)
              current = report.state
              routeEvents(report.events, current)
              set({ state: current })
              if (current.phase !== startPhase) break
              if (report.events.some((e) => eventMentionsUser(e, current))) break
            }
            if (current !== league) autosave(current)
          } catch (err) {
            reportNotBuilt('Could not sim to the next event.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, simToNextEvent: false } }))
          }
        },

        async simSeason() {
          const league = get().state
          if (!league) return
          set((s) => ({ busy: { ...s.busy, simSeason: true } }))
          try {
            let current = league
            const MAX_WEEKS = 40
            for (let i = 0; i < MAX_WEEKS; i++) {
              if (current.phase !== 'REGULAR' && current.phase !== 'PLAYOFFS') break
              const ctx = buildCtx()
              const report = modules.league.simWeek(current, ctx)
              current = report.state
              routeEvents(report.events, current)
              set({ state: current })
            }
            if (current !== league) autosave(current)
          } catch (err) {
            reportNotBuilt('Could not sim the season.', err)
          } finally {
            set((s) => ({ busy: { ...s.busy, simSeason: false } }))
          }
        },

        // --- Standings -----------------------------------------------------------------------------
        standings(): StandingRow[] {
          const league = get().state
          if (!league) return []
          try {
            const ctx = buildCtx()
            return modules.league.standings(league, ctx)
          } catch {
            return []
          }
        },
      },
    }
  })
}

/**
 * The app's singleton store: the real engine over app/public/data in the browser. Under Node (tests) it
 * stays in mock mode so importing it never fetches. Tests that need isolation call `createGameStore`.
 */
export const useGameStore = createGameStore(
  typeof window === 'undefined' ? {} : { mode: 'engine', dataSource: HttpDataSource(`${import.meta.env.BASE_URL}data`) },
)
