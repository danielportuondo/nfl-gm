/** Shared money formatting ($M, one decimal). A leading minus reads as savings owed, not a cap dollar sign. */
export function formatMoney(m: number): string {
  return m < 0 ? `-$${Math.abs(m).toFixed(1)}M` : `$${m.toFixed(1)}M`
}
