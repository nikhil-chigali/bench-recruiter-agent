import { env } from '@/lib/env'
import { supabase } from '@/lib/supabase'

// Fetch-based SSE reader for the live apply session. EventSource can't attach an
// Authorization header, so we read the stream manually and inject the Supabase bearer.
export type SseMessage = { event: string; data: string }

export async function subscribe(
  path: string,
  onMessage: (message: SseMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const url = path.startsWith('http') ? path : `${env.apiBaseUrl}${path}`

  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  })
  if (!response.body) {
    throw new Error('SSE response has no body')
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      onMessage(parseEvent(raw))
      boundary = buffer.indexOf('\n\n')
    }
  }
}

function parseEvent(raw: string): SseMessage {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  return { event, data: dataLines.join('\n') }
}
