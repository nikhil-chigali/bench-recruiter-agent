import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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

  const load = useCallback(() => {
    api
      .get<Member[]>('/members')
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [])

  useEffect(() => load(), [load])

  if (!recruiter) return null
  const actorRole = recruiter.role

  async function changeRole(id: string, role: string) {
    try {
      await api.patch(`/members/${id}`, { role })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/members/${id}`)
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
                  <Select value={m.role} onValueChange={(v) => void changeRole(m.id, v)}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="recruiter">recruiter</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => void remove(m.id)}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground text-sm">{m.role}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
