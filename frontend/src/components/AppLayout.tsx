import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { initialsOf, ROLE_LABEL, ROLE_BADGE } from '@/lib/utils'

type NavKey = 'team' | 'candidates' | 'jobs' | 'applications'

export default function AppLayout({
  active,
  children,
}: {
  active: NavKey
  children: ReactNode
}) {
  const { signOut } = useAuth()
  const { user } = useProfile()
  if (!user) return null

  const badge = ROLE_BADGE[user.role] ?? ROLE_BADGE.recruiter

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 flex h-svh w-[236px] flex-none flex-col border-r border-border bg-sidebar px-3.5 py-[18px]">
        <div className="flex items-center gap-[9px] px-2 pt-1 pb-[18px]">
          <span className="size-[9px] rounded-full bg-brand" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{user.org_name}</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          <NavItem to="/" label="Team" active={active === 'team'} />
          <NavItem to="/candidates" label="Candidates" active={active === 'candidates'} />
          <SoonItem label="Jobs" />
          <SoonItem label="Applications" />
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-[#f0f0f1] pt-3">
          <div className="flex size-[34px] items-center justify-center rounded-full border border-border bg-[#f4f4f5] text-xs font-semibold text-[#52525b]">
            {initialsOf(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{user.name}</div>
            <div className="text-[11.5px] font-medium" style={{ color: badge.fg }}>
              {ROLE_LABEL[user.role] ?? user.role}
            </div>
          </div>
          <button
            type="button"
            title="Sign out"
            onClick={() => void signOut()}
            className="flex size-[30px] items-center justify-center rounded-lg border border-border bg-card text-[13px] text-muted-foreground hover:bg-[#f4f4f5]"
          >
            ⏻
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  if (active) {
    return (
      <Link
        to={to}
        className="flex items-center gap-2.5 rounded-lg bg-[#f4f4f5] px-2.5 py-2 text-[13.5px] font-medium"
      >
        <span className="size-[15px] rounded bg-brand" />
        {label}
      </Link>
    )
  }
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-[#71717a] hover:bg-[#f4f4f5]"
    >
      <span className="size-[15px] rounded border-[1.5px] border-[#d4d4d8]" />
      {label}
    </Link>
  )
}

function SoonItem({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13.5px] text-[#a1a1aa]">
      <span className="flex items-center gap-2.5">
        <span className="size-[15px] rounded border-[1.5px] border-dashed border-[#d4d4d8]" />
        {label}
      </span>
      <span className="rounded-[5px] bg-[#f4f4f5] px-1.5 py-0.5 font-mono text-[9px] text-[#a1a1aa]">
        SOON
      </span>
    </span>
  )
}
