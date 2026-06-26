import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Member } from '@callup/shared-types'
import { useAuth } from '@/lib/auth'
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

export default function DangerZone() {
  const { user, refresh } = useProfile()
  const { signOut } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [transferTo, setTransferTo] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<Member[]>('/members')
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [])

  if (!user) return null
  const others = members.filter((m) => m.id !== user.id)
  const canDelete = confirmName === user.org_name

  async function transfer() {
    setError(null)
    try {
      await api.post('/orgs/transfer-ownership', { user_id: transferTo })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    }
  }

  async function deleteOrg() {
    if (!canDelete) return
    setError(null)
    try {
      await api.delete('/orgs/current')
      await signOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-[14px] border border-[#fca5a5] bg-[#fffbfb] p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] [animation:cu-fade_0.3s_ease]">
      <div>
        <div className="text-[15px] font-semibold text-[#b91c1c]">Danger zone</div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">
          Irreversible actions — owner only.
        </div>
      </div>

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      <div className="flex flex-col gap-[9px]">
        <div className="text-[13.5px] font-semibold">Transfer ownership</div>
        <div className="text-[12.5px] text-muted-foreground">
          Hand the org to another member. You'll become an admin.
        </div>
        <div className="flex max-w-[460px] gap-2">
          <Select value={transferTo} onValueChange={setTransferTo}>
            <SelectTrigger className="h-[38px] flex-1">
              <SelectValue placeholder="Choose a member…" />
            </SelectTrigger>
            <SelectContent>
              {others.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name} ({ROLE_LABEL[m.role] ?? m.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="h-[38px] px-[18px]"
            disabled={!transferTo}
            onClick={() => void transfer()}
          >
            Transfer
          </Button>
        </div>
      </div>

      <div className="h-px bg-[#fde2e2]" />

      <div className="flex flex-col gap-[9px]">
        <div className="text-[13.5px] font-semibold">Delete organization</div>
        <div className="text-[12.5px] text-muted-foreground">
          Type{' '}
          <span className="font-mono font-medium text-foreground">{user.org_name}</span> to
          confirm. This deletes everything.
        </div>
        <div className="flex max-w-[460px] gap-2">
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder="Type organization name…"
            className="h-[38px] flex-1"
          />
          <button
            type="button"
            disabled={!canDelete}
            onClick={() => void deleteOrg()}
            className="h-[38px] rounded-[9px] bg-destructive px-[18px] text-[13.5px] font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:bg-[#fca5a5] disabled:opacity-70"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
