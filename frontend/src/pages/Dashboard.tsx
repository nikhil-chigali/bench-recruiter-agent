import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Dashboard() {
  const { signOut } = useAuth()
  const { recruiter } = useProfile()
  if (!recruiter) return null

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
      <main className="flex-1 p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Welcome, {recruiter.name}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            You're the <span className="text-foreground font-medium">{recruiter.role}</span> of{' '}
            <span className="text-foreground font-medium">{recruiter.org_name}</span>.
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
