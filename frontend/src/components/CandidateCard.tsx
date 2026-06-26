import { initialsOf } from '@/lib/utils'
import type { CandidateCard as Candidate } from '@/lib/candidates'
import CandidateStatusPill from '@/components/CandidateStatusPill'

function SkillChips({ skills, max }: { skills: string[]; max: number }) {
  const shown = skills.slice(0, max)
  const extra = skills.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span
          key={s}
          className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#52525b]"
        >
          {s}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#a1a1aa]">
          +{extra}
        </span>
      )}
    </div>
  )
}

export default function CandidateCard({
  candidate,
  view,
}: {
  candidate: Candidate
  view: 'list' | 'grid'
}) {
  const yrs = `${candidate.years_experience}y`
  const auth = candidate.work_authorization ?? '—'
  const location = candidate.location ?? '—'

  if (view === 'list') {
    return (
      <div className="flex items-center border-b border-[#f4f4f5] px-[18px] py-[13px] last:border-b-0">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-[38px] flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-xs font-semibold text-[#52525b]">
            {initialsOf(candidate.name)}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold">
              {candidate.name}{' '}
              {candidate.title && <span className="font-normal text-[#a1a1aa]">· {candidate.title}</span>}
            </div>
            <div className="mt-[5px]">
              <SkillChips skills={candidate.primary_skills} max={4} />
            </div>
          </div>
        </div>
        <div className="w-[74px] font-mono text-[11.5px] text-[#52525b]">{auth}</div>
        <div className="w-[52px] text-[12.5px] text-[#52525b]">{yrs}</div>
        <div className="w-[150px] truncate text-[12px] text-[#52525b]">{location}</div>
        <div className="w-[120px]">
          <CandidateStatusPill status={candidate.status} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between gap-[9px]">
        <div className="flex min-w-0 items-center gap-[11px]">
          <div className="flex size-10 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-[13px] font-semibold text-[#52525b]">
            {initialsOf(candidate.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{candidate.name}</div>
            <div className="truncate text-xs text-[#a1a1aa]">{candidate.title ?? '—'}</div>
          </div>
        </div>
        <CandidateStatusPill status={candidate.status} />
      </div>
      <SkillChips skills={candidate.primary_skills} max={3} />
      <div className="flex items-center gap-[9px] border-t border-[#f4f4f5] pt-[10px] text-[11.5px] text-[#71717a]">
        <span className="font-mono text-[#52525b]">{auth}</span>
        <span className="text-[#d4d4d8]">·</span>
        <span>{yrs}</span>
        <span className="text-[#d4d4d8]">·</span>
        <span className="min-w-0 truncate">{location}</span>
      </div>
    </div>
  )
}
