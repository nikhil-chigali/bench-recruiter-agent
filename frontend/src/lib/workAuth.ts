// Mirrors callup.db.enums.WorkAuthorization (validated server-side). value = stored token.
export const WORK_AUTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'USC', label: 'US Citizen' },
  { value: 'GC', label: 'Green Card' },
  { value: 'GC_EAD', label: 'GC-EAD' },
  { value: 'H1B', label: 'H-1B' },
  { value: 'OPT', label: 'OPT' },
  { value: 'STEM_OPT', label: 'STEM OPT' },
  { value: 'L2_EAD', label: 'L2-EAD' },
  { value: 'TN', label: 'TN' },
  { value: 'OTHER', label: 'Other' },
]
