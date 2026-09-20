const PHASE_LABEL: Record<string, string> = {
  PRESEASON: 'preseason',
  REGULAR: 'regular season',
  PLAYOFFS: 'playoffs',
  OFFSEASON_RESIGN: 're-signing period',
  DRAFT: 'draft',
  UDFA: 'UDFA',
  FREE_AGENCY: 'free agency',
  TRAINING_CAMP: 'training camp',
}

const OFFSEASON_PHASES = new Set([
  'OFFSEASON_RESIGN',
  'DRAFT',
  'UDFA',
  'FREE_AGENCY',
  'TRAINING_CAMP',
])

/** A phase in the user's words for running copy: "Continue as the Colts: 2015, preseason." */
export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase.replace(/_/g, ' ').toLowerCase()
}

/**
 * The offseason belongs to the season it prepares: season 2012's DRAFT phase drafts the 2013 class,
 * so it reads "2013 offseason" (and a new game opens in exactly that state).
 */
export function seasonText(season: number, phase: string): string {
  return OFFSEASON_PHASES.has(phase) ? `${season + 1} offseason` : String(season)
}

/** Strip readout parts: "2013 offseason · Draft", "2013 · Regular season". */
export function seasonPhaseLabel(
  season: number,
  phase: string,
): { seasonText: string; phaseText: string } {
  const label = phaseLabel(phase)
  const phaseText = label === 'UDFA' ? label : label.charAt(0).toUpperCase() + label.slice(1)
  return { seasonText: seasonText(season, phase), phaseText }
}
