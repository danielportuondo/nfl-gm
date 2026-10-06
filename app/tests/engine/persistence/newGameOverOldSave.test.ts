import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { persistence } from '@engine/persistence'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague } from '@fixtures/mockLeague'

const EPOCH = '1970-01-01T00:00:00.000Z'

async function until(pred: () => boolean | Promise<boolean>, ms = 3_000): Promise<void> {
  const start = Date.now()
  while (!(await pred())) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('starting a new game while an older save is in the default slot', () => {
  beforeEach(async () => {
    for (const meta of await persistence.listSaves()) await persistence.remove(meta.slot)
  })

  // engine/league.newGame stamps savedAt with the epoch (it must stay deterministic). The store
  // used that stamp as its "last known write", so any real older save looked like a newer one from
  // another tab and every autosave of the new game was refused.
  it('autosaves the new game over the older save', async () => {
    await persistence.save('default', mockLeague({ seed: 'older-2014-game', season: 2013 }))
    const older = (await persistence.listSaves()).find((m) => m.slot === 'default')!
    expect(older.savedAt > EPOCH).toBe(true)

    const fresh = { ...mockLeague({ seed: 'new-2017-game', season: 2016 }), savedAt: EPOCH }
    const store = createGameStore({
      mode: 'engine',
      persistence,
      modules: { league: { ...defaultEngineModules.league, newGame: () => fresh } },
    })

    await store.getState().actions.newGame({
      startSeason: 2017,
      userTeam: fresh.userTeam,
      horizonSeasons: 3,
      settings: fresh.settings,
    })

    await until(async () => {
      const meta = (await persistence.listSaves()).find((m) => m.slot === 'default')
      return meta?.savedAt !== older.savedAt
    })
    const stored = await persistence.load('default')
    expect(stored.seed).toBe('new-2017-game')
    expect(
      store
        .getState()
        .toasts.map((t) => t.text)
        .join('|'),
    ).not.toContain('another tab')
  })
})
