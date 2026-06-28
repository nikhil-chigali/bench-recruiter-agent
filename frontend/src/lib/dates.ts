// Format ISO date strings (from the backend) for display. UTC is used so a date-only value
// like "2016-01-01" never shifts a month under the viewer's local timezone.
export function formatMonthYear(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = formatMonthYear(start)
  const e = end ? formatMonthYear(end) : 'Present'
  if (!s && (!end || !e)) return ''
  return `${s || '—'} – ${e}`
}

// <input type="month"> gives "YYYY-MM"; the API wants a date, so anchor to the first of the month.
export function monthInputToIso(m: string): string | null {
  return m ? `${m}-01` : null
}

// An ISO date ("YYYY-MM-DD" or null) → the "YYYY-MM" value an <input type="month"> expects.
export function isoToMonthInput(iso: string | null): string {
  return iso ? iso.slice(0, 7) : ''
}
