const PHASE_LABEL: Record<string, string> = {
  PRESEASON: 'preseason',
  REGULAR: 'regular season',
  PLAYOFFS: 'playoffs',
  OFFSEASON_RESIGN: 're-signing period',
  FREE_AGENCY: 'free agency',
  DRAFT: 'draft',
}

/** A phase in the user's words for running copy: "Continue as the Colts: 2015, preseason." */
export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase.replace(/_/g, ' ').toLowerCase()
}
