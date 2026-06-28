import type { CandidateDetail } from '@callup/shared-types'
import { formatMonthYear } from '@/lib/dates'

type Item = CandidateDetail['certifications'][number]

export default function CertificationsSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No certifications added.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((ct) => (
        <div
          key={ct.id}
          className="flex items-baseline justify-between gap-3 border-b border-[#f4f4f5] pb-3 last:border-b-0 last:pb-0"
        >
          <div>
            <div className="text-[14px] font-semibold">{ct.name}</div>
            {ct.issued_by && <div className="text-[12.5px] text-[#71717a]">{ct.issued_by}</div>}
          </div>
          <div className="flex flex-none items-center gap-2">
            {ct.issued_on && (
              <span className="font-mono text-[11.5px] text-[#a1a1aa]">
                {formatMonthYear(ct.issued_on)}
              </span>
            )}
            {ct.verification_url && (
              <a
                href={ct.verification_url}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#5b46e0] hover:underline"
              >
                verify
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
