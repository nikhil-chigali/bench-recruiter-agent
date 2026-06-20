import { request, type RequestOptions } from '@/lib/http'
import { supabase } from '@/lib/supabase'

// The app's single API entry point. Injects the Supabase bearer token automatically —
// never thread auth tokens through component props.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const auth = await authHeaders()
  return request<T>(path, {
    ...options,
    method,
    body,
    headers: { ...auth, ...options.headers },
  })
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => send<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    send<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    send<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    send<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => send<T>('DELETE', path, undefined, options),
}
