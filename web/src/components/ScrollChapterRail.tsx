interface Chapter {
  label: string
  progress: number
}

const CHAPTERS: Chapter[] = [
  { label: 'Arrival', progress: 0 },
  { label: 'Convergence', progress: 0.20 },
  { label: 'The exchange', progress: 0.48 },
  { label: 'Transformation', progress: 0.77 },
]

interface ScrollChapterRailProps {
  progress: number
  onSelect: (progress: number) => void
}

export function ScrollChapterRail({ progress, onSelect }: ScrollChapterRailProps) {
  const current = CHAPTERS.reduce(
    (active, chapter, index) => progress >= chapter.progress - 0.01 ? index : active,
    0,
  )

  return (
    <>
      <aside
        aria-label="Landing story chapters"
        className="fixed right-4 lg:right-8 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col items-end gap-2"
      >
        {CHAPTERS.map((chapter, index) => {
          const active = index === current
          return (
            <button
              key={chapter.label}
              type="button"
              onClick={() => onSelect(chapter.progress)}
              aria-label={'Jump to chapter ' + (index + 1) + ': ' + chapter.label}
              aria-current={active ? 'step' : undefined}
              className="group min-h-11 flex items-center gap-3 py-2 pl-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
            >
              <span
                className="text-[11px] tracking-wide opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                style={{ color: '#f5f1e6', textShadow: '0 1px 8px #0b111a' }}
              >
                {chapter.label}
              </span>
              <span
                aria-hidden="true"
                className="h-1 rounded-full transition-all"
                style={{
                  width: active ? 30 : 14,
                  background: active ? '#F3D99D' : 'rgba(245,241,230,0.7)',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.6)',
                }}
              />
            </button>
          )
        })}
        <span
          role="progressbar"
          aria-label="Landing story progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="text-[11px] tabular-nums pr-1"
          style={{ color: '#f5f1e6', textShadow: '0 1px 8px #0b111a' }}
        >
          {Math.round(progress * 100)}%
        </span>
      </aside>
      <div
        className="fixed bottom-0 left-0 right-0 h-1 z-40 md:hidden pointer-events-none"
        aria-hidden="true"
        style={{ background: 'rgba(10,20,28,0.3)' }}
      >
        <div className="h-full" style={{ width: (progress * 100) + '%', background: '#F3D99D' }} />
      </div>
    </>
  )
}
