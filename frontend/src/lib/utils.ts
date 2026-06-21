import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Up to two uppercase initials from a person's name (falls back to "?"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  recruiter: 'Recruiter',
}

/** Badge background/foreground colors per role, matching the hi-fi mockup. */
export const ROLE_BADGE: Record<string, { bg: string; fg: string }> = {
  owner: { bg: '#efedfd', fg: '#5b46e0' },
  admin: { bg: '#eff6ff', fg: '#1d4ed8' },
  recruiter: { bg: '#f4f4f5', fg: '#52525b' },
}
