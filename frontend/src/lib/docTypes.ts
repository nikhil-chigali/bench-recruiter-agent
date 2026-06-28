// The candidate compliance document types (mirrors backend DocumentType). Used by the wizard
// Documents step and the profile Documents editor for the type <select> and badge labels.
export const DOC_TYPES = [
  { value: 'residency_proof', label: 'Residency proof' },
  { value: 'visa_proof', label: 'Visa proof' },
  { value: 'i94', label: 'I-94' },
  { value: 'other', label: 'Other' },
] as const

export function docTypeLabel(value: string): string {
  return DOC_TYPES.find((d) => d.value === value)?.label ?? value
}
