import type { CandidateDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

export default function ReviewStep({
  draft,
  update,
  isManager,
  recruiters,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
  isManager: boolean
  recruiters: { id: string; name: string }[]
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[12px] border border-border bg-card p-4 text-[13px]">
        <div className="text-[15px] font-semibold">{draft.name || '—'}</div>
        <div className="text-muted-foreground">{draft.title || '—'}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {draft.primary_skills.map((s) => (
            <span
              key={s}
              className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]"
            >
              {s}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-1 text-[12.5px] text-[#52525b]">
          <span>Work auth: {draft.work_authorization || '—'}</span>
          <span>Location: {draft.location || '—'}</span>
          <span>Experience entries: {draft.experience.length}</span>
          <span>Education entries: {draft.education.length}</span>
          <span>Projects: {draft.projects.length}</span>
          <span>Certifications: {draft.certifications.length}</span>
        </div>
      </div>

      {isManager && (
        <Field label="Assign to">
          <select className={inputClass} value={draft.user_id} onChange={(e) => update({ user_id: e.target.value })}>
            <option value="">Myself</option>
            {recruiters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}
