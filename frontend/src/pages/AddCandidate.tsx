import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import type { CandidateCreate, CandidateDetail, Member } from '@callup/shared-types'
import { EMPTY_DRAFT, clearDraft, loadDraft, saveDraft, type CandidateDraft } from '@/lib/candidateDraft'
import AppLayout from '@/components/AppLayout'
import WizardStepper from '@/components/wizard/WizardStepper'
import BasicsStep from '@/components/wizard/BasicsStep'
import ExperienceStep from '@/components/wizard/ExperienceStep'
import EducationStep from '@/components/wizard/EducationStep'
import ProjectsCertsStep from '@/components/wizard/ProjectsCertsStep'
import DocumentsStep from '@/components/wizard/DocumentsStep'
import ReviewStep from '@/components/wizard/ReviewStep'

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'experience', label: 'Experience' },
  { key: 'education', label: 'Education' },
  { key: 'projects', label: 'Projects & certs' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review & create' },
]

// <input type="month"> gives "YYYY-MM"; the API wants a date, so anchor to the first of the month.
function monthToDate(m: string): string | null {
  return m ? `${m}-01` : null
}

function toPayload(d: CandidateDraft, isManager: boolean): CandidateCreate {
  return {
    name: d.name.trim(),
    title: d.title.trim(),
    primary_skills: d.primary_skills,
    work_authorization: d.work_authorization || null,
    location: d.location || null,
    email: d.email || null,
    phone: d.phone || null,
    user_id: isManager && d.user_id ? d.user_id : null,
    experience: d.experience
      .filter((e) => e.company.trim())
      .map((e) => ({
        company: e.company.trim(),
        position: e.position.trim() || null,
        start_date: monthToDate(e.start_date),
        end_date: monthToDate(e.end_date),
      })),
    education: d.education
      .filter((e) => e.university.trim())
      .map((e) => ({ university: e.university.trim(), degree: e.degree.trim() || null })),
    projects: d.projects
      .filter((p) => p.title.trim())
      .map((p) => ({
        title: p.title.trim(),
        project_link: p.project_link.trim() || null,
        github_link: p.github_link.trim() || null,
      })),
    certifications: d.certifications
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), issued_by: c.issued_by.trim() || null })),
  }
}

export default function AddCandidate() {
  const { user } = useProfile()
  const isManager = user?.role === 'owner' || user?.role === 'admin'
  const navigate = useNavigate()

  const [draft, setDraft] = useState<CandidateDraft>(() => loadDraft() ?? EMPTY_DRAFT)
  const [step, setStep] = useState(0)
  const [recruiters, setRecruiters] = useState<{ id: string; name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  // Autosave on every change (saveDraft clears the key when the draft is empty).
  useEffect(() => {
    saveDraft(draft)
  }, [draft])

  // Managers load recruiter members for the assignee select.
  useEffect(() => {
    if (!isManager) return
    let ignore = false
    api
      .get<Member[]>('/members')
      .then((ms) => {
        if (!ignore)
          setRecruiters(ms.filter((m) => m.role === 'recruiter').map((m) => ({ id: m.id, name: m.name })))
      })
      .catch(() => {
        if (!ignore) setRecruiters([])
      })
    return () => {
      ignore = true
    }
  }, [isManager])

  function update(patch: Partial<CandidateDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  const errors = useMemo(() => {
    const e: { name?: string; title?: string } = {}
    if (!draft.name.trim()) e.name = 'Name is required'
    if (!draft.title.trim()) e.title = 'Title is required'
    return e
  }, [draft.name, draft.title])

  const basicsValid = !errors.name && !errors.title

  function goNext() {
    if (step === 0 && !basicsValid) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  function goBack() {
    setStep((s) => Math.max(s - 1, 0))
  }
  function saveAndExit() {
    saveDraft(draft)
    navigate('/candidates')
  }

  async function create() {
    if (!basicsValid) {
      setStep(0)
      setShowErrors(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await api.post<CandidateDetail>('/candidates', toPayload(draft, isManager))
      clearDraft()
      navigate(`/candidates/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create candidate')
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return null

  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1000px] px-9 pt-[22px] pb-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link to="/candidates" className="hover:text-foreground">
              Candidates
            </Link>
            <span className="text-[#d4d4d8]">/</span>
            <span className="text-foreground">New candidate</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#a1a1aa]">Draft saved automatically</span>
            <button type="button" onClick={saveAndExit} className="text-[13px] text-[#5b46e0] hover:underline">
              Save &amp; exit
            </button>
          </div>
        </div>

        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">Add candidate</h1>

        <div className="mt-6 flex gap-8">
          <WizardStepper
            steps={STEPS}
            current={step}
            onJump={(i) => {
              if (i === 0 || basicsValid) setStep(i)
            }}
          />

          <div className="min-w-0 flex-1">
            {step === 0 && <BasicsStep draft={draft} update={update} errors={showErrors ? errors : {}} />}
            {step === 1 && <ExperienceStep draft={draft} update={update} />}
            {step === 2 && <EducationStep draft={draft} update={update} />}
            {step === 3 && <ProjectsCertsStep draft={draft} update={update} />}
            {step === 4 && <DocumentsStep />}
            {step === 5 && <ReviewStep draft={draft} update={update} isManager={isManager} recruiters={recruiters} />}

            {error && <p className="mt-4 text-[13px] text-destructive">{error}</p>}

            <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
              <button
                type="button"
                onClick={goBack}
                disabled={step === 0}
                className="rounded-[9px] border border-input bg-card px-4 py-2 text-[13px] hover:bg-[#f4f4f5] disabled:opacity-40"
              >
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-[9px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
                >
                  Save &amp; continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={create}
                  disabled={submitting}
                  className="rounded-[9px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create candidate'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
