import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { initialsOf, ROLE_BADGE, ROLE_LABEL } from '@/lib/utils'
import { CANDIDATE_STATUS_ORDER, statusStyle } from '@/lib/candidateStatus'
import { clearDraft, hasDraft, loadDraft } from '@/lib/candidateDraft'
import type { CandidateCard as Candidate, CandidateDetail, Member } from '@callup/shared-types'
import AppLayout from '@/components/AppLayout'
import { Button } from '@/components/ui/button'
import CandidateCard from '@/components/CandidateCard'
import CandidateDrawer from '@/components/CandidateDrawer'

type Group = { id: string | null; name: string; role: string; candidates: Candidate[] }
type View = 'list' | 'grid'
const VIEW_KEY = 'callup_candidates_view'

function loadView(): View {
  return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
}

export default function Candidates() {
  const { user } = useProfile()
  const isManager = user?.role === 'owner' || user?.role === 'admin'

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [recruiter, setRecruiter] = useState<string>('all')
  const [view, setView] = useState<View>(loadView)
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [draftPresent, setDraftPresent] = useState(hasDraft)
  const [draftName] = useState(() => loadDraft()?.name.trim() ?? '')
  const navigate = useNavigate()

  function openCandidate(c: Candidate) {
    setSelected(c)
    setDrawerError(null)
    setDrawerOpen(true)
  }

  async function changeStatus(next: string) {
    const current = selected
    if (!current || next === current.status) return
    if (statusUpdating) return
    setDrawerError(null)
    setStatusUpdating(true)
    // Optimistic: reflect the new status immediately in the roster and the drawer.
    setCandidates((cs) => cs.map((x) => (x.id === current.id ? { ...x, status: next } : x)))
    setSelected((s) => (s && s.id === current.id ? { ...s, status: next } : s))
    try {
      const updated = await api.patch<CandidateDetail>(`/candidates/${current.id}`, { status: next })
      setCandidates((cs) => cs.map((x) => (x.id === updated.id ? updated : x)))
      setSelected((s) => (s && s.id === updated.id ? updated : s))
    } catch (e) {
      // Roll the one candidate back to its pre-change value and surface the error.
      setCandidates((cs) => cs.map((x) => (x.id === current.id ? current : x)))
      setSelected((s) => (s && s.id === current.id ? current : s))
      setDrawerError(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusUpdating(false)
    }
  }

  useEffect(() => {
    // Managers also load members so every recruiter shows as a group, even with an empty bench.
    // `ignore` prevents an earlier in-flight fetch from stomping state if isManager flips before
    // the first Promise.all resolves (e.g. mount run with isManager=false resolves after the
    // re-run triggered by isManager flipping true).
    let ignore = false
    async function run() {
      if (!ignore) setLoading(true)
      const membersReq = isManager ? api.get<Member[]>('/members') : Promise.resolve<Member[]>([])
      try {
        const [cs, ms] = await Promise.all([api.get<Candidate[]>('/candidates'), membersReq])
        if (!ignore) {
          setCandidates(cs)
          setMembers(ms)
          setError(null)
        }
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : 'Failed to load candidates')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void run()
    return () => { ignore = true }
  }, [isManager])

  function chooseView(v: View) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  // Recruiter dropdown lists the recruiter-role members (assignees), so one with an empty
  // bench is still selectable.
  const recruiterOptions = useMemo(
    () => members.filter((m) => m.role === 'recruiter').map((m) => ({ id: m.id, name: m.name })),
    [members],
  )

  // Pipeline: recruiter filter (managers) -> search -> counts -> status filter -> group.
  const afterRecruiter = useMemo(
    () =>
      isManager && recruiter !== 'all'
        ? candidates.filter((c) => c.recruiter_id === recruiter)
        : candidates,
    [candidates, isManager, recruiter],
  )

  const afterSearch = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return afterRecruiter
    return afterRecruiter.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.title ?? '').toLowerCase().includes(q) ||
        c.primary_skills.some((s) => s.toLowerCase().includes(q)),
    )
  }, [afterRecruiter, search])

  const counts = useMemo<Record<string, number>>(() => {
    const by: Record<string, number> = { on_bench: 0, interviewing: 0, placed: 0 }
    for (const c of afterSearch) by[c.status] = (by[c.status] ?? 0) + 1
    return { all: afterSearch.length, ...by }
  }, [afterSearch])

  const visible = useMemo(
    () => (status === 'all' ? afterSearch : afterSearch.filter((c) => c.status === status)),
    [afterSearch, status],
  )

  const grouped = isManager && recruiter === 'all'
  const filtered = search.trim() !== '' || status !== 'all'

  // Grouped view: a group for every recruiter-role member (empty included), plus any other
  // member who actually owns a visible candidate — so nothing is ever orphaned.
  const groups = useMemo<Group[]>(() => {
    if (!grouped) return [{ id: null, name: '', role: '', candidates: visible }]
    const memberById = new Map(members.map((m) => [m.id, m]))
    const byId = new Map<string, Group>()
    for (const m of members) {
      if (m.role === 'recruiter') byId.set(m.id, { id: m.id, name: m.name, role: m.role, candidates: [] })
    }
    for (const c of visible) {
      let g = byId.get(c.recruiter_id)
      if (!g) {
        const m = memberById.get(c.recruiter_id)
        g = { id: c.recruiter_id, name: m?.name ?? c.recruiter_name, role: m?.role ?? 'recruiter', candidates: [] }
        byId.set(c.recruiter_id, g)
      }
      g.candidates.push(c)
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [grouped, members, visible])

  if (!user) return null

  const statusTabs: Array<{ key: string; label: string; dot?: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.all },
    ...CANDIDATE_STATUS_ORDER.map((token) => ({
      key: token,
      label: statusStyle(token).label,
      dot: statusStyle(token).dot,
      count: counts[token] ?? 0,
    })),
  ]

  // Big empty state only when there is genuinely nothing to render: a flat view with no
  // candidates, or a grouped view with no recruiter groups at all.
  const showBigEmpty = grouped ? groups.length === 0 : groups[0].candidates.length === 0

  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        {draftPresent && (
          <div className="mb-4 flex items-center justify-between rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-2.5 text-[13px]">
            <span className="text-[#92400e]">
              {draftName ? (
                <>
                  You have an unsaved draft for <span className="font-medium">{draftName}</span>.
                </>
              ) : (
                'You have an unsaved candidate draft.'
              )}
            </span>
            <div className="flex items-center gap-3">
              <Button type="button" size="sm" onClick={() => navigate('/candidates/new')}>
                Continue editing
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearDraft()
                  setDraftPresent(false)
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        )}
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Candidates</h1>
            <p className="mt-[3px] text-[13.5px] text-muted-foreground">
              {isManager ? 'Your bench across the team.' : 'Your bench — candidates assigned to you.'}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3 text-[13px] text-[#a1a1aa]">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or skill…"
                className="h-[38px] w-[230px] rounded-[9px] border border-input bg-card pr-3 pl-[30px] text-[13.5px]"
              />
            </div>
            <button
              type="button"
              onClick={() => navigate('/candidates/new')}
              className="h-[38px] rounded-[9px] bg-brand px-4 text-[13px] font-medium text-white hover:opacity-90"
            >
              + Add candidate
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <div className="inline-flex gap-[3px] rounded-[10px] bg-[#f0f0f1] p-[3px]">
            {statusTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                className={`inline-flex items-center gap-[7px] rounded-[7px] px-[13px] py-[7px] text-[13px] font-medium transition-all ${
                  status === t.key
                    ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'text-muted-foreground'
                }`}
              >
                {t.dot && <span className="size-[7px] rounded-full" style={{ background: t.dot }} />}
                {t.label}
                <span className="font-mono text-[10.5px] text-[#a1a1aa]">{t.count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-[9px]">
            {isManager && (
              <select
                value={recruiter}
                onChange={(e) => setRecruiter(e.target.value)}
                className="h-9 min-w-[150px] rounded-[9px] border border-input bg-card px-3 text-[13px]"
              >
                <option value="all">All recruiters</option>
                {recruiterOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <div className="inline-flex gap-[3px] rounded-[9px] bg-[#f0f0f1] p-[3px]">
              <button
                type="button"
                title="List view"
                onClick={() => chooseView('list')}
                className={`flex h-[30px] w-[34px] items-center justify-center rounded-md text-[13px] transition-all ${
                  view === 'list' ? 'bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-[#a1a1aa]'
                }`}
              >
                ☰
              </button>
              <button
                type="button"
                title="Grid view"
                onClick={() => chooseView('grid')}
                className={`flex h-[30px] w-[34px] items-center justify-center rounded-md text-[13px] transition-all ${
                  view === 'grid' ? 'bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-[#a1a1aa]'
                }`}
              >
                ▦
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-[1140px] px-9 pt-[18px] pb-12">
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        {loading && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}

        {!loading && !error && showBigEmpty && (
          <div className="rounded-[14px] border border-dashed border-input bg-card p-12 text-center">
            <div className="text-[15px] font-semibold">
              {filtered ? 'No candidates match' : 'No candidates yet'}
            </div>
            <div className="mt-[5px] text-[13px] text-muted-foreground">
              {filtered
                ? 'Try a different status or search term.'
                : 'Candidates you add will appear here.'}
            </div>
          </div>
        )}

        {!loading && !error && !showBigEmpty && (
          <div className="flex flex-col gap-[22px]">
            {groups.map((g) => {
              const badge = ROLE_BADGE[g.role] ?? ROLE_BADGE.recruiter
              return (
                <div key={g.id ?? 'flat'}>
                  {grouped && (
                    <div className="mb-[11px] flex items-center gap-[9px]">
                      <div className="flex size-6 items-center justify-center rounded-full border border-border bg-[#f4f4f5] text-[9.5px] font-semibold text-[#52525b]">
                        {initialsOf(g.name)}
                      </div>
                      <span className="text-[13.5px] font-semibold">{g.name}</span>
                      <span
                        className="rounded-full px-[9px] py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: badge.bg, color: badge.fg }}
                      >
                        {ROLE_LABEL[g.role] ?? 'Recruiter'}
                      </span>
                      <span className="font-mono text-[11px] text-[#a1a1aa]">
                        {g.candidates.length}{' '}
                        {g.candidates.length === 1 ? 'candidate' : 'candidates'}
                      </span>
                    </div>
                  )}

                  {g.candidates.length === 0 ? (
                    <div className="rounded-[14px] border border-border bg-card px-4 py-4 text-[13px] text-[#a1a1aa]">
                      {filtered ? 'No matches.' : 'No candidates assigned.'}
                    </div>
                  ) : view === 'list' ? (
                    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                      <div className="flex border-b border-[#f0f0f1] bg-[#fafafa] px-[18px] py-[9px] font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">
                        <div className="flex-1">Candidate</div>
                        <div className="w-[74px]">Work auth</div>
                        <div className="w-[52px]">Exp</div>
                        <div className="w-[150px]">Location</div>
                        <div className="w-[120px]">Status</div>
                      </div>
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="list" onClick={() => openCandidate(c)} />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="grid" onClick={() => openCandidate(c)} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <CandidateDrawer
        candidate={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onStatusChange={changeStatus}
        onOpenProfile={() => selected && navigate(`/candidates/${selected.id}`)}
        error={drawerError}
        statusUpdating={statusUpdating}
      />
    </AppLayout>
  )
}
