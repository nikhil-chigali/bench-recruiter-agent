import AppLayout from '@/components/AppLayout'

export default function Candidates() {
  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Candidates</h1>
        <p className="mt-[3px] text-[13.5px] text-muted-foreground">Your bench across the team.</p>
      </div>
    </AppLayout>
  )
}
