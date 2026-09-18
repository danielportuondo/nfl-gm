/**
 * engine/persistence — save/load, migrations, export/import (§6.9). Owned by league-engine (1C).
 *
 * IndexedDB via `idb`. Save = SavedLeague (LeagueState with divergence as array). Autosave at every
 * phase transition and every 4 weeks (the store calls `save`). Multiple slots. Schema version + migrations.
 */
import type { LeagueState, SavedLeague } from '../types'
import { notImplemented } from './context'

export interface SaveSlotMeta {
  slot: string
  userTeam: string
  season: number
  week: number
  phase: string
  startSeason: number
  horizonEnd: number
  savedAt: string
  schemaVersion: number
}

export interface PersistenceModule {
  readonly SCHEMA_VERSION: number
  listSaves(): Promise<SaveSlotMeta[]>
  save(slot: string, state: LeagueState): Promise<SaveSlotMeta>
  load(slot: string): Promise<LeagueState>
  remove(slot: string): Promise<void>
  /** JSON string of SavedLeague, validated against SavedLeagueSchema. */
  exportJson(state: LeagueState): string
  /** Parse, migrate, validate, hydrate. Throws with a readable message on a bad file. */
  importJson(json: string): LeagueState
  /** Bring any older SavedLeague up to SCHEMA_VERSION. Identity for current version. */
  migrate(saved: unknown): SavedLeague
}

export const persistenceStub: PersistenceModule = {
  SCHEMA_VERSION: 1,
  listSaves: () => notImplemented('persistence.listSaves'),
  save: () => notImplemented('persistence.save'),
  load: () => notImplemented('persistence.load'),
  remove: () => notImplemented('persistence.remove'),
  exportJson: () => notImplemented('persistence.exportJson'),
  importJson: () => notImplemented('persistence.importJson'),
  migrate: () => notImplemented('persistence.migrate'),
}
