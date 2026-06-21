import { env } from '@/lib/env'

// Thin fetch wrapper: base URL, JSON, timeout, and a typed error.
// `isNetworkError` distinguishes CORS/connection failures (status 0) from HTTP errors.
export class ApiError extends Error {
  readonly status: number
  readonly isNetworkError: boolean
  readonly body: unknown

  constructor(
    message: string,
    opts: { status: number; isNetworkError?: boolean; body?: unknown },
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status
    this.isNetworkError = opts.isNetworkError ?? false
    this.body = opts.body
  }
}

const DEFAULT_TIMEOUT_MS = 30_000

export type RequestOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const url = path.startsWith('http') ? path : `${env.apiBaseUrl}${path}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network request failed', {
      status: 0,
      isNetworkError: true,
    })
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, {
      status: response.status,
      body: data,
    })
  }

  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
