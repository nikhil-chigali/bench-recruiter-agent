import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import BrandMark from '@/components/BrandMark'

export default function Onboarding() {
  const navigate = useNavigate()
  const { loading, onboarded, refresh } = useProfile()
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (onboarded) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api.post('/orgs', { org_name: orgName.trim(), display_name: name.trim() })
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

  const orgPreview = orgName.trim() || 'Your organization'
  const orgInitial = (orgName.trim() || 'O').charAt(0).toUpperCase()

  return (
    <main className="relative flex min-h-svh items-center justify-center p-10">
      <BrandMark className="absolute top-7 left-8" />
      <form
        onSubmit={onSubmit}
        className="flex w-[400px] flex-col gap-5 rounded-[16px] border border-border bg-card p-7 shadow-[0_4px_24px_rgba(0,0,0,0.05)] [animation:cu-pop_0.35s_ease]"
      >
        <div className="flex items-center gap-2.5 font-mono text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 text-[#16a34a]">
            <span className="flex size-4 items-center justify-center rounded-full bg-[#16a34a] text-[10px] text-white">
              ✓
            </span>
            Account
          </span>
          <span className="h-px flex-1 bg-border" />
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] text-white">
              2
            </span>
            Workspace
          </span>
        </div>

        <div>
          <h1 className="text-[21px] font-semibold tracking-[-0.015em]">Set up your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your organization to get started.
          </p>
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
            placeholder="Dana Reyes"
          />
        </div>
        <div className="flex flex-col gap-[7px]">
          <Label htmlFor="org_name" className="text-[13px] text-[#3f3f46]">
            Organization name
          </Label>
          <Input
            id="org_name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            maxLength={120}
            placeholder="Northstar Staffing"
          />
        </div>

        <div className="flex items-center gap-[11px] rounded-[10px] border border-[#f0f0f1] bg-[#fafafa] p-3">
          <div className="flex size-[34px] items-center justify-center rounded-[9px] bg-foreground text-sm font-semibold text-white">
            {orgInitial}
          </div>
          <div>
            <div className="text-[13.5px] font-semibold">{orgPreview}</div>
            <div className="text-xs text-[#a1a1aa]">You'll be the owner</div>
          </div>
        </div>

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        <Button type="submit" size="lg" disabled={busy}>
          {busy && (
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          Create workspace
        </Button>
      </form>
    </main>
  )
}
