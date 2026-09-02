/** Skeleton loading placeholders. */

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 p-5 animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
      <div className="h-8 bg-gray-100 rounded w-32 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-20" />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 animate-pulse">
      <div className="w-2 h-2 bg-gray-200 rounded-full" />
      <div className="h-3 bg-gray-100 rounded w-24" />
      <div className="h-3 bg-gray-100 rounded w-16" />
      <div className="flex-1" />
      <div className="h-3 bg-gray-100 rounded w-12" />
    </div>
  )
}

export function OfflineState({ message = "Coordinator is offline" }: { message?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-red-200 p-8 text-center">
      <div className="text-4xl mb-3">📡</div>
      <div className="text-gray-900 font-medium mb-1">{message}</div>
      <div className="text-sm text-gray-400">Check that the coordinator is running and try again.</div>
      <button onClick={() => window.location.reload()}
        className="mt-4 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800">
        Retry
      </button>
    </div>
  )
}
