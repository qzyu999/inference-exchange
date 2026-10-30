export const STORY_CHAPTERS = [
  { label: 'Arrival', cue: 'A NEW FRONTIER', sceneProgress: 0 },
  { label: 'Convergence', cue: 'TWO FORCES', sceneProgress: 0.35 },
  { label: 'The exchange', cue: 'ONE MARKET', sceneProgress: 0.60 },
  { label: 'Transformation', cue: 'ALWAYS EVOLVING', sceneProgress: 0.82 },
] as const

interface ScrollChapterRailProps {
  activeIndex: number
  onSelect: (index: number) => void
}

export function ScrollChapterRail({ activeIndex, onSelect }: ScrollChapterRailProps) {
  return (
    <>
      <nav
        aria-label="Landing story chapters"
        className="fixed right-5 lg:right-9 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col items-end gap-1"
      >
        {STORY_CHAPTERS.map((chapter, index) => {
          const active = index === activeIndex
          return (
            <button
              key={chapter.label}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={'Chapter ' + (index + 1) + ' of ' + STORY_CHAPTERS.length + ': ' + chapter.label}
              aria-current={active ? 'step' : undefined}
              className="group min-h-11 flex items-center gap-3 py-2 pl-4 pr-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
            >
              <span
                className="text-[10px] font-medium tracking-[0.16em] uppercase transition-opacity duration-300"
                style={{
                  color: '#ffffff',
                  opacity: active ? 1 : 0,
                  textShadow: '0 1px 12px rgba(0,0,0,0.9)',
                }}
              >
                {chapter.label}
              </span>
              <span
                aria-hidden="true"
                className="rounded-full transition-all duration-300"
                style={{
                  width: active ? 32 : 14,
                  height: 2,
                  background: active ? '#F5DCA8' : 'rgba(255,255,255,0.84)',
                  boxShadow: '0 1px 8px rgba(0,0,0,0.85)',
                }}
              />
            </button>
          )
        })}
        <span
          aria-live="off"
          className="mr-0.5 mt-2 text-[10px] font-medium tracking-[0.16em] tabular-nums"
          style={{ color: '#fff', textShadow: '0 1px 12px rgba(0,0,0,0.9)' }}
        >
          {String(activeIndex + 1).padStart(2, '0')} / {String(STORY_CHAPTERS.length).padStart(2, '0')}
        </span>
      </nav>
      <div
        className="pointer-events-none fixed bottom-0 left-0 right-0 h-[2px] z-40 md:hidden"
        aria-hidden="true"
        style={{ background: 'rgba(10,20,28,0.28)' }}
      >
        <div
          className="h-full transition-[width] duration-300"
          style={{
            width: ((activeIndex + 1) / STORY_CHAPTERS.length * 100) + '%',
            background: '#F5DCA8',
          }}
        />
      </div>
    </>
  )
}
