import type { CandidateDraft, EducationDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

const EMPTY: EducationDraft = { university: '', degree: '' }

export default function EducationStep({
  draft,
  update,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
}) {
  const rows = draft.education
  function set(i: number, patch: Partial<EducationDraft>) {
    update({ education: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && <p className="text-[13px] text-muted-foreground">No education added yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-[12px] border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="University">
              <input className={inputClass} value={r.university} onChange={(e) => set(i, { university: e.target.value })} />
            </Field>
            <Field label="Degree">
              <input
                className={inputClass}
                value={r.degree}
                onChange={(e) => set(i, { degree: e.target.value })}
                placeholder="BS Computer Science"
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => update({ education: rows.filter((_, j) => j !== i) })}
            className="mt-3 text-[12.5px] text-destructive hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update({ education: [...rows, EMPTY] })}
        className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
      >
        + Add education
      </button>
    </div>
  )
}
