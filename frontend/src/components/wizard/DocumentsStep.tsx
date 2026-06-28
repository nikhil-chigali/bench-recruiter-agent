import { useRef, useState } from 'react'
import { DOC_TYPES, docTypeLabel } from '@/lib/docTypes'
import { Field, inputClass } from '@/components/wizard/Field'

const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg'

export type StagedDoc = { file: File; docType: string }

export default function DocumentsStep({
  docs,
  setDocs,
}: {
  docs: StagedDoc[]
  setDocs: (docs: StagedDoc[]) => void
}) {
  const [docType, setDocType] = useState<string>('residency_proof')
  const fileRef = useRef<HTMLInputElement>(null)

  function add(file: File) {
    setDocs([...docs, { file, docType }])
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted-foreground">
        Add work-authorization documents (PDF, Word, or image, up to 10&nbsp;MB). They upload when
        you create the candidate — unlike the rest of the form, staged files are not saved in the
        draft, so they won&rsquo;t survive a page refresh.
      </p>

      {docs.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No documents added yet.</p>
      )}
      {docs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {docs.map((d, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px]">{d.file.name}</div>
                <span className="text-[11px] text-muted-foreground">{docTypeLabel(d.docType)}</span>
              </div>
              <button
                type="button"
                onClick={() => setDocs(docs.filter((_, j) => j !== i))}
                className="flex-none text-[12.5px] text-destructive hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <Field label="Type">
          <select className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
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
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) add(f)
          }}
          className="text-[13px] file:mr-3 file:rounded-[8px] file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-[12.5px] hover:file:bg-[#f4f4f5]"
        />
      </div>
    </div>
  )
}
