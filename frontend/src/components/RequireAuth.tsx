import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
