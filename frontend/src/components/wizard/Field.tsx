import type { ReactNode } from 'react'

export const inputClass =
  'h-[38px] w-full rounded-[9px] border border-input bg-card px-3 text-[13.5px] outline-none focus:border-[#a5b4fc]'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[#52525b]">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-destructive">{hint}</span>}
    </label>
  )
}
