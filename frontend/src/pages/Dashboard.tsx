import { useState, type ReactNode } from 'react'
import { useProfile } from '@/lib/profile'
import { cn } from '@/lib/utils'
import AppLayout from '@/components/AppLayout'
import MembersSection from '@/components/MembersSection'
import InvitesSection from '@/components/InvitesSection'
import DangerZone from '@/components/DangerZone'

type Tab = 'members' | 'invitations' | 'settings'

export default function Dashboard() {
  const { user } = useProfile()
  const [tab, setTab] = useState<Tab>('members')
  if (!user) return null

  const isManager = user.role === 'owner' || user.role === 'admin'
  const isOwner = user.role === 'owner'
  // Keep the active tab valid for the viewer's role.
  const activeTab: Tab =
    (tab === 'invitations' && !isManager) || (tab === 'settings' && !isOwner) ? 'members' : tab

  return (
    <AppLayout active="team">
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
    </AppLayout>
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
