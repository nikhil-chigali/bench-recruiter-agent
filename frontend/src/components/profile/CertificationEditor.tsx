import { useState } from 'react'
import type { CandidateDetail, CertificationIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import { isoToMonthInput, monthInputToIso } from '@/lib/dates'
import Section from '@/components/profile/Section'
import CertificationsSection from '@/components/profile/CertificationsSection'
import EditActions from '@/components/profile/EditActions'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['certifications'][number]
type Row = {
  name: string
  issued_by: string
  issued_on: string
  badge_url: string
  verification_url: string
}

const EMPTY: Row = { name: '', issued_by: '', issued_on: '', badge_url: '', verification_url: '' }

function toRow(c: Item): Row {
  return {
    name: c.name,
    issued_by: c.issued_by ?? '',
    issued_on: isoToMonthInput(c.issued_on),
    badge_url: c.badge_url ?? '',
    verification_url: c.verification_url ?? '',
  }
}

export default function CertificationEditor({
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
    const payload: CertificationIn[] = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        issued_by: r.issued_by.trim() || null,
        issued_on: monthInputToIso(r.issued_on),
        badge_url: r.badge_url.trim() || null,
        verification_url: r.verification_url.trim() || null,
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/certifications`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save certifications')
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
    <Section id={id} title="Certifications" action={action}>
      {!editing && <CertificationsSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Name">
                  <input className={inputClass} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                </Field>
                <Field label="Issued by">
                  <input className={inputClass} value={r.issued_by} onChange={(e) => setRow(i, { issued_by: e.target.value })} />
                </Field>
                <Field label="Issued on">
                  <input type="month" className={inputClass} value={r.issued_on} onChange={(e) => setRow(i, { issued_on: e.target.value })} />
                </Field>
                <Field label="Badge URL">
                  <input className={inputClass} value={r.badge_url} onChange={(e) => setRow(i, { badge_url: e.target.value })} />
                </Field>
                <Field label="Verification URL">
                  <input className={inputClass} value={r.verification_url} onChange={(e) => setRow(i, { verification_url: e.target.value })} />
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
            addLabel="+ Add certification"
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
