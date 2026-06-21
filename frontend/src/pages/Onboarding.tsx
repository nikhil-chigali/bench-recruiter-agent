import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Onboarding() {
  const navigate = useNavigate()
  const { loading, onboarded, refresh } = useProfile()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (onboarded) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    const display_name = String(form.get('display_name')).trim()
    const org_name = String(form.get('org_name')).trim()
    try {
      await api.post('/orgs', { org_name, display_name })
      await refresh()
      navigate('/')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await refresh()
        navigate('/')
        return
      }
      setError(err instanceof Error ? err.message : 'Could not create your workspace')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up your workspace</CardTitle>
          <CardDescription>Create your organization to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="display_name">Your name</Label>
              <Input id="display_name" name="display_name" required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="org_name">Organization name</Label>
              <Input id="org_name" name="org_name" required maxLength={120} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create workspace'}
            </Button>
          </form>
            <p className="text-muted-foreground mt-4 text-sm">
              Have an invite? Open the invite link your admin sent you.
            </p>
        </CardContent>
      </Card>
    </main>
  )
}
