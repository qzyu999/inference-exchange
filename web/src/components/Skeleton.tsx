/** Skeleton loading placeholders. */

export function SkeletonCard() {
  return (
    <div className="bg-ui-surface rounded-2xl border border-ui-border p-5 animate-pulse">
      <div className="h-3 bg-ui-track rounded w-24 mb-3" />
      <div className="h-8 bg-ui-track rounded w-32 mb-2" />
      <div className="h-3 bg-ui-track rounded w-20" />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 animate-pulse">
      <div className="w-2 h-2 bg-ui-track rounded-full" />
      <div className="h-3 bg-ui-track rounded w-24" />
      <div className="h-3 bg-ui-track rounded w-16" />
      <div className="flex-1" />
      <div className="h-3 bg-ui-track rounded w-12" />
    </div>
  )
}

export function OfflineState({ message = "Coordinator is offline" }: { message?: string }) {
  return (
    <div className="bg-ui-surface rounded-2xl border border-ui-danger p-8 text-center">
      <div className="text-4xl mb-3">📡</div>
      <div className="text-ui-text font-medium mb-1">{message}</div>
      <div className="text-sm text-ui-muted">Check that the coordinator is running and try again.</div>
      <button onClick={() => window.location.reload()}
        className="mt-4 px-4 py-2 bg-ui-action text-ui-on-action rounded-xl text-sm font-medium hover:bg-ui-hover">
        Retry
      </button>
    </div>
  )
}
