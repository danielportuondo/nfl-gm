/**
 * The assembled engine: every module the league loop dispatches through `ctx.modules` (contracts/engine).
 * Integration seam owned by the orchestrator; each module directory is owned by its agent (HANDOFF §7).
 * draft/trade/fa/lifecycle/history are Phase 2 scaffolds until fan-out #2 lands.
 */
import type { EngineModules } from '@contracts/index'
import { draft } from './draft'
import { fa } from './fa'
import { history } from './history'
import { league } from './league'
import { lifecycle } from './lifecycle'
import { rng } from './rng'
import { sim } from './sim'
import { trade } from './trade'

export const engineModules: EngineModules = {
  rng,
  league,
  sim,
  draft,
  trade,
  fa,
  lifecycle,
  history,
}

export { persistence } from './persistence'
