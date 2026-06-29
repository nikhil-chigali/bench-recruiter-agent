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
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <img
        src="/icons/favicon/favicon.svg"
        alt=""
        width={22}
        height={22}
        className="size-[22px] rounded-[6px]"
        style={glow ? { boxShadow: '0 0 0 6px rgba(100,81,230,0.14)' } : undefined}
      />
      <span
        className={`text-[15px] font-semibold tracking-[-0.01em] ${light ? 'text-white' : 'text-foreground'}`}
      >
        Callup
      </span>
    </div>
  )
}
