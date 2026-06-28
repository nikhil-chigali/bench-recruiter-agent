import { useRef, useState } from 'react'
import type { CandidateDetail, DocumentOut } from '@callup/shared-types'
import { api } from '@/lib/api'
import { DOC_TYPES, docTypeLabel } from '@/lib/docTypes'
import Section from '@/components/profile/Section'
import { Field, inputClass } from '@/components/wizard/Field'

const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg'

export default function DocumentsEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: DocumentOut[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [docType, setDocType] = useState<string>('residency_proof')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', docType)
    try {
      const updated = await api.upload<CandidateDetail>(`/candidates/${candidateId}/documents`, form)
      onSaved(updated)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload document')
    } finally {
      setBusy(false)
    }
  }

  async function download(doc: DocumentOut) {
    setError(null)
    try {
      const { url } = await api.get<{ url: string }>(
        `/candidates/${candidateId}/documents/${doc.id}/download`,
      )
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open document')
    }
  }

  async function remove(doc: DocumentOut) {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.delete<CandidateDetail>(
        `/candidates/${candidateId}/documents/${doc.id}`,
      )
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete document')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section id={id} title="Documents">
      {items.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No documents uploaded.</p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-foreground">
                  {doc.filename ?? '(unnamed)'}
                </div>
                <span className="text-[11px] text-muted-foreground">{docTypeLabel(doc.doc_type)}</span>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button
                  type="button"
                  onClick={() => download(doc)}
                  className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
                >
                  Download
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(doc)}
                    disabled={busy}
                    className="text-[12.5px] text-destructive hover:underline disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <Field label="Type">
            <select
              className={inputClass}
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
            className="text-[13px] file:mr-3 file:rounded-[8px] file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-[12.5px] hover:file:bg-[#f4f4f5]"
          />
          {busy && <span className="text-[12.5px] text-muted-foreground">Uploading…</span>}
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
    </Section>
  )
}
