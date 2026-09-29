/**
 * engine/persistence — save/load via IndexedDB (`idb`), export/import, schema migration.
 * Implements PersistenceModule (contracts/engine/persistence.ts).
 */
import { openDB, type IDBPDatabase } from 'idb'
import {
  SavedLeagueSchema,
  fromSaved,
  toSaved,
  type LeagueState,
  type SavedLeague,
  type Transaction,
} from '@contracts/index'
import type { PersistenceModule, SaveSlotMeta } from '@contracts/index'
import { DB_NAME, DB_VERSION, SAVES_STORE } from './constants'

export const SCHEMA_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(SAVES_STORE)) database.createObjectStore(SAVES_STORE)
    },
  })
  return dbPromise
}

function toMeta(slot: string, saved: SavedLeague): SaveSlotMeta {
  return {
    slot,
    userTeam: saved.userTeam,
    season: saved.season,
    week: saved.week,
    phase: saved.phase,
    startSeason: saved.startSeason,
    horizonEnd: saved.horizonEnd,
    savedAt: saved.savedAt,
    schemaVersion: saved.schemaVersion,
  }
}

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

/**
 * Reconstructs the user's DRAFT moves for a save made before the transaction log existed. Only
 * DRAFT entries are recoverable (the pick is recorded on the player); trades, signings, re-signings
 * and releases from before the log leave no trace in `players[id]`, so they can't be backfilled.
 */
function backfillDraftTransactions(saved: SavedLeague): Transaction[] {
  type DraftEntry = Extract<Transaction, { kind: 'DRAFT' }>
  const entries: DraftEntry[] = []
  for (const playerId of Object.keys(saved.players).sort()) {
    const draft = saved.players[playerId]?.draft
    if (!draft || draft.team !== saved.userTeam || draft.season < saved.startSeason) continue
    entries.push({
      kind: 'DRAFT',
      // A class is drafted in the DRAFT phase of the season before it (seasonText's convention).
      season: draft.season - 1,
      phase: 'DRAFT',
      week: 0,
      playerId,
      round: draft.round,
      pick: draft.pick,
      ovrAtMove: {},
    })
  }
  return entries.sort((a, b) => a.season - b.season || a.pick - b.pick)
}

/**
 * Bring any older SavedLeague up to SCHEMA_VERSION. Identity for the current version, except that a
 * save from before the transaction log (no `transactions` key at all — not even `[]`) gets its DRAFT
 * moves backfilled; see `backfillDraftTransactions`.
 */
export function migrate(saved: unknown): SavedLeague {
  if (typeof saved !== 'object' || saved === null) {
    throw new Error('persistence.migrate: save data is not an object')
  }
  const version = (saved as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'number') {
    throw new Error('persistence.migrate: save data is missing a numeric schemaVersion')
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `persistence.migrate: save schemaVersion ${version} is newer than supported ${SCHEMA_VERSION}`,
    )
  }
  // No migrations exist yet; `version === SCHEMA_VERSION` is the only supported case and is the identity.
  const hadTransactionsKey = Object.prototype.hasOwnProperty.call(saved, 'transactions')
  const parsed = SavedLeagueSchema.safeParse(saved)
  if (!parsed.success) {
    throw new Error(
      `persistence.migrate: invalid save data — ${describeIssues(parsed.error.issues)}`,
    )
  }
  if (hadTransactionsKey) return parsed.data
  return { ...parsed.data, transactions: backfillDraftTransactions(parsed.data) }
}

export const persistence: PersistenceModule = {
  SCHEMA_VERSION,

  async listSaves() {
    const database = await db()
    const keys = (await database.getAllKeys(SAVES_STORE)) as string[]
    const metas: SaveSlotMeta[] = []
    for (const slot of [...keys].sort()) {
      const raw = (await database.get(SAVES_STORE, slot)) as SavedLeague | undefined
      if (raw) metas.push(toMeta(slot, raw))
    }
    return metas
  },

  async save(slot, state) {
    const saved = toSaved(state)
    const database = await db()
    await database.put(SAVES_STORE, saved, slot)
    return toMeta(slot, saved)
  },

  async load(slot) {
    const database = await db()
    const raw = await database.get(SAVES_STORE, slot)
    if (raw === undefined) throw new Error(`persistence.load: no save in slot "${slot}"`)
    return fromSaved(migrate(raw))
  },

  async remove(slot) {
    const database = await db()
    await database.delete(SAVES_STORE, slot)
  },

  exportJson(state: LeagueState): string {
    return JSON.stringify(toSaved(state))
  },

  importJson(json: string): LeagueState {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch (err) {
      throw new Error(`persistence.importJson: invalid JSON — ${(err as Error).message}`, {
        cause: err,
      })
    }
    return fromSaved(migrate(parsed))
  },

  migrate,
}
