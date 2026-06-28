import type { CandidateDetail } from '@callup/shared-types'
import { formatRange } from '@/lib/dates'

type Item = CandidateDetail['education'][number]

export default function EducationSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No education added.</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((ed) => (
        <div key={ed.id} className="border-b border-[#f4f4f5] pb-4 last:border-b-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[14px] font-semibold">{ed.university}</div>
            <div className="font-mono text-[11.5px] text-[#a1a1aa]">
              {formatRange(ed.start_date, ed.end_date)}
            </div>
          </div>
          {(ed.degree || ed.location) && (
            <div className="mt-0.5 text-[13px] text-[#52525b]">
              {[ed.degree, ed.location].filter(Boolean).join(' · ')}
            </div>
          )}
          {ed.cgpa != null && (
            <div className="mt-0.5 text-[12.5px] text-[#71717a]">CGPA: {ed.cgpa}</div>
          )}
          {ed.coursework && <div className="mt-1 text-[12.5px] text-[#71717a]">{ed.coursework}</div>}
        </div>
      ))}
    </div>
  )
}
