import type { Transaction, OwnedProviderNode } from './api'
export function recentBilledRequests(rows: Transaction[]): Transaction[]
export function providerHomeSummary(nodes: OwnedProviderNode[]): { total: number; available: number; offline: number }
