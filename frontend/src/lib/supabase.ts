import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

// Email auth only — no Google sign-in / SSO providers (see frontend/CLAUDE.md).
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey)
