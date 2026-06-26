import type { CandidateDetail } from '@callup/shared-types'
import { formatRange } from '@/lib/dates'

type Item = CandidateDetail['experience'][number]

export default function ExperienceSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No experience added.</p>
  }
  return (
    <div className="flex flex-col gap-5">
      {items.map((e) => (
        <div key={e.id} className="border-b border-[#f4f4f5] pb-5 last:border-b-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[14px] font-semibold">
              {e.position ? `${e.position} · ` : ''}
              {e.company}
            </div>
            <div className="font-mono text-[11.5px] text-[#a1a1aa]">
              {formatRange(e.start_date, e.end_date)}
            </div>
          </div>
          {e.description && e.description.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[#52525b]">
              {e.description.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {e.tech_stack && e.tech_stack.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {e.tech_stack.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#52525b]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
