import type { ReactNode } from 'react'

export default function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {children}
      </div>
    </section>
  )
}
