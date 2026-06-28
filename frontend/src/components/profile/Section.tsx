import type { ReactNode } from 'react'

export default function Section({
  id,
  title,
  children,
  action,
}: {
  id: string
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {action}
      </div>
      <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {children}
      </div>
    </section>
  )
}
