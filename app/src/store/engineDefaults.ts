import type { EngineModules, PersistenceModule } from '@contracts/index'
import { engineModules, persistence } from '@engine/index'

/** The real engine (Phase 2 scaffolds stand in for the fan-out #2 modules until they land). */
export const defaultEngineModules: EngineModules = engineModules

export const defaultPersistence: PersistenceModule = persistence
