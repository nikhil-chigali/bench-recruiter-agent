// The wizard's working form, persisted to localStorage so a half-finished candidate
// survives a refresh. Dates are "YYYY-MM" strings (from <input type="month">); they are
// converted to first-of-month ISO dates at submit time.
export type ExperienceDraft = {
  company: string
  position: string
  start_date: string
  end_date: string
  description: string[]
  tech_stack: string[]
}
export type EducationDraft = {
  university: string
  degree: string
  location: string
  cgpa: string
  coursework: string
  start_date: string
  end_date: string
}
export type ProjectDraft = {
  title: string
  project_link: string
  github_link: string
  description: string[]
  tech_stack: string[]
}
export type CertificationDraft = {
  name: string
  issued_by: string
  issued_on: string
  badge_url: string
  verification_url: string
}

export type CandidateDraft = {
  name: string
  title: string
  primary_skills: string[]
  work_authorization: string
  location: string
  email: string
  phone: string
  linkedin_url: string
  github_url: string
  portfolio_url: string
  summary: string
  user_id: string // assignee (managers only); '' means assign to self
  experience: ExperienceDraft[]
  education: EducationDraft[]
  projects: ProjectDraft[]
  certifications: CertificationDraft[]
}

export const EMPTY_DRAFT: CandidateDraft = {
  name: '',
  title: '',
  primary_skills: [],
  work_authorization: '',
  location: '',
  email: '',
  phone: '',
  linkedin_url: '',
  github_url: '',
  portfolio_url: '',
  summary: '',
  user_id: '',
  experience: [],
  education: [],
  projects: [],
  certifications: [],
}

const KEY = 'callup_candidate_draft'

// The assignee (user_id) alone does not make a draft "real" — only entered candidate data does.
export function isDraftEmpty(d: CandidateDraft): boolean {
  return (
    !d.name &&
    !d.title &&
    d.primary_skills.length === 0 &&
    !d.work_authorization &&
    !d.location &&
    !d.email &&
    !d.phone &&
    !d.linkedin_url &&
    !d.github_url &&
    !d.portfolio_url &&
    !d.summary &&
    d.experience.length === 0 &&
    d.education.length === 0 &&
    d.projects.length === 0 &&
    d.certifications.length === 0
  )
}

export function loadDraft(): CandidateDraft | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CandidateDraft>
    return { ...EMPTY_DRAFT, ...parsed }
  } catch {
    return null
  }
}

export function saveDraft(d: CandidateDraft): void {
  if (isDraftEmpty(d)) {
    localStorage.removeItem(KEY)
    return
  }
  localStorage.setItem(KEY, JSON.stringify(d))
}

export function clearDraft(): void {
  localStorage.removeItem(KEY)
}

export function hasDraft(): boolean {
  const d = loadDraft()
  return d != null && !isDraftEmpty(d)
}
