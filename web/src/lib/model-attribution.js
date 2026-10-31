// Legacy model is a routing request, not evidence of execution.
export function requestedModelLabel(tx) {
  return tx?.requested_model || tx?.model || 'unknown'
}
export function servedModelLabel(tx) {
  if (typeof tx?.served_model === 'string' && tx.served_model.trim()) return tx.served_model
  return requestedModelLabel(tx) === 'default'
    ? 'Auto-routed · served model not recorded'
    : 'Served model not recorded'
}
