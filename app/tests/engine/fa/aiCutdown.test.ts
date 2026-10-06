/**
 * AI roster cutdown on real data (QA playthrough: NE cut its better QB for $11M of dead money, GB
 * carried two punters and five DL, early-round rookies ended up on no roster). A 2017 start drives the
 * real draft, history snap and free agency to the preseason, then the real AI cutdown runs.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  TEAM_IDS,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type RosterSlot,
  type TeamId,
} from '@contracts/index'
import { fa } from '@engine/fa'
import { faConstants } from '@engine/fa/constants'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { emptyLog, userCutdowns, userDraft, userFreeAgency } from '../../../scripts/lib/scriptedGm'

const START = 2017
const USER: TeamId = 'MIA'

const ovr = (s: LeagueState, id: PlayerId): number => s.scouting[id]?.ovr ?? 0
const aiTeams = (s: LeagueState): TeamId[] => TEAM_IDS.filter((t) => t !== s.userTeam)
const rosterOf = (s: LeagueState, t: TeamId): RosterSlot[] => s.teams[t]!.roster

/** Round 1-3 rookies of the current class are exempt from cuts, so they may out-stay a better vet. */
const isProtectedRookie = (s: LeagueState, id: PlayerId): boolean => {
  const p = s.players[id]!
  return !!p.draft && p.draft.round <= 3 && p.rookieSeason === s.season
}

function countsByPos(s: LeagueState, t: TeamId): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of rosterOf(s, t)) {
    const pos = s.players[slot.playerId]!.pos
    counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

function playToPreseason(ctx: EngineContext): LeagueState {
  const { league, draft } = ctx.modules
  const log = emptyLog()
  let s = league.newGame(
    {
      seed: 'ai-cutdown',
      startSeason: START,
      userTeam: USER,
      horizonSeasons: 2,
      settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
    },
    ctx,
  )
  s = draft.startDraft(s, ctx)
  s = userDraft(s, ctx, log)
  s = league.advancePhase(s, ctx) // DRAFT -> UDFA
  s = league.advancePhase(s, ctx) // UDFA -> FREE_AGENCY
  s = userFreeAgency(s, ctx, log)
  s = league.advancePhase(s, ctx) // FREE_AGENCY -> TRAINING_CAMP
  s = league.advancePhase(s, ctx) // TRAINING_CAMP -> PRESEASON (history snap)
  return userCutdowns(s, ctx, log)
}

describe('AI cutdown on real 2017 data', () => {
  let ctx: EngineContext
  let pre: LeagueState
  let post: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    pre = playToPreseason(ctx)
    post = ctx.modules.league.advancePhase(pre, ctx) // PRESEASON -> REGULAR: fill + AI cutdowns
  }, 120000)

  it('every AI team keeps its position minimums and exactly one K and one P', () => {
    const problems: string[] = []
    for (const t of aiTeams(post)) {
      const c = countsByPos(post, t)
      for (const [pos, min] of Object.entries(faConstants.positionMinimums))
        if ((c[pos] ?? 0) < min) problems.push(`${t} ${pos} ${c[pos] ?? 0} < ${min}`)
      if ((c.K ?? 0) !== 1) problems.push(`${t} K=${c.K ?? 0}`)
      if ((c.P ?? 0) !== 1) problems.push(`${t} P=${c.P ?? 0}`)
      expect(rosterOf(post, t).length).toBeLessThanOrEqual(53)
      if ((c.QB ?? 0) < 2) problems.push(`${t} QB=${c.QB ?? 0}`)
      if ((c.OL ?? 0) < 7 || (c.DL ?? 0) < 6 || (c.LB ?? 0) < 4 || (c.CB ?? 0) + (c.S ?? 0) < 7)
        problems.push(`${t} thin front seven / secondary`)
    }
    expect(problems).toEqual([])
  })

  it('no round 1-3 rookie of the current class is left on no roster', () => {
    const onRoster = new Set(TEAM_IDS.flatMap((t) => rosterOf(post, t).map((r) => r.playerId)))
    const stranded = Object.values(post.players)
      .filter((p) => p.draft && p.draft.season === START && p.draft.round <= 3)
      .filter((p) => !onRoster.has(p.id) && p.draft!.team !== USER)
      .map((p) => `${p.name} R${p.draft!.round}`)
    expect(stranded).toEqual([])
  })

  it('no AI team cuts a better player while keeping a worse one at the same position for no extra cap', () => {
    const violations: string[] = []
    for (const t of aiTeams(post)) {
      const kept = rosterOf(post, t)
      const keptIds = new Set(kept.map((r) => r.playerId))
      const cut = rosterOf(pre, t).filter((r) => !keptIds.has(r.playerId))
      for (const c of cut) {
        const pos = post.players[c.playerId]!.pos
        for (const k of kept) {
          if (post.players[k.playerId]!.pos !== pos) continue
          if (isProtectedRookie(post, k.playerId)) continue
          const keepingBetterCostsNoMore = c.contract.apy <= k.contract.apy
          if (ovr(post, k.playerId) < ovr(post, c.playerId) && keepingBetterCostsNoMore)
            violations.push(
              `${t} cut ${post.players[c.playerId]!.name} kept ${post.players[k.playerId]!.name}`,
            )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('a traded-in QB better than the starter survives a cap crunch (NE-style)', () => {
    const team: TeamId = 'NE'
    const cap = fa.capFor(pre.season, ctx)
    const qbs = rosterOf(pre, team).filter((r) => pre.players[r.playerId]!.pos === 'QB')
    const sortedQbs = [...qbs].sort((a, b) => ovr(pre, b.playerId) - ovr(pre, a.playerId))
    const starter = sortedQbs[0]!
    const arrival = sortedQbs[1]!
    expect(arrival).toBeDefined()
    // The traded-in QB: better than the starter, a long guaranteed deal, not on the real roster.
    const better = { ...pre.scouting[arrival.playerId]!, ovr: ovr(pre, starter.playerId) + 2 }
    const bigDeal = { ...arrival.contract, apy: 19.25, years: 4, guaranteedPct: 0.5, rookie: false }
    const squeezed: LeagueState = {
      ...pre,
      scouting: { ...pre.scouting, [arrival.playerId]: better },
      divergence: new Set([...pre.divergence, arrival.playerId]),
      teams: {
        ...pre.teams,
        [team]: {
          ...pre.teams[team]!,
          deadMoney: 0,
          roster: [
            ...rosterOf(pre, team)
              .filter((r) => pre.players[r.playerId]!.pos !== 'QB')
              .map((r) => ({ ...r })),
            starter,
            { ...arrival, contract: bigDeal },
          ],
        },
      },
    }
    const over = fa.payroll(squeezed, team) - cap
    // Make the crunch real: force payroll above the cap so the cap pass has to cut something.
    const crunched: LeagueState =
      over > 0
        ? squeezed
        : {
            ...squeezed,
            teams: {
              ...squeezed.teams,
              [team]: { ...squeezed.teams[team]!, deadMoney: -over + 6 },
            },
          }
    expect(fa.payroll(crunched, team)).toBeGreaterThan(cap)

    const out = fa.runAiCutdowns(crunched, ctx)
    const stillQbs = rosterOf(out, team).filter((r) => out.players[r.playerId]!.pos === 'QB')
    expect(stillQbs.map((r) => r.playerId)).toContain(arrival.playerId)
    expect(stillQbs.length).toBeGreaterThanOrEqual(2)
    expect(fa.payroll(out, team)).toBeLessThanOrEqual(cap)
  })
})
