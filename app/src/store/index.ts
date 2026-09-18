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
  type EngineContext,
  type PlayerId,
  type Position,
  type Season,
  type SeasonData,
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

  return create<GameStoreState>()((set, get) => {
    function addToast(text: string, tone: ToastItem['tone'] = 'info') {
      set((s) => ({ toasts: [...s.toasts, { id: makeToastId(), text, tone }] }))
    }

    function reportNotBuilt(fallback: string, err: unknown) {
      if (err instanceof NotImplementedError) addToast('Not built yet', 'warn')
      else addToast(err instanceof Error && err.message ? `${fallback} ${err.message}` : fallback, 'error')
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
        .then((data) => set({ data, dataStatus: 'ready', dataError: null }))
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
      busy: { newGame: false, simWeek: false, advancePhase: false, save: false },
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
            for (const event of report.events) addToast(event, 'info')
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
