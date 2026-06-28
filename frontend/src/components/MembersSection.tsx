import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Member } from '@callup/shared-types'
import { useProfile } from '@/lib/profile'
import { initialsOf, ROLE_LABEL, ROLE_BADGE } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function canManage(actorRole: string, targetRole: string): boolean {
  if (targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && targetRole === 'recruiter'
}

export default function MembersSection() {
  const { user } = useProfile()
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

  if (!user) return null
  const actorRole = user.role
  // Admins can only grant the recruiter role; owners can grant recruiter or admin.
  const roleOptions = actorRole === 'admin' ? ['recruiter'] : ['recruiter', 'admin']

  function setRole(id: string, role: string, current: string) {
    setPending((p) => {
      const next = { ...p }
      if (role === current) delete next[id]
      else next[id] = role
      return next
    })
  }

  async function confirmRole(id: string) {
    const role = pending[id]
    if (!role) return
    try {
      await api.patch(`/members/${id}`, { role })
      cancelRole(id)
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
    if (!removeTarget || confirmText !== 'remove') return
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
    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)] [animation:cu-fade_0.3s_ease]">
      <div className="flex items-center justify-between border-b border-[#f0f0f1] px-5 py-4">
        <div className="text-[15px] font-semibold">Members</div>
        <div className="font-mono text-[12.5px] text-[#a1a1aa]">{members.length} people</div>
      </div>
      <div className="flex border-b border-[#f0f0f1] bg-[#fafafa] px-5 py-[9px] font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">
        <div className="flex-1">Member</div>
        <div className="w-[230px]">Role</div>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-destructive">{error}</p>}

      {members.map((m) => {
        const manage = canManage(actorRole, m.role)
        const selected = pending[m.id] ?? m.role
        const hasPending = !!pending[m.id] && pending[m.id] !== m.role
        const badge = ROLE_BADGE[m.role] ?? ROLE_BADGE.recruiter
        return (
          <div key={m.id} className="border-b border-[#f4f4f5] last:border-b-0">
            <div className="flex items-center px-5 py-[13px]">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex size-9 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-xs font-semibold text-[#52525b]">
                  {initialsOf(m.name)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-[7px] text-[13.5px] font-semibold">
                    {m.name}
                    {m.id === user.id && (
                      <span className="rounded-[5px] bg-[#f4f4f5] px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#a1a1aa]">{m.email}</div>
                </div>
              </div>
              <div className="flex w-[230px] items-center gap-2">
                {manage ? (
                  <>
                    <Select value={selected} onValueChange={(v) => setRole(m.id, v, m.role)}>
                      <SelectTrigger className="h-[34px] min-w-[118px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      className="h-[34px] px-3 text-destructive hover:border-[#fca5a5] hover:bg-[#fef2f2]"
                      onClick={() => {
                        setConfirmText('')
                        setRemoveTarget(m)
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <span
                    className="rounded-full px-2.5 py-[3px] text-[11.5px] font-medium"
                    style={{ backgroundColor: badge.bg, color: badge.fg }}
                  >
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                )}
              </div>
            </div>

            {hasPending && (
              <div className="mx-5 mb-[13px] flex items-center justify-between rounded-[10px] border border-[#ddd8fb] bg-[#f7f7ff] px-3.5 py-[11px] [animation:cu-fade_0.2s_ease]">
                <div className="text-[13px] text-[#3f3f46]">
                  Change <span className="font-semibold">{m.name}</span> to{' '}
                  <span className="font-semibold text-brand-foreground">
                    {ROLE_LABEL[pending[m.id]] ?? pending[m.id]}
                  </span>
                  ?
                </div>
                <div className="flex gap-2">
                  <Button className="h-[30px] px-3.5 text-[12.5px]" onClick={() => void confirmRole(m.id)}>
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    className="h-[30px] px-3.5 text-[12.5px]"
                    onClick={() => cancelRole(m.id)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null)
            setConfirmText('')
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader className="flex-row items-center gap-3">
            <div className="flex size-[38px] flex-none items-center justify-center rounded-[10px] border border-[#fca5a5] bg-[#fef2f2] text-lg text-destructive">
              !
            </div>
            <div>
              <DialogTitle className="text-base">Remove {removeTarget?.name}?</DialogTitle>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                They'll lose access immediately.
              </p>
            </div>
          </DialogHeader>
          <p className="text-[13px] text-[#52525b]">
            Type{' '}
            <span className="rounded-[5px] bg-[#f4f4f5] px-1.5 py-px font-mono font-medium text-foreground">
              remove
            </span>{' '}
            to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="remove"
            className="font-mono"
          />
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
            <button
              type="button"
              disabled={confirmText !== 'remove'}
              onClick={() => void confirmRemove()}
              className="h-10 rounded-[9px] bg-destructive px-4 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#fca5a5]"
            >
              Remove member
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
