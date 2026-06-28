import { Field, inputClass } from '@/components/wizard/Field'
import SkillsChipEditor from '@/components/SkillsChipEditor'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'

export type OverviewDraft = {
  name: string
  title: string
  primary_skills: string[]
  work_authorization: string
  location: string
  summary: string
  user_id: string // current/selected assignee
}

export default function OverviewEditor({
  draft,
  update,
  years,
  isManager,
  members,
  errors,
}: {
  draft: OverviewDraft
  update: (patch: Partial<OverviewDraft>) => void
  years: number
  isManager: boolean
  members: { id: string; name: string }[]
  errors: { name?: string; title?: string }
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name *" hint={errors.name}>
          <input className={inputClass} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Title *" hint={errors.title}>
          <input className={inputClass} value={draft.title} onChange={(e) => update({ title: e.target.value })} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Primary skills">
          <SkillsChipEditor skills={draft.primary_skills} onChange={(next) => update({ primary_skills: next })} />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Field label="Work authorization">
          <select
            className={inputClass}
            value={draft.work_authorization}
            onChange={(e) => update({ work_authorization: e.target.value })}
          >
            <option value="">—</option>
            {WORK_AUTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input className={inputClass} value={draft.location} onChange={(e) => update({ location: e.target.value })} />
        </Field>
        <Field label="Years of experience">
          <div className="flex h-[38px] items-center text-[13.5px] text-muted-foreground">
            {years}y · derived from experience
          </div>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Summary">
          <textarea
            value={draft.summary}
            onChange={(e) => update({ summary: e.target.value })}
            rows={5}
            className="w-full rounded-[9px] border border-input bg-card p-3 text-[13.5px] leading-relaxed outline-none focus:border-[#a5b4fc]"
          />
        </Field>
      </div>

      {isManager && (
        <div className="mt-4">
          <Field label="Assigned to">
            <select className={inputClass} value={draft.user_id} onChange={(e) => update({ user_id: e.target.value })}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  )
}
