// Mirrors the backend CandidateCard response (GET /candidates). Local type — the repo has
// no generated shared-types package yet; move here when one lands.
export type CandidateCard = {
  id: string
  name: string
  title: string | null
  status: string
  work_authorization: string | null
  years_experience: number
  location: string | null
  primary_skills: string[]
  recruiter_id: string
  recruiter_name: string
}
