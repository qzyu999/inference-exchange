import { useMemo } from 'react'
import { ModelSearch, type ModelSearchItem } from './ModelSearch'

interface ChatModelPickerProps {
  models: string[]
  value: string
  onChange: (model: string) => void
  providerCounts?: Record<string, number>
  disabled?: boolean
  loading?: boolean
}

/**
 * Chat-only adapter to the SAME ModelSearch used by Exchange.
 * Unlike Exchange discovery, this list contains only /v1/models online IDs.
 */
export function ChatModelPicker({
  models, value, onChange, providerCounts = {}, disabled = false, loading = false,
}: ChatModelPickerProps) {
  const items = useMemo<ModelSearchItem[]>(() => models.map(id => ({
    key: id, name: id, group: 'Available now',
    subtitle: providerCounts[id] > 0
      ? providerCounts[id] + ' connected ' + (providerCounts[id] === 1 ? 'provider' : 'providers')
      : 'Available via Inference Exchange',
  })), [models, providerCounts])

  return (
    <ModelSearch
      items={items}
      value={value}
      onChange={onChange}
      label="Search online models"
      placeholder="Search models (e.g. qwen, llama)"
      selectedLabel="Choose an online model"
      emptyMessage="No models online"
      className="w-full sm:w-[340px]"
      disabled={disabled}
      loading={loading}
    />
  )
}
