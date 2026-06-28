import type { CandidateDraft, ExperienceDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'
import StringListEditor from '@/components/profile/StringListEditor'
import SkillsChipEditor from '@/components/SkillsChipEditor'

const EMPTY: ExperienceDraft = {
  company: '',
  position: '',
  start_date: '',
  end_date: '',
  description: [],
  tech_stack: [],
}

export default function ExperienceStep({
  draft,
  update,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
}) {
  const rows = draft.experience
  function set(i: number, patch: Partial<ExperienceDraft>) {
    update({ experience: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && <p className="text-[13px] text-muted-foreground">No experience added yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-[12px] border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company">
              <input className={inputClass} value={r.company} onChange={(e) => set(i, { company: e.target.value })} />
            </Field>
            <Field label="Position">
              <input className={inputClass} value={r.position} onChange={(e) => set(i, { position: e.target.value })} />
            </Field>
            <Field label="Start">
              <input className={inputClass} type="month" value={r.start_date} onChange={(e) => set(i, { start_date: e.target.value })} />
            </Field>
            <Field label="End (leave blank if current)">
              <input className={inputClass} type="month" value={r.end_date} onChange={(e) => set(i, { end_date: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Highlights">
              <StringListEditor items={r.description} onChange={(d) => set(i, { description: d })} placeholder="Achievement or responsibility" />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Tech stack">
              <SkillsChipEditor skills={r.tech_stack} onChange={(t) => set(i, { tech_stack: t })} />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => update({ experience: rows.filter((_, j) => j !== i) })}
            className="mt-3 text-[12.5px] text-destructive hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update({ experience: [...rows, EMPTY] })}
        className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
      >
        + Add experience
      </button>
    </div>
  )
}
