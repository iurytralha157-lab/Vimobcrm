import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCreateLeadSource, useLeadSources } from '@/hooks/use-lead-sources'
import {
  DEFAULT_LEAD_SOURCE_OPTIONS,
  resolveLeadSourceInput,
} from '@/lib/lead-source-options'
import { searchTextEquals, searchTextIncludes } from '@/lib/search-text'
import { cn } from '@/lib/utils'

type LeadSourceOption = {
  value: string
  label: string
}

type LeadSourceSelectProps = {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

// Same search + list + "criar" popup used by Tags and the DDI picker, so the
// three fields feel like one component. Custom origins are org-scoped
// (public.lead_sources) — see useLeadSources / useCreateLeadSource.
export function LeadSourceSelect({
  value,
  onValueChange,
  disabled = false,
}: LeadSourceSelectProps) {
  const { data: customSources = [] } = useLeadSources()
  const createLeadSource = useCreateLeadSource()

  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Ref for the scrollable options list — lets us attach a native wheel listener
  // in the capture phase so the Popover's document-level handlers never swallow it
  // (mirrors InternationalPhoneInput's country list and TagSelector).
  const scrollListRef = useRef<HTMLDivElement>(null)

  // Built-in options + this organization's custom lead sources + (if editing
  // a lead) its current value, deduplicated by normalized label.
  const options = useMemo<LeadSourceOption[]>(() => {
    const seen = new Set<string>()
    const merged: LeadSourceOption[] = []

    const add = (option: LeadSourceOption) => {
      const key = option.label.trim().toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      merged.push(option)
    }

    DEFAULT_LEAD_SOURCE_OPTIONS.forEach(add)
    customSources.forEach((source) => add({ value: source.name, label: source.name }))

    const trimmedValue = value?.trim()
    if (trimmedValue) add({ value: trimmedValue, label: trimmedValue })

    return merged
  }, [customSources, value])

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options
    return options.filter((option) => searchTextIncludes(option.label, searchTerm))
  }, [options, searchTerm])

  const trimmedSearch = searchTerm.trim()
  const existingMatch = trimmedSearch
    ? options.find((option) => searchTextEquals(option.label, trimmedSearch)) || null
    : null

  const selectedOption = options.find((option) => option.value === value) || null

  const selectOption = (option: LeadSourceOption | null) => {
    onValueChange(option?.value ?? '')
    setSearchTerm('')
    setError(null)
    setOpen(false)
  }

  const handleCreate = async () => {
    if (existingMatch) {
      selectOption(existingMatch)
      return
    }

    const resolved = resolveLeadSourceInput(searchTerm)
    if (!resolved.success) {
      setError(resolved.error)
      return
    }
    setError(null)

    if (!resolved.isCustom) {
      selectOption({ value: resolved.value, label: resolved.label })
      return
    }

    setIsCreating(true)
    try {
      const created = await createLeadSource.mutateAsync({ name: resolved.label })
      selectOption({ value: created.name, label: created.name })
    } catch {
      // Error handled by the mutation's own toast — keep the popup open to retry.
    } finally {
      setIsCreating(false)
    }
  }

  // Focus input when popover opens; reset search when it closes.
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
    if (!open) {
      setSearchTerm('')
      setError(null)
    }
  }, [open])

  // Attach a native wheel listener (capture phase, passive) so the scroll works
  // on Windows even when the Popover has document-level capture listeners.
  useEffect(() => {
    if (!open) return
    const el = scrollListRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation()
    }

    el.addEventListener('wheel', handleWheel, { passive: true, capture: false })
    return () => el.removeEventListener('wheel', handleWheel, { capture: false })
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Origem do lead"
          aria-expanded={open}
          disabled={disabled}
          className="flex h-10 w-full items-center justify-between rounded-md border-0 bg-[var(--app-surface-soft)] px-3 text-sm font-normal text-[var(--app-text-primary)] hover:bg-[var(--app-surface-soft)]"
        >
          <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
            {selectedOption ? selectedOption.label : 'Não informado'}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {/* Search input — same treatment as the DDI and Tags search boxes */}
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              aria-label="Buscar ou criar origem"
              placeholder="Buscar ou criar origem..."
              value={searchTerm}
              maxLength={80}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && trimmedSearch) {
                  event.preventDefault()
                  handleCreate()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setOpen(false)
                }
              }}
              className="h-8 py-1 pl-8 text-sm"
            />
          </div>
          {error ? (
            <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">{error}</p>
          ) : null}
        </div>

        {/* Options list — native scroll, same fix as the DDI country list so the
            wheel works on Windows even inside the Popover */}
        <div
          ref={scrollListRef}
          className="max-h-48 overflow-y-auto overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="p-2 space-y-1">
            <button
              type="button"
              onClick={() => selectOption(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                !value && 'bg-accent'
              )}
            >
              <span className="flex-1 truncate text-muted-foreground">Não informado</span>
              {!value && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
            </button>

            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectOption(option)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                  value === option.value && 'bg-accent'
                )}
              >
                <span className="flex-1 truncate">{option.label}</span>
                {value === option.value && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
              </button>
            ))}

            {filteredOptions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3 px-2">
                Nenhuma origem encontrada
              </p>
            )}
          </div>
        </div>

        {/* Create new origin — fixed footer, same pattern as Tags' "Criar nova tag" */}
        <div className="shrink-0 rounded-b-md border-t border-[var(--app-border)] bg-popover p-1">
          <button
            type="button"
            onClick={() => {
              if (existingMatch) {
                selectOption(existingMatch)
                return
              }
              if (trimmedSearch) {
                handleCreate()
              } else {
                inputRef.current?.focus()
              }
            }}
            disabled={isCreating}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-primary transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            {isCreating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {trimmedSearch && !existingMatch ? <>Criar &quot;{trimmedSearch}&quot;</> : 'Criar nova origem'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
