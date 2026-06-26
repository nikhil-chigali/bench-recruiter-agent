import { statusStyle } from '@/lib/candidateStatus'

export default function CandidateStatusPill({ status }: { status: string }) {
  const s = statusStyle(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: s.bg, borderColor: s.border, color: s.fg }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  )
}
