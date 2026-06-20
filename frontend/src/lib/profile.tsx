import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useAuth } from '@/lib/auth'

export type Recruiter = {
  id: string
  email: string
  name: string
  role: string
  org_id: string
  org_name: string
}

type MeResponse = {
  onboarded: boolean
  recruiter: Recruiter | null
}

type ProfileContextValue = {
  loading: boolean
  onboarded: boolean
  recruiter: Recruiter | null
  error: string | null
  refresh: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [onboarded, setOnboarded] = useState(false)
  const [recruiter, setRecruiter] = useState<Recruiter | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await api.get<MeResponse>('/me')
      setOnboarded(me.onboarded)
      setRecruiter(me.recruiter)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await signOut()
        return
      }
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [signOut])

  useEffect(() => {
    if (!session) {
      setLoading(false)
      setOnboarded(false)
      setRecruiter(null)
      setError(null)
      return
    }
    void load()
  }, [session, load])

  return (
    <ProfileContext.Provider value={{ loading, onboarded, recruiter, error, refresh: load }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used within a ProfileProvider')
  return ctx
}
