import { useState } from 'react'
import type { CandidateDraft } from '@/lib/candidateDraft'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'
import { Field, inputClass } from '@/components/wizard/Field'

export default function BasicsStep({
  draft,
  update,
  errors,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
  errors: { name?: string; title?: string }
}) {
  const [skill, setSkill] = useState('')

  function addSkill() {
    const s = skill.trim()
    setSkill('')
    if (!s || draft.primary_skills.includes(s)) return
    update({ primary_skills: [...draft.primary_skills, s] })
  }

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
        <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-input bg-card p-2">
          {draft.primary_skills.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-[6px] bg-[#f4f4f5] px-2 py-0.5 text-[12px] text-[#52525b]"
            >
              {s}
              <button
                type="button"
                onClick={() => update({ primary_skills: draft.primary_skills.filter((x) => x !== s) })}
                className="text-[#a1a1aa] hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSkill()
              }
            }}
            onBlur={addSkill}
            placeholder="Add a skill…"
            className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none"
          />
        </div>
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
    </div>
  )
}
