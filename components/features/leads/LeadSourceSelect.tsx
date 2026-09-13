import { useId, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  buildLeadSourceOptions,
  LEAD_SOURCE_CREATE_VALUE,
  LEAD_SOURCE_NONE_VALUE,
  resolveLeadSourceInput,
} from '@/lib/lead-source-options'

type LeadSourceSelectProps = {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

export function LeadSourceSelect({
  value,
  onValueChange,
  disabled = false,
}: LeadSourceSelectProps) {
  const inputId = useId()
  const [isCreating, setIsCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const options = useMemo(() => buildLeadSourceOptions(value), [value])

  const cancelCreation = () => {
    setIsCreating(false)
    setDraft('')
    setError(null)
  }

  const confirmCreation = () => {
    const resolved = resolveLeadSourceInput(draft)
    if (!resolved.success) {
      setError(resolved.error)
      return
    }

    onValueChange(resolved.value)
    cancelCreation()
  }

  return (
    <div className="space-y-2">
      <Select
        value={value || LEAD_SOURCE_NONE_VALUE}
        disabled={disabled}
        onValueChange={(nextValue) => {
          if (nextValue === LEAD_SOURCE_CREATE_VALUE) {
            setDraft('')
            setError(null)
            setIsCreating(true)
            return
          }

          cancelCreation()
          onValueChange(nextValue === LEAD_SOURCE_NONE_VALUE ? '' : nextValue)
        }}
      >
        <SelectTrigger aria-label="Origem do lead">
          <SelectValue placeholder="Como conheceu?" />
        </SelectTrigger>
        <SelectContent className="max-h-[220px]">
          <SelectItem value={LEAD_SOURCE_NONE_VALUE}>Não informado</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={LEAD_SOURCE_CREATE_VALUE}>
            <span className="flex items-center gap-2 text-primary">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Criar nova origem
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {isCreating ? (
        <div
          className="rounded-[8px] bg-[var(--app-surface-soft)] p-2.5"
          role="group"
          aria-label="Criar nova origem"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id={inputId}
              value={draft}
              maxLength={80}
              autoComplete="off"
              autoFocus
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${inputId}-error` : undefined}
              placeholder="Ex.: Plantão de vendas"
              onChange={(event) => {
                setDraft(event.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  confirmCreation()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelCreation()
                }
              }}
            />
            <div className="flex gap-2 sm:shrink-0">
              <Button
                type="button"
                size="sm"
                className="h-10 flex-1 rounded-[6px] px-3 text-[12px] font-light shadow-none sm:flex-none"
                disabled={disabled}
                onClick={confirmCreation}
              >
                Usar origem
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 flex-1 rounded-[6px] px-3 text-[12px] font-light shadow-none sm:flex-none"
                disabled={disabled}
                onClick={cancelCreation}
              >
                Cancelar
              </Button>
            </div>
          </div>
          {error ? (
            <p id={`${inputId}-error`} className="mt-1.5 text-xs font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
              A nova origem será gravada quando o lead for salvo.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
