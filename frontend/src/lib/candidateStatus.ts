export type CandidateStatus = 'on_bench' | 'interviewing' | 'placed'

export type StatusStyle = {
  label: string
  dot: string
  bg: string
  border: string
  fg: string
}

/** Token → label + colors, mirroring the approved hi-fi mockup. */
export const CANDIDATE_STATUS: Record<CandidateStatus, StatusStyle> = {
  on_bench: { label: 'On bench', dot: '#16a34a', bg: '#ecfdf3', border: '#bbf7d0', fg: '#15803d' },
  interviewing: { label: 'Interviewing', dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a', fg: '#b45309' },
  placed: { label: 'Placed', dot: '#a1a1aa', bg: '#f4f4f5', border: '#e4e4e7', fg: '#52525b' },
}

/** Display order for filters and status menus. */
export const CANDIDATE_STATUS_ORDER: CandidateStatus[] = ['on_bench', 'interviewing', 'placed']

/** Resolve a (possibly unknown) status token to its style, defaulting to on_bench. */
export function statusStyle(status: string): StatusStyle {
  return CANDIDATE_STATUS[status as CandidateStatus] ?? CANDIDATE_STATUS.on_bench
}
