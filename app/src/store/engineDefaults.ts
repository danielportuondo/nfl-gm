import {
  draftStub,
  faStub,
  historyStub,
  leagueStub,
  lifecycleStub,
  persistenceStub,
  rngStub,
  simStub,
  tradeStub,
  type EngineModules,
  type PersistenceModule,
} from '@contracts/index'

/** Every engine module defaults to its NotImplementedError stub until the real modules land. */
export const defaultEngineModules: EngineModules = {
  rng: rngStub,
  league: leagueStub,
  sim: simStub,
  draft: draftStub,
  trade: tradeStub,
  fa: faStub,
  lifecycle: lifecycleStub,
  history: historyStub,
}

export const defaultPersistence: PersistenceModule = persistenceStub
