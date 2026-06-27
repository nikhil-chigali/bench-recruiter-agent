import { useState } from 'react'

export default function SkillsChipEditor({
  skills,
  onChange,
}: {
  skills: string[]
  onChange: (next: string[]) => void
}) {
  const [skill, setSkill] = useState('')

  function add() {
    const s = skill.trim()
    setSkill('')
    if (!s || skills.includes(s)) return
    onChange([...skills, s])
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-input bg-card p-2">
      {skills.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 rounded-[6px] bg-[#f4f4f5] px-2 py-0.5 text-[12px] text-[#52525b]"
        >
          {s}
          <button
            type="button"
            onClick={() => onChange(skills.filter((x) => x !== s))}
            className="text-[#a1a1aa] hover:text-foreground"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={skill}
        onChange={(e) => setSkill(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
        placeholder="Add a skill…"
        className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none"
      />
    </div>
  )
}
