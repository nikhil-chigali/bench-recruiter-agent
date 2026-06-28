export default function EditActions({
  addLabel,
  onAdd,
  onCancel,
  onSave,
  saving,
  error,
}: {
  addLabel: string
  onAdd: () => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
  error: string | null
}) {
  // Pinned to the viewport bottom while editing so Save/Cancel stay reachable as the
  // form grows; the negative margins make it span flush to the card's rounded bottom.
  return (
    <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-col gap-2 rounded-b-[14px] border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
        >
          {addLabel}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-[8px] border border-input bg-card px-3 py-1.5 text-[12.5px] hover:bg-[#f4f4f5] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-[8px] bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
