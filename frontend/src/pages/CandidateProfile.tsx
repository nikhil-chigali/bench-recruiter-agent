import { Link, useParams } from 'react-router-dom'
import AppLayout from '@/components/AppLayout'

export default function CandidateProfile() {
  const { id } = useParams<{ id: string }>()
  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        <Link to="/candidates" className="text-[13px] text-muted-foreground hover:text-foreground">
          ← Back to candidates
        </Link>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.015em]">Candidate profile</h1>
        <p className="mt-[3px] text-[13.5px] text-muted-foreground">
          Full profile for <span className="font-mono">{id}</span> — coming in the next chunk.
        </p>
      </div>
    </AppLayout>
  )
}
