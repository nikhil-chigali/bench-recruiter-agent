import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Member = { id: string; name: string; email: string; role: string }

function canManage(actorRole: string, targetRole: string): boolean {
  if (targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && targetRole === 'recruiter'
}

export default function MembersSection() {
  const { recruiter } = useProfile()
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const load = useCallback(() => {
    api
      .get<Member[]>('/members')
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [])

  useEffect(() => load(), [load])

  if (!recruiter) return null
  const actorRole = recruiter.role

  async function confirmRole(id: string) {
    const role = pending[id]
    if (!role) return
    try {
      await api.patch(`/members/${id}`, { role })
      setPending((p) => {
        const next = { ...p }
        delete next[id]
        return next
      })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
    }
  }

  function cancelRole(id: string) {
    setPending((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
  }

  async function confirmRemove() {
    if (!removeTarget) return
    try {
      await api.delete(`/members/${removeTarget.id}`)
      setRemoveTarget(null)
      setConfirmText('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && <p className="text-destructive text-sm">{error}</p>}
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-4 border-b py-2">
            <div className="text-sm">
              <div className="font-medium">{m.name}</div>
              <div className="text-muted-foreground">{m.email}</div>
            </div>
            <div className="flex items-center gap-2">
              {canManage(actorRole, m.role) ? (
                <>
                  <Select
                    value={pending[m.id] ?? m.role}
                    onValueChange={(v) => setPending((p) => ({ ...p, [m.id]: v }))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="recruiter">recruiter</SelectItem>
                    </SelectContent>
                  </Select>
                  {pending[m.id] && pending[m.id] !== m.role ? (
                    <>
                      <Button size="sm" onClick={() => void confirmRole(m.id)}>
                        Confirm
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => cancelRole(m.id)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmText('')
                        setRemoveTarget(m)
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground text-sm">{m.role}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null)
            setConfirmText('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              This permanently removes {removeTarget?.name} ({removeTarget?.email}) and deletes
              their login account. This cannot be undone. Type <span className="font-mono">remove</span>{' '}
              to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemoveTarget(null)
                setConfirmText('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-destructive text-destructive"
              disabled={confirmText !== 'remove'}
              onClick={() => void confirmRemove()}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
