export function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </svg>
  )
}

export function OfferComputeIcon({ className }: { className?: string }) {
  // Use the selected Untitled UI asset from its publisher, without redistributing it.
  const image = 'url("https://cdn.prod.website-files.com/6365d860c7b7a7191055eb8a/69ab9bf38699e5f36a162e59_server-03.svg")'
  return (
    <span className={className} aria-hidden="true" style={{
      display: 'inline-block', width: 18, height: 18,
      backgroundColor: 'currentColor',
      maskImage: image, WebkitMaskImage: image,
      maskSize: 'contain', WebkitMaskSize: 'contain',
      maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
      maskPosition: 'center', WebkitMaskPosition: 'center',
    }} />
  )
}
