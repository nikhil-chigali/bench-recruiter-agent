import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  const [invites, setInvites] = useState<Invitation[]>([])
  const [role, setRole] = useState('recruiter')
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    setBusy(true)
    const email = String(new FormData(e.currentTarget).get('email')).trim()
    try {
      const created = await api.post<Created>('/invitations', { email, role })
      setLastLink(created.accept_url)
      e.currentTarget.reset()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invite')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    await api.delete(`/invitations/${id}`)
    load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="invite_email">Email</Label>
            <Input id="invite_email" name="email" type="email" required />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recruiter">recruiter</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {lastLink && (
          <div className="flex items-center gap-2 text-sm">
            <Input readOnly value={lastLink} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(lastLink)}
            >
              Copy
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b py-2 text-sm">
              <span>
                {i.email} · {i.role}
              </span>
              <Button variant="outline" size="sm" onClick={() => void revoke(i.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
