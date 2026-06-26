import { CANDIDATE_STATUS_ORDER, statusStyle } from '@/lib/candidateStatus'
import CandidateStatusPill from '@/components/CandidateStatusPill'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function CandidateStatusChanger({
  status,
  onChange,
  disabled,
}: {
  status: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="inline-flex cursor-pointer rounded-full outline-none disabled:cursor-default"
      >
        <CandidateStatusPill status={status} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {CANDIDATE_STATUS_ORDER.map((token) => {
          const s = statusStyle(token)
          return (
            <DropdownMenuItem
              key={token}
              onSelect={() => onChange(token)}
              className="gap-2 text-[13px]"
            >
              <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
              {s.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
