import { useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { cn, initialsOf, ROLE_LABEL, ROLE_BADGE } from '@/lib/utils'
import MembersSection from '@/components/MembersSection'
import InvitesSection from '@/components/InvitesSection'
import DangerZone from '@/components/DangerZone'

type Tab = 'members' | 'invitations' | 'settings'

export default function Dashboard() {
  const { signOut } = useAuth()
  const { recruiter } = useProfile()
  const [tab, setTab] = useState<Tab>('members')
  if (!recruiter) return null

  const isManager = recruiter.role === 'owner' || recruiter.role === 'admin'
  const isOwner = recruiter.role === 'owner'
  // Keep the active tab valid for the viewer's role.
  const activeTab: Tab =
    (tab === 'invitations' && !isManager) || (tab === 'settings' && !isOwner) ? 'members' : tab

  const badge = ROLE_BADGE[recruiter.role] ?? ROLE_BADGE.recruiter

  return (
    <div className="flex min-h-svh bg-background">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-svh w-[236px] flex-none flex-col border-r border-border bg-sidebar px-3.5 py-[18px]">
        <div className="flex items-center gap-[9px] px-2 pt-1 pb-[18px]">
          <span className="size-[9px] rounded-full bg-brand" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{recruiter.org_name}</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2.5 rounded-lg bg-[#f4f4f5] px-2.5 py-2 text-[13.5px] font-medium">
            <span className="size-[15px] rounded bg-brand" />
            Team
          </span>
          {['Candidates', 'Jobs', 'Applications'].map((item) => (
            <span
              key={item}
              className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[13.5px] text-[#a1a1aa]"
            >
              <span className="flex items-center gap-2.5">
                <span className="size-[15px] rounded border-[1.5px] border-dashed border-[#d4d4d8]" />
                {item}
              </span>
              <span className="rounded-[5px] bg-[#f4f4f5] px-1.5 py-0.5 font-mono text-[9px] text-[#a1a1aa]">
                SOON
              </span>
            </span>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-[#f0f0f1] pt-3">
          <div className="flex size-[34px] items-center justify-center rounded-full border border-border bg-[#f4f4f5] text-xs font-semibold text-[#52525b]">
            {initialsOf(recruiter.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{recruiter.name}</div>
            <div className="text-[11.5px] font-medium" style={{ color: badge.fg }}>
              {ROLE_LABEL[recruiter.role] ?? recruiter.role}
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

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="w-full max-w-[860px] px-9 pt-[26px]">
          <div className="mb-5">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Team</h1>
            <p className="mt-[3px] text-[13.5px] text-muted-foreground">
              Manage who's in your workspace.
            </p>
          </div>
          <div className="inline-flex gap-[3px] rounded-[10px] bg-[#f0f0f1] p-[3px]">
            <TabButton active={activeTab === 'members'} onClick={() => setTab('members')}>
              Members
            </TabButton>
            {isManager && (
              <TabButton active={activeTab === 'invitations'} onClick={() => setTab('invitations')}>
                Invitations
              </TabButton>
            )}
            {isOwner && (
              <TabButton active={activeTab === 'settings'} onClick={() => setTab('settings')}>
                Settings
              </TabButton>
            )}
          </div>
        </div>

        <div className="w-full max-w-[860px] px-9 pt-5 pb-12">
          {activeTab === 'members' && <MembersSection />}
          {activeTab === 'invitations' && isManager && <InvitesSection />}
          {activeTab === 'settings' && isOwner && <DangerZone />}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[7px] px-4 py-[7px] text-[13px] font-medium transition-all',
        active ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  )
}
