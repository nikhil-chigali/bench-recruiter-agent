type BrandMarkProps = {
  /** Render the wordmark in white (for use on the dark login panel). */
  light?: boolean
  /** Add the soft glow ring around the dot (login hero). */
  glow?: boolean
  className?: string
}

/** The Callup logo: a brand-purple dot followed by the wordmark. */
export default function BrandMark({ light = false, glow = false, className }: BrandMarkProps) {
  return (
    <div className={`flex items-center gap-[9px] ${className ?? ''}`}>
      <span
        className="size-[10px] rounded-full bg-brand"
        style={glow ? { boxShadow: '0 0 0 5px rgba(100,81,230,0.18)' } : undefined}
      />
      <span
        className={`text-[15px] font-semibold tracking-[-0.01em] ${light ? 'text-white' : 'text-foreground'}`}
      >
        Callup
      </span>
    </div>
  )
}
