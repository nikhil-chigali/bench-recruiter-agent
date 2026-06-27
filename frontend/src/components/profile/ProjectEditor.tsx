import { useState } from 'react'
import type { CandidateDetail, ProjectIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import Section from '@/components/profile/Section'
import ProjectsSection from '@/components/profile/ProjectsSection'
import StringListEditor from '@/components/profile/StringListEditor'
import SkillsChipEditor from '@/components/SkillsChipEditor'
import EditActions from '@/components/profile/EditActions'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['projects'][number]
type Row = {
  title: string
  project_link: string
  github_link: string
  description: string[]
  tech_stack: string[]
}

const EMPTY: Row = { title: '', project_link: '', github_link: '', description: [], tech_stack: [] }

function toRow(p: Item): Row {
  return {
    title: p.title,
    project_link: p.project_link ?? '',
    github_link: p.github_link ?? '',
    description: p.description ?? [],
    tech_stack: p.tech_stack ?? [],
  }
}

export default function ProjectEditor({
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
    const payload: ProjectIn[] = rows
      .filter((r) => r.title.trim())
      .map((r) => ({
        title: r.title.trim(),
        project_link: r.project_link.trim() || null,
        github_link: r.github_link.trim() || null,
        description: r.description,
        tech_stack: r.tech_stack,
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/projects`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save projects')
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
    <Section id={id} title="Projects" action={action}>
      {!editing && <ProjectsSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Title">
                  <input className={inputClass} value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} />
                </Field>
                <Field label="Project link">
                  <input className={inputClass} value={r.project_link} onChange={(e) => setRow(i, { project_link: e.target.value })} />
                </Field>
                <Field label="GitHub link">
                  <input className={inputClass} value={r.github_link} onChange={(e) => setRow(i, { github_link: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Highlights">
                  <StringListEditor items={r.description} onChange={(d) => setRow(i, { description: d })} placeholder="What it does / your role" />
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
          <EditActions
            addLabel="+ Add project"
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
