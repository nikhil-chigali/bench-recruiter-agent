import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BrandMark from '@/components/BrandMark'

// Supabase returns this when signing up with an email that already has an account
// (only when email confirmations are off; otherwise signUp resolves silently).
function isAlreadyRegistered(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { message?: string; code?: string }
  if (e.code === 'user_already_exists') return true
  return typeof e.message === 'string' && /already registered|already exists/i.test(e.message)
}

export default function Login() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string; search: string } } | null)?.from
  const redirectTo = from ? `${from.pathname}${from.search}` : '/'
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signup = mode === 'signup'

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        try {
          await signUp(email, password)
        } catch (err) {
          // The auth account can already exist without a finished profile — e.g. someone
          // signed up, then abandoned onboarding (leaving a recruiter-less auth user).
          // Resume that account by signing in so the email isn't permanently stuck.
          if (!isAlreadyRegistered(err)) throw err
          try {
            await signIn(email, password)
          } catch {
            setMode('signin')
            setError('This email is already registered. Please sign in.')
            return
          }
        }
      }
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh">
      {/* Brand panel */}
      <aside className="relative hidden w-[42%] max-w-[520px] flex-col justify-between overflow-hidden bg-[#18181b] p-12 text-white md:flex">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: 'radial-gradient(#27272a 1.2px, transparent 1.2px)',
            backgroundSize: '22px 22px',
          }}
        />
        <BrandMark light glow className="relative" />
        <div className="relative">
          <h1 className="text-[30px] leading-[1.18] font-semibold tracking-[-0.02em] text-balance">
            Bench sales,
            <br />
            on autopilot.
          </h1>
          <p className="mt-4 max-w-[300px] text-sm leading-[1.6] text-[#a1a1aa]">
            Rank Dice jobs against your roster, draft truthful resumes and outreach, and track every
            application to close.
          </p>
          <div className="mt-6 flex gap-2">
            <span className="rounded-full border border-[#3f3f46] px-2.5 py-[5px] font-mono text-[11px] text-[#d4d4d8]">
              No invented facts
            </span>
            <span className="rounded-full border border-[#3f3f46] px-2.5 py-[5px] font-mono text-[11px] text-[#d4d4d8]">
              Verified data only
            </span>
          </div>
        </div>
        <p className="relative font-mono text-[11px] text-[#52525b]">© 2026 Callup</p>
      </aside>

      {/* Auth form */}
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="flex w-[340px] flex-col gap-[18px] [animation:cu-fade_0.4s_ease]">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.015em]">
              {signup ? 'Create account' : 'Sign in'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {signup ? 'Start managing your roster.' : 'Welcome back — enter your details.'}
            </p>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-[7px]">
              <Label htmlFor="email" className="text-[13px] text-[#3f3f46]">
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
              />
            </div>
            <div className="flex flex-col gap-[7px]">
              <Label htmlFor="password" className="text-[13px] text-[#3f3f46]">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete={signup ? 'new-password' : 'current-password'}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="flex items-center gap-1.5 text-[13px] text-destructive">
                <span aria-hidden>⚠</span>
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Spinner />}
              {signup ? 'Sign up' : 'Sign in'}
            </Button>
          </form>
          <p className="text-center text-[13px] text-muted-foreground">
            {signup ? 'Have an account?' : 'No account?'}{' '}
            <button
              type="button"
              className="font-medium text-brand"
              onClick={() => {
                setMode(signup ? 'signin' : 'signup')
                setError(null)
              }}
            >
              {signup ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </div>
      </div>
    </main>
  )
}

function Spinner() {
  return (
    <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  )
}
