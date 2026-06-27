import type { CandidateDraft, ProjectDraft, CertificationDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

const EMPTY_PROJECT: ProjectDraft = { title: '', project_link: '', github_link: '' }
const EMPTY_CERT: CertificationDraft = { name: '', issued_by: '' }

export default function ProjectsCertsStep({
  draft,
  update,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
}) {
  const projects = draft.projects
  const certs = draft.certifications
  function setP(i: number, patch: Partial<ProjectDraft>) {
    update({ projects: projects.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  function setC(i: number, patch: Partial<CertificationDraft>) {
    update({ certifications: certs.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold">Projects</h3>
        {projects.length === 0 && <p className="text-[13px] text-muted-foreground">No projects added yet.</p>}
        {projects.map((r, i) => (
          <div key={i} className="rounded-[12px] border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Title">
                <input className={inputClass} value={r.title} onChange={(e) => setP(i, { title: e.target.value })} />
              </Field>
              <Field label="Project link">
                <input className={inputClass} value={r.project_link} onChange={(e) => setP(i, { project_link: e.target.value })} />
              </Field>
              <Field label="GitHub link">
                <input className={inputClass} value={r.github_link} onChange={(e) => setP(i, { github_link: e.target.value })} />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => update({ projects: projects.filter((_, j) => j !== i) })}
              className="mt-3 text-[12.5px] text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ projects: [...projects, EMPTY_PROJECT] })}
          className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
        >
          + Add project
        </button>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold">Certifications</h3>
        {certs.length === 0 && <p className="text-[13px] text-muted-foreground">No certifications added yet.</p>}
        {certs.map((r, i) => (
          <div key={i} className="rounded-[12px] border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <input className={inputClass} value={r.name} onChange={(e) => setC(i, { name: e.target.value })} />
              </Field>
              <Field label="Issued by">
                <input className={inputClass} value={r.issued_by} onChange={(e) => setC(i, { issued_by: e.target.value })} />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => update({ certifications: certs.filter((_, j) => j !== i) })}
              className="mt-3 text-[12.5px] text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ certifications: [...certs, EMPTY_CERT] })}
          className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
        >
          + Add certification
        </button>
      </section>
    </div>
  )
}
