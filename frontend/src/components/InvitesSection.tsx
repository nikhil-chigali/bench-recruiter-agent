import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { ROLE_LABEL } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Invitation = { id: string; email: string; role: string; status: string; expires_at: string }
type Created = Invitation & { accept_url: string }

export default function InvitesSection() {
  const { recruiter } = useProfile()
  const [invites, setInvites] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('recruiter')
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isOwner = recruiter?.role === 'owner'

  const load = useCallback(() => {
    api
      .get<Invitation[]>('/invitations')
      .then(setInvites)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load invites'))
  }, [])

  useEffect(() => load(), [load])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLastLink(null)
    setCopied(false)
    setBusy(true)
    try {
      const created = await api.post<Created>('/invitations', { email: email.trim(), role })
      setLastLink(created.accept_url)
      setEmail('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invite')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    try {
      await api.delete(`/invitations/${id}`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke invite')
    }
  }

  function copyLink() {
    if (!lastLink) return
    void navigator.clipboard?.writeText(lastLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex flex-col gap-4 [animation:cu-fade_0.3s_ease]">
      {/* Invite a teammate */}
      <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="mb-1 text-[15px] font-semibold">Invite a teammate</div>
        <div className="mb-3.5 text-[13px] text-muted-foreground">
          We generate a one-time link — send it however you like.
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@company.com"
            className="h-[38px] flex-1"
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="h-[38px] min-w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recruiter">Recruiter</SelectItem>
              {isOwner && <SelectItem value="admin">Admin</SelectItem>}
            </SelectContent>
          </Select>
          <Button type="submit" className="h-[38px] px-[18px]" disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
        {!isOwner && (
          <div className="mt-[9px] text-xs text-[#a1a1aa]">Admins can invite recruiters only.</div>
        )}
        {error && <p className="mt-[9px] text-[13px] text-destructive">{error}</p>}
        {lastLink && (
          <div className="mt-3.5 rounded-[10px] border border-border bg-[#fafafa] p-3 [animation:cu-fade_0.25s_ease]">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#3f3f46]">
              <span className="text-[#16a34a]">✓</span>Invite link — shown once, copy it now
            </div>
            <div className="flex gap-2">
              <div className="flex h-9 flex-1 items-center overflow-hidden rounded-lg border border-border bg-card px-[11px] font-mono text-xs text-ellipsis whitespace-nowrap text-[#52525b]">
                {lastLink}
              </div>
              <Button variant="outline" className="h-9 whitespace-nowrap" onClick={copyLink}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Pending invitations */}
      <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        <div className="mb-3.5 text-[15px] font-semibold">Pending invitations</div>
        {invites.length === 0 ? (
          <div className="p-[18px] text-center text-[13px] text-[#a1a1aa]">
            No pending invitations.
          </div>
        ) : (
          invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between border-t border-[#f4f4f5] py-[11px] first:border-t-0"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-full border border-dashed border-[#cfcfd4] bg-[#fafafa] text-[13px] text-[#a1a1aa]">
                  ✉
                </div>
                <div>
                  <div className="text-[13px] font-medium">{i.email}</div>
                  <div className="text-[11.5px] text-[#a1a1aa]">
                    Invited as {ROLE_LABEL[i.role] ?? i.role}
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                className="h-[30px] px-3 text-[12.5px] text-muted-foreground hover:border-[#fca5a5] hover:bg-[#fef2f2] hover:text-destructive"
                onClick={() => void revoke(i.id)}
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
