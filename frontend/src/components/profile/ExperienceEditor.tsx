import { useState } from 'react'
import type { CandidateDetail, ExperienceIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import { isoToMonthInput, monthInputToIso } from '@/lib/dates'
import Section from '@/components/profile/Section'
import ExperienceSection from '@/components/profile/ExperienceSection'
import StringListEditor from '@/components/profile/StringListEditor'
import SkillsChipEditor from '@/components/SkillsChipEditor'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['experience'][number]
type Row = {
  company: string
  position: string
  start: string
  end: string
  description: string[]
  tech_stack: string[]
}

const EMPTY: Row = { company: '', position: '', start: '', end: '', description: [], tech_stack: [] }

function toRow(e: Item): Row {
  return {
    company: e.company,
    position: e.position ?? '',
    start: isoToMonthInput(e.start_date),
    end: isoToMonthInput(e.end_date),
    description: e.description ?? [],
    tech_stack: e.tech_stack ?? [],
  }
}

export default function ExperienceEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: Item[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setRows(items.map(toRow))
    setError(null)
    setEditing(true)
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  async function save() {
    setSaving(true)
    setError(null)
    const payload: ExperienceIn[] = rows
      .filter((r) => r.company.trim())
      .map((r) => ({
        company: r.company.trim(),
        position: r.position.trim() || null,
        start_date: monthInputToIso(r.start),
        end_date: monthInputToIso(r.end),
        description: r.description,
        tech_stack: r.tech_stack,
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/experience`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save experience')
    } finally {
      setSaving(false)
    }
  }

  const action = editing ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-[8px] bg-brand px-3 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  ) : canEdit ? (
    <button
      type="button"
      onClick={start}
      className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
    >
      Edit
    </button>
  ) : null

  return (
    <Section id={id} title="Experience" action={action}>
      {!editing && <ExperienceSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Company">
                  <input className={inputClass} value={r.company} onChange={(e) => setRow(i, { company: e.target.value })} />
                </Field>
                <Field label="Position">
                  <input className={inputClass} value={r.position} onChange={(e) => setRow(i, { position: e.target.value })} />
                </Field>
                <Field label="Start">
                  <input type="month" className={inputClass} value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
                </Field>
                <Field label="End (blank if current)">
                  <input type="month" className={inputClass} value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Highlights">
                  <StringListEditor items={r.description} onChange={(d) => setRow(i, { description: d })} placeholder="Achievement or responsibility" />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Tech stack">
                  <SkillsChipEditor skills={r.tech_stack} onChange={(t) => setRow(i, { tech_stack: t })} />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="mt-3 text-[12.5px] text-destructive hover:underline"
              >
                Remove entry
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, EMPTY])}
            className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
          >
            + Add experience
          </button>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
      )}
    </Section>
  )
}
