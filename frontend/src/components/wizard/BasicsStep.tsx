import type { CandidateDraft } from '@/lib/candidateDraft'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'
import { Field, inputClass } from '@/components/wizard/Field'
import SkillsChipEditor from '@/components/SkillsChipEditor'

export default function BasicsStep({
  draft,
  update,
  errors,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
  errors: { name?: string; title?: string }
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name *" hint={errors.name}>
          <input className={inputClass} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Title *" hint={errors.title}>
          <input
            className={inputClass}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Senior Backend Engineer"
          />
        </Field>
      </div>

      <Field label="Primary skills">
        <SkillsChipEditor
          skills={draft.primary_skills}
          onChange={(next) => update({ primary_skills: next })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
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
          <input
            className={inputClass}
            value={draft.location}
            onChange={(e) => update({ location: e.target.value })}
            placeholder="Austin, TX"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Email">
          <input className={inputClass} type="email" value={draft.email} onChange={(e) => update({ email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className={inputClass} value={draft.phone} onChange={(e) => update({ phone: e.target.value })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="LinkedIn URL">
          <input className={inputClass} value={draft.linkedin_url} onChange={(e) => update({ linkedin_url: e.target.value })} />
        </Field>
        <Field label="GitHub URL">
          <input className={inputClass} value={draft.github_url} onChange={(e) => update({ github_url: e.target.value })} />
        </Field>
        <Field label="Portfolio URL">
          <input className={inputClass} value={draft.portfolio_url} onChange={(e) => update({ portfolio_url: e.target.value })} />
        </Field>
      </div>

      <Field label="Summary">
        <textarea
          className="min-h-[88px] w-full resize-y rounded-[9px] border border-input bg-card px-3 py-2 text-[13.5px] outline-none focus:border-[#a5b4fc]"
          value={draft.summary}
          onChange={(e) => update({ summary: e.target.value })}
          placeholder="Short professional summary"
        />
      </Field>
    </div>
  )
}
