import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import MembersSection from '@/components/MembersSection'
import InvitesSection from '@/components/InvitesSection'
import DangerZone from '@/components/DangerZone'

export default function Dashboard() {
  const { signOut } = useAuth()
  const { recruiter } = useProfile()
  if (!recruiter) return null
  const isManager = recruiter.role === 'owner' || recruiter.role === 'admin'
  const isOwner = recruiter.role === 'owner'

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold tracking-tight">{recruiter.org_name}</span>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">
            {recruiter.name} · {recruiter.role}
          </span>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <MembersSection />
        {isManager && <InvitesSection />}
        {isOwner && <DangerZone />}
      </main>
    </div>
  )
}
