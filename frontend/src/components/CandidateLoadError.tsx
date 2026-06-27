import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function CandidateLoadError({
  candidateId,
  notFound,
  status,
  message,
  onRetry,
}: {
  candidateId?: string
  notFound: boolean
  status: number | null
  message: string
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const eyebrow = notFound
    ? 'ERROR 404'
    : status && status >= 500
      ? `ERROR ${status}`
      : 'CONNECTION ERROR'

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex size-20 items-center justify-center rounded-full border-2 border-dashed border-[#e4e4e7] text-[26px] font-semibold text-[#a1a1aa]">
        {notFound ? '?' : '!'}
      </div>

      <p className="mt-6 text-[11px] font-medium tracking-[0.12em] text-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.015em]">
        {notFound ? 'Candidate not found' : "Couldn't load this candidate"}
      </h1>
      <p className="mt-2.5 max-w-[520px] text-[13.5px] leading-relaxed text-muted-foreground">
        {notFound
          ? "We couldn't find a candidate at this address. It may have been removed, reassigned outside your access, or the link is simply mistyped."
          : message}
      </p>

      {candidateId && (
        <div className="mt-6 inline-flex items-center gap-2 rounded-[10px] border border-input bg-card px-3.5 py-2 font-mono text-[13px]">
          <span className="text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
            REQUESTED
          </span>
          <span className="text-foreground">/candidates/{candidateId}</span>
        </div>
      )}

      <div className="mt-7 flex items-center gap-3">
        {notFound ? (
          <>
            <Button type="button" onClick={() => navigate('/candidates')}>
              ← Back to Candidates
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/candidates/new')}>
              + Add candidate
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate('/candidates')}>
              ← Back to Candidates
            </Button>
          </>
        )}
      </div>

      {notFound && (
        <p className="mt-5 text-[13px] text-muted-foreground">
          or{' '}
          <Link to="/candidates" className="font-medium text-[#5b46e0] hover:underline">
            search the roster
          </Link>{' '}
          for who you're after.
        </p>
      )}
    </div>
  )
}
