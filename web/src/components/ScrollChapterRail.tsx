import { C } from '../lib/theme'

export const STORY_CHAPTERS = [
  { label: 'Arrival', cue: 'A NEW FRONTIER', sceneProgress: 0 },
  { label: 'Convergence', cue: 'TWO FORCES', sceneProgress: 0.35 },
  { label: 'The exchange', cue: 'ONE MARKET', sceneProgress: 0.60 },
  { label: 'Transformation', cue: 'ALWAYS EVOLVING', sceneProgress: 0.82 },
] as const

// A restrained sequence of pigments, mirroring the red/green crystal pair
// and the mineral field. A hand-cut chip marks each chapter, not a UI dot.
const CHAPTER_PIGMENTS = [C.gold, C.red, C.green, C.turquoise] as const

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
          const pigment = CHAPTER_PIGMENTS[index]
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
                  color: '#FFF3DE',
                  opacity: active ? 1 : 0,
                  textShadow: '0 1px 2px rgba(8,22,27,0.96), 0 3px 10px rgba(8,22,27,0.65)',
                }}
              >
                {chapter.label}
              </span>
              <span className="flex items-center gap-2" aria-hidden="true">
                <span
                  className="h-[5px] w-[5px] rotate-45 transition-opacity duration-300"
                  style={{
                    background: active ? pigment : '#E7DBC6',
                    opacity: active ? 1 : 0.6,
                    boxShadow: '0 0 0 1px rgba(255,241,211,0.66), 0 1px 5px rgba(8,22,27,0.7)',
                  }}
                />
                <span
                  className="block h-[2px] transition-all duration-300"
                  style={{
                    width: active ? 30 : 12,
                    background: active ? `linear-gradient(90deg, ${pigment}, ${C.gold})` : 'rgba(255,244,218,0.78)',
                    boxShadow: '0 1px 5px rgba(8,22,27,0.72)',
                  }}
                />
              </span>
            </button>
          )
        })}
        <span
          aria-live="off"
          className="mr-0.5 mt-2 text-[10px] font-medium tracking-[0.16em] tabular-nums"
          style={{ color: '#FFF3DE', textShadow: '0 1px 2px rgba(8,22,27,0.96), 0 3px 8px rgba(8,22,27,0.66)' }}
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
            background: `linear-gradient(90deg, ${C.red}, ${C.gold} 38%, ${C.green} 69%, ${C.turquoise})`,
          }}
        />
      </div>
    </>
  )
}
