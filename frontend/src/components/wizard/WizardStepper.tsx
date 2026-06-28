export type Step = { key: string; label: string }

export default function WizardStepper({
  steps,
  current,
  onJump,
}: {
  steps: Step[]
  current: number
  onJump: (index: number) => void
}) {
  const pct = Math.round(((current + 1) / steps.length) * 100)
  return (
    <div className="w-[220px] flex-none">
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-[#f0f0f1]">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-col gap-0.5">
        {steps.map((s, i) => {
          const state = i === current ? 'current' : i < current ? 'done' : 'todo'
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onJump(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] ${
                  state === 'current'
                    ? 'bg-[#f4f4f5] font-medium text-foreground'
                    : state === 'done'
                      ? 'text-foreground hover:bg-[#f4f4f5]'
                      : 'text-[#a1a1aa] hover:bg-[#f4f4f5]'
                }`}
              >
                <span
                  className={`flex size-5 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${
                    state === 'todo' ? 'border border-[#d4d4d8] text-[#a1a1aa]' : 'bg-brand text-white'
                  }`}
                >
                  {state === 'done' ? '✓' : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
