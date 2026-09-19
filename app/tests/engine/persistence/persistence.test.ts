import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { toSaved } from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { persistence } from '@engine/persistence'

function withoutSavedAt(saved: ReturnType<typeof toSaved>) {
  return { ...saved, savedAt: undefined }
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
})
