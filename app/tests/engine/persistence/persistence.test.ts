import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { toSaved, type LeagueState, type PlayerId, type Transaction } from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { persistence } from '@engine/persistence'

function withoutSavedAt(saved: ReturnType<typeof toSaved>) {
  return { ...saved, savedAt: undefined }
}

function withDraftOrigin(
  state: LeagueState,
  playerId: PlayerId,
  draft: { season: number; round: number; pick: number; team: string },
): LeagueState {
  const player = state.players[playerId]
  if (!player) throw new Error(`fixture: missing player ${playerId}`)
  return { ...state, players: { ...state.players, [playerId]: { ...player, draft } } }
}

describe('engine/persistence', () => {
  beforeEach(async () => {
    for (const meta of await persistence.listSaves()) await persistence.remove(meta.slot)
  })

  it('save -> list -> load round-trips to toSaved(state), ignoring savedAt', async () => {
    const state = mockLeague({ seed: 'persist-1' })
    const meta = await persistence.save('slot-a', state)
    expect(meta.slot).toBe('slot-a')
    expect(meta.userTeam).toBe(state.userTeam)

    const list = await persistence.listSaves()
    expect(list.map((m) => m.slot)).toContain('slot-a')

    const loaded = await persistence.load('slot-a')
    expect(withoutSavedAt(toSaved(loaded))).toEqual(withoutSavedAt(toSaved(state)))
  })

  it('remove deletes a slot', async () => {
    const state = mockLeague({ seed: 'persist-remove' })
    await persistence.save('slot-b', state)
    await persistence.remove('slot-b')
    const list = await persistence.listSaves()
    expect(list.map((m) => m.slot)).not.toContain('slot-b')
  })

  it('export -> import round-trips, ignoring the refreshed savedAt timestamp', () => {
    const state = mockLeague({ seed: 'persist-export' })
    const json = persistence.exportJson(state)
    const originalSaved = JSON.parse(json) as Record<string, unknown>
    const imported = persistence.importJson(json)
    expect(withoutSavedAt(toSaved(imported))).toEqual({ ...originalSaved, savedAt: undefined })
  })

  it('migrate is identity for the current schema version', () => {
    const state = mockLeague({ seed: 'persist-migrate' })
    const saved = toSaved(state)
    expect(persistence.migrate(saved)).toEqual(saved)
  })

  it('migrate throws a readable error on garbage input', () => {
    expect(() => persistence.migrate('not an object')).toThrow(/persistence\.migrate/)
    expect(() => persistence.migrate({ nope: true })).toThrow(/schemaVersion/)
    expect(() => persistence.migrate({ schemaVersion: 1, garbage: true })).toThrow(
      /persistence\.migrate/,
    )
  })

  it('load throws a readable error for a missing slot', async () => {
    await expect(persistence.load('does-not-exist')).rejects.toThrow(/no save in slot/)
  })

  describe('migrate: transactions backfill', () => {
    function buildStateWithDrafts(): LeagueState {
      let state = mockLeague({ seed: 'persist-backfill', season: 2015 })
      // The fixture assigns each player a random draft origin; clear it so only the origins this
      // test sets below are present, keeping the backfill assertions exact.
      state = {
        ...state,
        players: Object.fromEntries(
          Object.entries(state.players).map(([id, p]) => [id, { ...p, draft: null }]),
        ),
      }
      const userTeam = state.userTeam
      const otherTeam = Object.keys(state.teams).find((t) => t !== userTeam)!
      const userRoster = state.teams[userTeam]!.roster
      const otherRoster = state.teams[otherTeam]!.roster
      const laterPick = userRoster[0]!.playerId
      const earlierPick = userRoster[1]!.playerId
      const beforeStart = userRoster[2]!.playerId
      const otherTeamPlayer = otherRoster[0]!.playerId
      state = withDraftOrigin(state, laterPick, {
        season: 2016,
        round: 3,
        pick: 50,
        team: userTeam,
      })
      state = withDraftOrigin(state, earlierPick, {
        season: 2015,
        round: 1,
        pick: 10,
        team: userTeam,
      })
      state = withDraftOrigin(state, beforeStart, {
        season: 2014,
        round: 2,
        pick: 5,
        team: userTeam,
      })
      state = withDraftOrigin(state, otherTeamPlayer, {
        season: 2015,
        round: 1,
        pick: 1,
        team: otherTeam,
      })
      return state
    }

    it('backfills DRAFT entries for the user team from startSeason on, sorted by (season, pick)', () => {
      const state = buildStateWithDrafts()
      const raw = toSaved(state) as unknown as Record<string, unknown>
      delete raw.transactions
      expect(Object.prototype.hasOwnProperty.call(raw, 'transactions')).toBe(false)

      const migrated = persistence.migrate(raw)
      const draftEntries = migrated.transactions.filter(
        (t): t is Extract<Transaction, { kind: 'DRAFT' }> => t.kind === 'DRAFT',
      )
      const userRoster = state.teams[state.userTeam]!.roster
      expect(draftEntries.map((t) => t.playerId)).toEqual([
        userRoster[1]!.playerId, // 2015 pick 10
        userRoster[0]!.playerId, // 2016 pick 50
      ])
      expect(migrated.transactions).toEqual(draftEntries)
      for (const entry of draftEntries) {
        expect(entry.phase).toBe('DRAFT')
        expect(entry.week).toBe(0)
        expect(entry.ovrAtMove).toEqual({})
      }
      // A class drafts during the previous season's offseason (DRAFT phase of season class − 1).
      expect(draftEntries[0]).toMatchObject({ season: 2014, round: 1, pick: 10 })
      expect(draftEntries[1]).toMatchObject({ season: 2015, round: 3, pick: 50 })
    })

    it('leaves a save with an explicit transactions: [] untouched', () => {
      const state = buildStateWithDrafts()
      const raw = toSaved(state) as unknown as Record<string, unknown>
      raw.transactions = []
      const migrated = persistence.migrate(raw)
      expect(migrated.transactions).toEqual([])
    })

    it('round-trips existing transactions unchanged through export -> import', () => {
      let state = mockLeague({ seed: 'persist-txn-roundtrip' })
      const entry: Transaction = {
        kind: 'DRAFT',
        season: state.season,
        phase: 'DRAFT',
        week: 0,
        playerId: state.teams[state.userTeam]!.roster[0]!.playerId,
        round: 1,
        pick: 1,
        ovrAtMove: { [state.teams[state.userTeam]!.roster[0]!.playerId]: 72 },
      }
      state = { ...state, transactions: [entry] }
      const json = persistence.exportJson(state)
      const imported = persistence.importJson(json)
      expect(imported.transactions).toEqual([entry])
    })
  })
})
