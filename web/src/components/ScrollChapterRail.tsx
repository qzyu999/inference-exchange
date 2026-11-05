import { HERO_PIGMENTS as HP } from '../lib/theme'

// The final extended gust runs from the last reading pose to 1.
export const STORY_CHAPTERS = [
  { label: 'Inference Exchange', sceneProgress: 0 },
  { label: 'Supply meets demand', sceneProgress: 0.12 },
  { label: 'Community-driven action', sceneProgress: 0.35 },
  { label: 'OCIP', sceneProgress: 0.60 },
  { label: 'Distributed AI inference', sceneProgress: 0.82 },
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
        className="absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col items-end"
      >
        {STORY_CHAPTERS.map((chapter, index) => {
          const active = index === activeIndex
          return (
            <button
              key={chapter.label}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`Chapter ${index + 1} of ${STORY_CHAPTERS.length}: ${chapter.label}`}
              aria-current={active ? 'step' : undefined}
              className="flex h-8 w-11 items-center justify-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
            >
              <span
                aria-hidden="true"
                className="block h-[3px] rounded-full transition-all duration-300"
                style={{
                  width: active ? 24 : 10,
                  background: active ? HP.orpiment : HP.silk,
                  opacity: active ? 1 : 0.7,
                  boxShadow: '0 1px 4px rgba(43,34,72,0.8)',
                }}
              />
            </button>
          )
        })}
      </nav>
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] z-40 md:hidden"
        aria-hidden="true"
        style={{ background: 'rgba(16,45,109,0.35)' }}
      >
        <div
          className="h-full transition-[width] duration-300"
          style={{
            width: ((activeIndex + 1) / STORY_CHAPTERS.length * 100) + '%',
            background: HP.orpiment,
          }}
        />
      </div>
    </>
  )
}
