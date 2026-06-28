import type { CandidateCard as Candidate } from '@callup/shared-types'
import { initialsOf } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import CandidateStatusChanger from '@/components/CandidateStatusChanger'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">{label}</div>
      <div className="mt-0.5 text-[13px] text-foreground">{value}</div>
    </div>
  )
}

export default function CandidateDrawer({
  candidate,
  open,
  onOpenChange,
  onStatusChange,
  onOpenProfile,
  error,
  statusUpdating,
}: {
  candidate: Candidate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatusChange: (next: string) => void
  onOpenProfile: () => void
  error?: string | null
  statusUpdating?: boolean
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[420px]">
        {candidate && (
          <>
            <SheetHeader className="border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex size-11 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-sm font-semibold text-[#52525b]">
                  {initialsOf(candidate.name)}
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-[15px]">{candidate.name}</SheetTitle>
                  <SheetDescription className="truncate text-[13px]">
                    {candidate.title ?? '—'}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 py-5">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-muted-foreground">Status</span>
                <CandidateStatusChanger status={candidate.status} onChange={onStatusChange} disabled={statusUpdating} />
              </div>
              {error && <p className="text-[12.5px] text-destructive">{error}</p>}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Work auth" value={candidate.work_authorization ?? '—'} />
                <Field label="Experience" value={`${candidate.years_experience}y`} />
                <Field label="Location" value={candidate.location ?? '—'} />
                <Field label="Recruiter" value={candidate.recruiter_name} />
              </div>

              <div>
                <div className="mb-1.5 font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">
                  Skills
                </div>
                <div className="flex flex-wrap gap-1">
                  {candidate.primary_skills.length === 0 ? (
                    <span className="text-[13px] text-muted-foreground">—</span>
                  ) : (
                    candidate.primary_skills.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[11px] text-[#52525b]"
                      >
                        {s}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={onOpenProfile}>
                Open full profile
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
