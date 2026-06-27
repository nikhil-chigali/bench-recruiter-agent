import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { initialsOf } from '@/lib/utils'
import { useProfile } from '@/lib/profile'
import type { CandidateDetail, CandidateUpdate, Member } from '@callup/shared-types'
import AppLayout from '@/components/AppLayout'
import CandidateLoadError from '@/components/CandidateLoadError'
import CandidateStatusChanger from '@/components/CandidateStatusChanger'
import OverviewEditor, { type OverviewDraft } from '@/components/profile/OverviewEditor'
import Section from '@/components/profile/Section'
import ExperienceEditor from '@/components/profile/ExperienceEditor'
import EducationEditor from '@/components/profile/EducationEditor'
import ProjectEditor from '@/components/profile/ProjectEditor'
import CertificationEditor from '@/components/profile/CertificationEditor'

const NAV = [
  { id: 'summary', label: 'Summary' },
  { id: 'experience', label: 'Experience' },
  { id: 'education', label: 'Education' },
  { id: 'projects', label: 'Projects' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'documents', label: 'Documents' },
]

function ProfileLinks({ detail }: { detail: CandidateDetail }) {
  const links: Array<{ label: string; href: string }> = []
  if (detail.linkedin_url) links.push({ label: 'LinkedIn', href: detail.linkedin_url })
  if (detail.github_url) links.push({ label: 'GitHub', href: detail.github_url })
  if (detail.portfolio_url) links.push({ label: 'Portfolio', href: detail.portfolio_url })
  if (detail.email) links.push({ label: detail.email, href: `mailto:${detail.email}` })
  if (links.length === 0 && !detail.phone) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="text-[#5b46e0] hover:underline"
        >
          {l.label}
        </a>
      ))}
      {detail.phone && <span className="text-[#71717a]">{detail.phone}</span>}
    </div>
  )
}

export default function CandidateProfile() {
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<CandidateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const { user } = useProfile()
  const isManager = user?.role === 'owner' || user?.role === 'admin'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<OverviewDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])

  // Managers load all org members for the reassign select (any member can be an assignee, incl.
  // the current one who may be an owner/admin). Inline-async + ignore flag so the effect body
  // sets no state synchronously — satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!isManager) return
    let ignore = false
    api
      .get<Member[]>('/members')
      .then((ms) => {
        if (!ignore) setMembers(ms.map((m) => ({ id: m.id, name: m.name })))
      })
      .catch(() => {
        if (!ignore) setMembers([])
      })
    return () => {
      ignore = true
    }
  }, [isManager])

  const errors = useMemo(() => {
    const e: { name?: string; title?: string } = {}
    if (draft && !draft.name.trim()) e.name = 'Name is required'
    if (draft && !draft.title.trim()) e.title = 'Title is required'
    return e
  }, [draft])

  function startEdit() {
    if (!detail) return
    setDraft({
      name: detail.name,
      title: detail.title ?? '',
      primary_skills: detail.primary_skills,
      work_authorization: detail.work_authorization ?? '',
      location: detail.location ?? '',
      summary: detail.summary ?? '',
      user_id: detail.recruiter_id,
    })
    setShowErrors(false)
    setSaveError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setShowErrors(false)
    setSaveError(null)
  }

  function updateDraft(patch: Partial<OverviewDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  async function save() {
    if (!draft || !detail) return
    if (!draft.name.trim() || !draft.title.trim()) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    setSaveError(null)
    const payload: CandidateUpdate = {
      name: draft.name.trim(),
      title: draft.title.trim(),
      primary_skills: draft.primary_skills,
      work_authorization: draft.work_authorization || null,
      location: draft.location.trim() || null,
      summary: draft.summary.trim() || null,
    }
    if (isManager && draft.user_id && draft.user_id !== detail.recruiter_id) {
      payload.user_id = draft.user_id
    }
    try {
      const updated = await api.patch<CandidateDetail>(`/candidates/${detail.id}`, payload)
      setDetail(updated)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!id) return
    let ignore = false
    async function load() {
      if (!ignore) setLoading(true)
      try {
        const d = await api.get<CandidateDetail>(`/candidates/${id}`)
        if (!ignore) {
          setDetail(d)
          setError(null)
          setErrorStatus(null)
        }
      } catch (e) {
        if (!ignore) {
          setErrorStatus(e instanceof ApiError ? e.status : null)
          if (e instanceof ApiError && (e.status === 404 || e.status === 403))
            setError('Candidate not found.')
          else setError(e instanceof Error ? e.message : 'Failed to load candidate')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => { ignore = true }
  }, [id, reloadKey])

  const retry = () => setReloadKey((k) => k + 1)

  async function changeStatus(next: string) {
    if (!detail || next === detail.status || statusUpdating) return
    const prev = detail.status
    setStatusError(null)
    setStatusUpdating(true)
    setDetail((d) => (d ? { ...d, status: next } : d))
    try {
      const updated = await api.patch<CandidateDetail>(`/candidates/${detail.id}`, { status: next })
      setDetail(updated)
    } catch (e) {
      setDetail((d) => (d ? { ...d, status: prev } : d))
      setStatusError(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusUpdating(false)
    }
  }

  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[22px] pb-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link to="/candidates" className="hover:text-foreground">
              Candidates
            </Link>
            <span className="text-[#d4d4d8]">/</span>
            <span className="text-foreground">{detail?.name ?? (error ? id : '…')}</span>
            {editing && (
              <span className="ml-1 rounded-[5px] border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-[#b45309]">
                EDITING
              </span>
            )}
          </div>
          {error && !loading && (
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[#ef4444]" />
              {errorStatus === 404 || errorStatus === 403 || errorStatus === 422
                ? 404
                : (errorStatus || 'offline')}
            </div>
          )}
          {detail && !loading && !error && (
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-[9px] border border-input bg-card px-3.5 py-1.5 text-[13px] hover:bg-[#f4f4f5] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="rounded-[9px] bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-[9px] border border-input bg-card px-3.5 py-1.5 text-[13px] hover:bg-[#f4f4f5]"
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>

        {loading && <p className="mt-6 text-[13px] text-muted-foreground">Loading…</p>}
        {error && !loading && (
          <CandidateLoadError
            candidateId={id}
            notFound={errorStatus === 404 || errorStatus === 403 || errorStatus === 422}
            status={errorStatus}
            message={error}
            onRetry={retry}
          />
        )}

        {detail && !loading && !error && (
          <>
            {!editing && (
            <div className="mt-5 flex items-start gap-4">
              <div className="flex size-14 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-[17px] font-semibold text-[#52525b]">
                {initialsOf(detail.name)}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{detail.name}</h1>
                <div className="text-[14px] text-muted-foreground">{detail.title ?? '—'}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[#71717a]">
                  <span className="font-mono text-[#52525b]">{detail.work_authorization ?? '—'}</span>
                  <span className="text-[#d4d4d8]">·</span>
                  <span>{detail.years_experience}y</span>
                  <span className="text-[#d4d4d8]">·</span>
                  <span>{detail.location ?? '—'}</span>
                  <span className="text-[#d4d4d8]">·</span>
                  <span>{detail.recruiter_name}</span>
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                <CandidateStatusChanger
                  status={detail.status}
                  onChange={changeStatus}
                  disabled={statusUpdating}
                />
                {statusError && <span className="text-[11.5px] text-destructive">{statusError}</span>}
              </div>
            </div>
            )}

            {editing && draft && (
              <div className="mt-5">
                <OverviewEditor
                  draft={draft}
                  update={updateDraft}
                  years={detail.years_experience}
                  isManager={isManager}
                  members={members}
                  errors={showErrors ? errors : {}}
                />
                {saveError && <p className="mt-3 text-[13px] text-destructive">{saveError}</p>}
              </div>
            )}

            <nav className="mt-6 flex flex-wrap gap-1 border-b border-border pb-3">
              {NAV.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="rounded-[7px] px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-[#f0f0f1] hover:text-foreground"
                >
                  {n.label}
                </a>
              ))}
            </nav>

            <div className="mt-6 flex flex-col gap-7">
              {!editing && (
              <Section id="summary" title="Summary">
                {detail.summary ? (
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-[#3f3f46]">
                    {detail.summary}
                  </p>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No summary added.</p>
                )}
                {detail.primary_skills.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1">
                    {detail.primary_skills.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <ProfileLinks detail={detail} />
              </Section>
              )}

              <ExperienceEditor
                id="experience"
                candidateId={detail.id}
                items={detail.experience}
                canEdit={!editing}
                onSaved={setDetail}
              />
              <EducationEditor
                id="education"
                candidateId={detail.id}
                items={detail.education}
                canEdit={!editing}
                onSaved={setDetail}
              />
              <ProjectEditor
                id="projects"
                candidateId={detail.id}
                items={detail.projects}
                canEdit={!editing}
                onSaved={setDetail}
              />
              <CertificationEditor
                id="certifications"
                candidateId={detail.id}
                items={detail.certifications}
                canEdit={!editing}
                onSaved={setDetail}
              />
              <Section id="documents" title="Documents">
                <p className="text-[13px] text-muted-foreground">
                  Document uploads arrive in a later update.
                </p>
              </Section>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
