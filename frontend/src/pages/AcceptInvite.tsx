import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { InvitationPreview as Preview } from '@callup/shared-types'
import { ApiError } from '@/lib/http'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BrandMark from '@/components/BrandMark'

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', recruiter: 'Recruiter' }
const ROLE_COLOR: Record<string, string> = {
  owner: '#5b46e0',
  admin: '#1d4ed8',
  recruiter: '#52525b',
}

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { session, signOut } = useAuth()
  const { onboarded, refresh } = useProfile()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let active = true
    api
      .get<Preview>(`/invitations/lookup?token=${encodeURIComponent(token)}`)
      .then((p) => active && setPreview(p))
      .catch(
        (e) =>
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

  // Already part of an org — one person belongs to exactly one org.
  if (onboarded) {
    return (
      <Shell>
        <div className="flex w-[360px] flex-col items-center gap-4 rounded-[16px] border border-border bg-card p-[30px] text-center shadow-[0_4px_24px_rgba(0,0,0,0.05)] [animation:cu-pop_0.3s_ease]">
          <div className="flex size-[46px] items-center justify-center rounded-full border border-border bg-[#f4f4f5] text-[19px] text-[#16a34a]">
            ✓
          </div>
          <div>
            <div className="text-lg font-semibold">You're already part of an organization.</div>
            <div className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
              One person belongs to exactly one org.
            </div>
          </div>
          <Button className="w-full" size="lg" onClick={() => navigate('/')}>
            Go to dashboard
          </Button>
        </div>
      </Shell>
    )
  }

  // Missing token or lookup failure — invalid invite.
  if (!token || loadError) {
    return (
      <Shell>
        <div className="flex w-[360px] flex-col items-center gap-4 rounded-[16px] border border-border bg-card p-[30px] text-center shadow-[0_4px_24px_rgba(0,0,0,0.05)] [animation:cu-pop_0.3s_ease]">
          <div className="flex size-[46px] items-center justify-center rounded-full border border-dashed border-[#cfcfd4] bg-[#fafafa] text-[19px] text-[#a1a1aa]">
            ?
          </div>
          <div>
            <div className="text-lg font-semibold">This invite could not be found.</div>
            <div className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
              The link may be incomplete or missing its token.
            </div>
          </div>
          <Button variant="outline" className="w-full" size="lg" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </div>
      </Shell>
    )
  }

  if (!preview) {
    return <Shell>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </Shell>
  }

  const signedInEmail = session?.user.email ?? ''
  const accepting = preview.status === 'pending' && preview.email_matches
  const orgInitial = (preview.org_name || 'O').charAt(0).toUpperCase()

  // Email mismatch — invite belongs to a different account.
  if (!preview.email_matches) {
    return (
      <Shell>
        <div className="flex w-[360px] flex-col gap-4 rounded-[16px] border border-[#fca5a5] bg-card p-7 shadow-[0_4px_24px_rgba(220,38,38,0.06)] [animation:cu-pop_0.3s_ease]">
          <div className="flex size-[42px] items-center justify-center rounded-[11px] border border-[#fca5a5] bg-[#fef2f2] text-[19px] text-destructive">
            !
          </div>
          <div>
            <div className="text-lg font-semibold text-[#b91c1c]">Wrong account</div>
            <div className="mt-1.5 text-[13.5px] leading-[1.6] text-[#52525b]">
              This invite is for <span className="font-semibold text-foreground">{preview.email}</span>;
              you're signed in as{' '}
              <span className="font-semibold text-foreground">{signedInEmail}</span>.
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              // Leave the invite URL *before* signing out. Otherwise we're still on
              // /accept-invite?token=… when the session clears, RequireAuth bounces to
              // /login carrying this foreign token as `from`, and the next sign-in lands
              // right back on this same wrong-account screen — an inescapable loop.
              navigate('/login', { replace: true })
              await signOut()
            }}
            className="text-left text-[13px] font-medium text-brand"
          >
            Sign out &amp; switch account →
          </button>
        </div>
      </Shell>
    )
  }

  // Not pending — expired / revoked / already accepted.
  if (!accepting) {
    return (
      <Shell>
        <div className="flex w-[360px] flex-col gap-4 rounded-[16px] border border-border bg-card p-7 shadow-[0_4px_24px_rgba(0,0,0,0.05)] [animation:cu-pop_0.3s_ease]">
          <div className="flex size-[42px] items-center justify-center rounded-[11px] border border-[#fcd34d] bg-[#fffbeb] text-[18px] text-[#b45309]">
            ⏱
          </div>
          <div>
            <div className="text-lg font-semibold">
              This invite is <span className="text-[#b45309]">{preview.status}</span>.
            </div>
            <div className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
              Ask your admin to send a fresh link.
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['expired', 'revoked', 'already accepted'].map((t) => (
              <span
                key={t}
                className="rounded-full bg-[#f4f4f5] px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </Shell>
    )
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitError(null)
    setBusy(true)
    try {
      await api.post('/invitations/accept', { token, display_name: name.trim() })
      await refresh()
      navigate('/')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not accept the invite')
    } finally {
      setBusy(false)
    }
  }

  // Happy path — accept and join.
  return (
    <Shell>
      <form
        onSubmit={onSubmit}
        className="flex w-[360px] flex-col gap-[18px] rounded-[16px] border border-border bg-card p-7 shadow-[0_4px_24px_rgba(0,0,0,0.05)] [animation:cu-pop_0.3s_ease]"
      >
        <div className="flex size-[42px] items-center justify-center rounded-[11px] bg-foreground text-[17px] font-semibold text-white">
          {orgInitial}
        </div>
        <div>
          <div className="text-[21px] font-semibold tracking-[-0.015em]">
            Join {preview.org_name}
          </div>
          <div className="mt-1.5 text-sm text-muted-foreground">
            You've been invited as{' '}
            <span className="font-semibold" style={{ color: ROLE_COLOR[preview.role] ?? '#52525b' }}>
              {ROLE_LABEL[preview.role] ?? preview.role}
            </span>
            .
          </div>
        </div>
        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="display_name" className="text-[13px] text-[#3f3f46]">
            Your name
          </Label>
          <Input
            id="display_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="Marco Diaz"
          />
        </div>
        {submitError && <p className="text-[13px] text-destructive">{submitError}</p>}
        <Button type="submit" size="lg" disabled={busy}>
          {busy && (
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          Join {preview.org_name}
        </Button>
      </form>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-svh items-center justify-center p-10">
      <BrandMark className="absolute top-7 left-8" />
      {children}
    </main>
  )
}
