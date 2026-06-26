import type { CandidateDetail } from '@callup/shared-types'

type Item = CandidateDetail['projects'][number]

export default function ProjectsSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No projects added.</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((p) => (
        <div key={p.id} className="border-b border-[#f4f4f5] pb-4 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{p.title}</span>
            {p.project_link && (
              <a
                href={p.project_link}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#5b46e0] hover:underline"
              >
                link
              </a>
            )}
            {p.github_link && (
              <a
                href={p.github_link}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#5b46e0] hover:underline"
              >
                github
              </a>
            )}
          </div>
          {p.description && p.description.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[#52525b]">
              {p.description.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {p.tech_stack && p.tech_stack.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.tech_stack.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#52525b]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
