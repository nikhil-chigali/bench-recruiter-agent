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

import type { Me, User } from '@callup/shared-types'

// Re-exported so `@/lib/profile` stays the import site for `User` across the app.
export type { User }

type ProfileState = {
  loading: boolean
  onboarded: boolean
  user: User | null
  error: string | null
}

type ProfileContextValue = ProfileState & {
  refresh: () => Promise<void>
}

const RESET_STATE: ProfileState = {
  loading: false,
  onboarded: false,
  user: null,
  error: null,
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading, signOut } = useAuth()
  const [state, setState] = useState<ProfileState>({
    loading: true,
    onboarded: false,
    user: null,
    error: null,
  })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const me = await api.get<Me>('/me')
      setState({ loading: false, onboarded: me.onboarded, user: me.user, error: null })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await signOut()
        return
      }
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load profile',
      }))
    }
  }, [signOut])

  useEffect(() => {
    // Wait for the initial auth resolution before deciding anything. `session` is
    // transiently null while Supabase restores it on a cold load; acting on that
    // null would flip `loading` to false and bounce a deep link through
    // RequireOnboarded before the profile fetch even starts.
    if (authLoading) return
    if (!session) {
      setState(RESET_STATE)
      return
    }
    void load()
  }, [authLoading, session, load])

  return (
    <ProfileContext.Provider value={{ ...state, refresh: load }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used within a ProfileProvider')
  return ctx
}
