import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { initialsOf } from '@/lib/utils'
import type { CandidateCard, CandidateDetail } from '@callup/shared-types'
import AppLayout from '@/components/AppLayout'
import CandidateStatusChanger from '@/components/CandidateStatusChanger'
import Section from '@/components/profile/Section'
import ExperienceSection from '@/components/profile/ExperienceSection'
import EducationSection from '@/components/profile/EducationSection'
import ProjectsSection from '@/components/profile/ProjectsSection'
import CertificationsSection from '@/components/profile/CertificationsSection'

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
  const navigate = useNavigate()
  const [detail, setDetail] = useState<CandidateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

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
        }
      } catch (e) {
        if (!ignore) {
          if (e instanceof ApiError && e.status === 404) setError('Candidate not found.')
          else setError(e instanceof Error ? e.message : 'Failed to load candidate')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => { ignore = true }
  }, [id])

  async function changeStatus(next: string) {
    if (!detail || next === detail.status || statusUpdating) return
    const prev = detail.status
    setStatusError(null)
    setStatusUpdating(true)
    setDetail((d) => (d ? { ...d, status: next } : d))
    try {
      const updated = await api.patch<CandidateCard>(`/candidates/${detail.id}`, { status: next })
      setDetail((d) => (d ? { ...d, status: updated.status } : d))
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
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link to="/candidates" className="hover:text-foreground">
            Candidates
          </Link>
          <span className="text-[#d4d4d8]">/</span>
          <span className="text-foreground">{detail?.name ?? '…'}</span>
        </div>

        {loading && <p className="mt-6 text-[13px] text-muted-foreground">Loading…</p>}
        {error && !loading && (
          <div className="mt-6">
            <p className="text-[13px] text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/candidates')}
              className="mt-2 text-[13px] text-[#5b46e0] hover:underline"
            >
              ← Back to candidates
            </button>
          </div>
        )}

        {detail && !loading && !error && (
          <>
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

              <Section id="experience" title="Experience">
                <ExperienceSection items={detail.experience} />
              </Section>
              <Section id="education" title="Education">
                <EducationSection items={detail.education} />
              </Section>
              <Section id="projects" title="Projects">
                <ProjectsSection items={detail.projects} />
              </Section>
              <Section id="certifications" title="Certifications">
                <CertificationsSection items={detail.certifications} />
              </Section>
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
