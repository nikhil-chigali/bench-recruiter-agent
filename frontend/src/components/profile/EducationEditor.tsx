import { useState } from 'react'
import type { CandidateDetail, EducationIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import { isoToMonthInput, monthInputToIso } from '@/lib/dates'
import Section from '@/components/profile/Section'
import EducationSection from '@/components/profile/EducationSection'
import EditActions from '@/components/profile/EditActions'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['education'][number]
type Row = {
  university: string
  degree: string
  location: string
  cgpa: string
  coursework: string
  start: string
  end: string
}

const EMPTY: Row = { university: '', degree: '', location: '', cgpa: '', coursework: '', start: '', end: '' }

function toRow(e: Item): Row {
  return {
    university: e.university,
    degree: e.degree ?? '',
    location: e.location ?? '',
    cgpa: e.cgpa == null ? '' : String(e.cgpa),
    coursework: e.coursework ?? '',
    start: isoToMonthInput(e.start_date),
    end: isoToMonthInput(e.end_date),
  }
}

export default function EducationEditor({
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
    const payload: EducationIn[] = rows
      .filter((r) => r.university.trim())
      .map((r) => ({
        university: r.university.trim(),
        degree: r.degree.trim() || null,
        location: r.location.trim() || null,
        cgpa: r.cgpa.trim() ? Number(r.cgpa) : null,
        coursework: r.coursework.trim() || null,
        start_date: monthInputToIso(r.start),
        end_date: monthInputToIso(r.end),
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/education`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save education')
    } finally {
      setSaving(false)
    }
  }

  const action = !editing && canEdit ? (
    <button
      type="button"
      onClick={start}
      className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
    >
      Edit
    </button>
  ) : null

  return (
    <Section id={id} title="Education" action={action}>
      {!editing && <EducationSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="University">
                  <input className={inputClass} value={r.university} onChange={(e) => setRow(i, { university: e.target.value })} />
                </Field>
                <Field label="Degree">
                  <input className={inputClass} value={r.degree} onChange={(e) => setRow(i, { degree: e.target.value })} />
                </Field>
                <Field label="Location">
                  <input className={inputClass} value={r.location} onChange={(e) => setRow(i, { location: e.target.value })} />
                </Field>
                <Field label="CGPA">
                  <input className={inputClass} type="number" step="0.01" value={r.cgpa} onChange={(e) => setRow(i, { cgpa: e.target.value })} />
                </Field>
                <Field label="Start">
                  <input type="month" className={inputClass} value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
                </Field>
                <Field label="End">
                  <input type="month" className={inputClass} value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Coursework">
                  <input className={inputClass} value={r.coursework} onChange={(e) => setRow(i, { coursework: e.target.value })} />
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
          <EditActions
            addLabel="+ Add education"
            onAdd={() => setRows((rs) => [...rs, EMPTY])}
            onCancel={() => { setEditing(false); setError(null) }}
            onSave={save}
            saving={saving}
            error={error}
          />
        </div>
      )}
    </Section>
  )
}
