const OUTCOMES = {
  completed: { label: 'Completed', group: 'completed', tone: 'success' },
  matched: { label: 'Routed · completion unconfirmed', group: 'routed', tone: 'warning' },
  matched_from_queue: { label: 'Routed from queue · completion unconfirmed', group: 'routed', tone: 'warning' },
  no_compatible_provider: { label: 'No compatible provider', group: 'rejected', tone: 'danger' },
  no_provider_available: { label: 'No provider online', group: 'rejected', tone: 'danger' },
  model_not_available: { label: 'Model unavailable', group: 'rejected', tone: 'danger' },
  queue_full: { label: 'Queue full', group: 'rejected', tone: 'danger' },
  queue_timeout: { label: 'Queue timed out', group: 'rejected', tone: 'danger' },
}

export function requestOutcome(status) {
  return Object.hasOwn(OUTCOMES, status) ? OUTCOMES[status] : {
    label: typeof status === 'string' && status ? status.replace(/_/g, ' ') : 'Unknown outcome',
    group: 'other',
    tone: 'muted',
  }
}
