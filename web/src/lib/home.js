/** A bounded owner-ledger view. Do not treat these rows as all request outcomes. */
export function recentBilledRequests(rows) {
  return [...rows].sort((a, b) => b.timestamp - a.timestamp || String(b.full_request_id || b.request_id).localeCompare(String(a.full_request_id || a.request_id))).slice(0, 5)
}
export function providerHomeSummary(nodes) {
  return { total: nodes.length, available: nodes.filter(node => node.status === 'online' || node.status === 'busy').length, offline: nodes.filter(node => node.status === 'offline').length }
}
