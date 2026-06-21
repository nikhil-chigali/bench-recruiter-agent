import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '@/lib/profile'

export default function RequireOnboarded({ children }: { children: ReactNode }) {
  const { loading, onboarded, error, refresh } = useProfile()
  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3">
        <p className="text-destructive text-sm">{error}</p>
        <button type="button" className="text-sm underline" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    )
  }
  if (!onboarded) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}
