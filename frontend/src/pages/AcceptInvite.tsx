import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Preview = {
  org_name: string
  role: string
  email: string
  status: string
  email_matches: boolean
}

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { session } = useAuth()
  const { onboarded, refresh } = useProfile()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    api
      .get<Preview>(`/invitations/lookup?token=${encodeURIComponent(token)}`)
      .then((p) => active && setPreview(p))
      .catch((e) =>
        active &&
        setLoadError(
          e instanceof ApiError && e.status === 404
            ? 'This invite could not be found.'
            : 'Could not load this invite.',
        ),
      )
    return () => {
      active = false
    }
  }, [token])

  if (onboarded) {
    return (
      <Centered>
        <p className="text-muted-foreground text-sm">You're already part of an organization.</p>
        <Button onClick={() => navigate('/')}>Go to dashboard</Button>
      </Centered>
    )
  }

  if (!token) {
    return (
      <Centered>
        <p className="text-destructive text-sm">This invite link is missing its token.</p>
      </Centered>
    )
  }

  if (loadError) {
    return (
      <Centered>
        <p className="text-destructive text-sm">{loadError}</p>
      </Centered>
    )
  }

  if (!preview) {
    return <Centered>Loading…</Centered>
  }

  const signedInEmail = session?.user.email ?? ''
  const accepting = preview.status === 'pending' && preview.email_matches

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitError(null)
    setBusy(true)
    const display_name = String(new FormData(e.currentTarget).get('display_name')).trim()
    try {
      await api.post('/invitations/accept', { token, display_name })
      await refresh()
      navigate('/')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not accept the invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Join {preview.org_name}</CardTitle>
          <CardDescription>You've been invited as {preview.role}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!preview.email_matches && (
            <p className="text-destructive text-sm">
              This invite is for {preview.email}; you're signed in as {signedInEmail}.
            </p>
          )}
          {preview.status !== 'pending' && (
            <p className="text-destructive text-sm">This invite is {preview.status}.</p>
          )}
          {accepting && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="display_name">Your name</Label>
                <Input id="display_name" name="display_name" required maxLength={120} />
              </div>
              {submitError && <p className="text-destructive text-sm">{submitError}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? 'Joining…' : `Join ${preview.org_name}`}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="text-muted-foreground flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-sm">
      {children}
    </main>
  )
}
