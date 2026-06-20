import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
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

type Member = { id: string; name: string; email: string; role: string }

export default function DangerZone() {
  const { recruiter, refresh } = useProfile()
  const [members, setMembers] = useState<Member[]>([])
  const [transferTo, setTransferTo] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Member[]>('/members').then(setMembers).catch(() => undefined)
  }, [])

  if (!recruiter) return null
  const others = members.filter((m) => m.id !== recruiter.id)

  async function transfer() {
    setError(null)
    try {
      await api.post('/orgs/transfer-ownership', { recruiter_id: transferTo })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    }
  }

  async function deleteOrg() {
    setError(null)
    try {
      await api.delete('/orgs/current')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex flex-col gap-2">
          <Label>Transfer ownership</Label>
          <div className="flex items-center gap-2">
            <Select value={transferTo} onValueChange={setTransferTo}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {others.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!transferTo} onClick={() => void transfer()}>
              Transfer
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm_name">
            Delete organization — type <span className="font-mono">{recruiter.org_name}</span> to
            confirm
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="confirm_name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
            <Button
              variant="outline"
              className="border-destructive text-destructive"
              disabled={confirmName !== recruiter.org_name}
              onClick={() => void deleteOrg()}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
