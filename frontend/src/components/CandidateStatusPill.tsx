import { ChevronDown } from 'lucide-react'
import { statusStyle } from '@/lib/candidateStatus'

export default function CandidateStatusPill({
  status,
  interactive = false,
}: {
  status: string
  interactive?: boolean
}) {
  const s = statusStyle(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: s.bg, borderColor: s.border, color: s.fg }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
      {interactive && (
        <ChevronDown
          className="-mr-0.5 size-3 opacity-70 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      )}
    </span>
  )
}
