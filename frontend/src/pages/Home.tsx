import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'

type Me = {
  id: string
  email: string
  name: string
  role: string
  org_id: string
  org_name: string
}

export default function Home() {
  const { signOut } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load profile'))
  }, [])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3">
      {error && <p className="text-destructive text-sm">{error}</p>}
      {me && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {me.name}</h1>
          <p className="text-muted-foreground text-sm">
            {me.org_name} · {me.role}
          </p>
        </>
      )}
      {!me && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
      <Button variant="outline" onClick={() => void signOut()}>
        Sign out
      </Button>
    </main>
  )
}
