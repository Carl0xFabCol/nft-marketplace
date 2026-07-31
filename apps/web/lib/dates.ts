// lib/dates.ts
// Date helpers shared by the bid/list flows. Contract expiries are epoch
// SECONDS — converting here avoids the recurring ms-vs-s bug.
export function dateToEpochSeconds(date: Date | number | string | null | undefined): number {
  if (date == null) return 0
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return 0
  return Math.floor(d.getTime() / 1000)
}
