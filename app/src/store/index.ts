/**
 * Zustand bridge between the UI and the engine (docs/HANDOFF.md §6.11). Works in two modes:
 *  - "mock": `newGame` builds a LeagueState directly from `mockLeague`/`mockStatic` so screens have
 *    real-shaped data before the engine exists.
 *  - "engine": `newGame`/`simWeek`/`advancePhase`/`save` go through `EngineModules`/`PersistenceModule`,
 *    which default to their NotImplementedError stubs — callers see a "Not built yet" toast, never a crash.
 * Screens read ratings only from `state.scouting`; nothing here ever touches `state.truth`.
 */
import { create } from 'zustand'
import {
  NotImplementedError,
  SeasonNotLoadedError,
  type EngineContext,
  type PlayerId,
  type Position,
  type TrajectoryTable,
} from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { applyTheme, loadTheme, persistTheme, type Theme } from '../ui/frame'
import type { ToastItem } from '../ui/primitives'
import { defaultEngineModules, defaultPersistence } from './engineDefaults'
import { buildHash, currentRoute, type ScreenId } from './router'
import type { GameStoreState, NewGameInput, StoreConfig } from './types'

export type { GameStoreState, NewGameInput, StoreConfig, Mode } from './types'
export type { ScreenId } from './router'

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
  const trajectories: TrajectoryTable = config.ctx?.trajectories ?? {}
  const seasonData: EngineContext['seasonData'] =
    config.ctx?.seasonData ?? ((season) => { throw new SeasonNotLoadedError(season) })

  const initialTheme = loadTheme()
  if (typeof document !== 'undefined') applyTheme(initialTheme)
  const initialRoute = currentRoute()

  return create<GameStoreState>()((set, get) => {
    function addToast(text: string, tone: ToastItem['tone'] = 'info') {
      set((s) => ({ toasts: [...s.toasts, { id: makeToastId(), text, tone }] }))
    }

    function reportNotBuilt(fallback: string, err: unknown) {
      if (err instanceof NotImplementedError) addToast('Not built yet', 'warn')
      else addToast(fallback, 'error')
    }

    function buildCtx(): EngineContext {
      const data = get().data
      if (!data) throw new Error('static data not loaded')
      return { data, trajectories, seasonData, modules }
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
      data: mockStatic(),
      screen: initialRoute.screen,
      selectedPlayerId: initialRoute.playerId,
      theme: initialTheme,
      toasts: [],
      busy: { simWeek: false, advancePhase: false, save: false },
      actions: {
        newGame(opts: NewGameInput) {
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
          try {
            const ctx = buildCtx()
            const league = modules.league.newGame(
              { seed: makeSeed(opts.startSeason, opts.userTeam), startSeason: opts.startSeason, userTeam: opts.userTeam, horizonSeasons: opts.horizonSeasons, settings: opts.settings },
              ctx,
            )
            set({ state: league })
            get().actions.goTo('dashboard')
          } catch (err) {
            reportNotBuilt('Could not start a new game.', err)
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

/** The app's singleton store. Tests that need isolation should call `createGameStore` directly. */
export const useGameStore = createGameStore()
