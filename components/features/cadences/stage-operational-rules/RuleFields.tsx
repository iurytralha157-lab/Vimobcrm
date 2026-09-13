'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import {
  type DurationUnit,
  MAX_OPERATIONAL_RULE_MINUTES,
  SELECT_ITEM_CLASS_NAME,
  durationUnitFor,
  formatDurationValue,
} from './model'

export function DurationField({
  id,
  label,
  minutes,
  minMinutes,
  disabled,
  onChange,
  ariaLabel,
}: {
  id: string
  label: string
  minutes: number
  minMinutes: number
  disabled: boolean
  onChange: (minutes: number) => void
  ariaLabel?: string
}) {
  const [unit, setUnit] = useState<DurationUnit>(() => durationUnitFor(minutes))
  const divisor = unit === 'days' ? 1_440 : 60
  const accessibleLabel = ariaLabel || label

  return (
    <Field label={label} htmlFor={id}>
      <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={minMinutes / divisor}
          max={MAX_OPERATIONAL_RULE_MINUTES / divisor}
          step="any"
          value={formatDurationValue(minutes, unit)}
          aria-label={accessibleLabel}
          disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            if (!Number.isFinite(value)) return
            onChange(Math.min(
              MAX_OPERATIONAL_RULE_MINUTES,
              Math.max(minMinutes, Math.round(value * divisor)),
            ))
          }}
          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
        />
        <Select
          value={unit}
          disabled={disabled}
          onValueChange={(nextUnit: DurationUnit) => setUnit(nextUnit)}
        >
          <SelectTrigger
            aria-label={`Unidade de ${accessibleLabel.toLowerCase()}`}
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
            <SelectItem value="hours" className={SELECT_ITEM_CLASS_NAME}>Horas</SelectItem>
            <SelectItem value="days" className={SELECT_ITEM_CLASS_NAME}>Dias</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Field>
  )
}

export function OptionalDurationField({
  id,
  label,
  minutes,
  defaultMinutes,
  minMinutes = 0,
  disabled,
  onChange,
}: {
  id: string
  label: string
  minutes: number | undefined
  defaultMinutes: number
  minMinutes?: number
  disabled: boolean
  onChange: (minutes: number | undefined) => void
}) {
  const enabled = minutes != null

  return (
    <div className="space-y-1.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <Label htmlFor={`${id}-enabled`} className="text-[11px] font-light text-[var(--app-text-secondary)]">
          {label}
        </Label>
        <Switch
          id={`${id}-enabled`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? defaultMinutes : undefined)}
          aria-label={`${enabled ? 'Desativar' : 'Ativar'} ${label.toLowerCase()}`}
        />
      </div>
      {enabled ? (
        <DurationField
          id={id}
          label=""
          minutes={minutes}
          minMinutes={minMinutes}
          disabled={disabled}
          onChange={onChange}
          ariaLabel={label}
        />
      ) : (
        <div className="flex h-9 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[11px] font-light text-[var(--app-text-tertiary)]">
          Sem aviso
        </div>
      )}
    </div>
  )
}

export function ToggleRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs font-light text-[var(--app-text-primary)]">
          {title}
        </Label>
        <p className="mt-0.5 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <Label
          htmlFor={htmlFor}
          className="text-[11px] font-light text-[var(--app-text-secondary)]"
        >
          {label}
        </Label>
      )}
      {children}
    </div>
  )
}

export function AccentIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)]">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  )
}

export function IconButton({
  label,
  disabled,
  onClick,
  icon: Icon,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  icon: LucideIcon
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 rounded-[6px] text-[var(--app-text-tertiary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </Button>
  )
}

export function EmptyRuleState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-3.5',
        className,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-xs font-light text-[var(--app-text-primary)]">{title}</p>
        <p className="mt-1 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
    </div>
  )
}

export function LifecycleLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" strokeWidth={1.5} />
      <span className="text-[11px] font-light leading-[17px] text-[var(--app-text-secondary)]">
        {text}
      </span>
    </div>
  )
}

export function RulesSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando regras da etapa" aria-busy="true">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32 rounded-[6px]" />
          <Skeleton className="h-3 w-72 max-w-full rounded-[6px]" />
        </div>
        <Skeleton className="h-7 w-24 rounded-[6px]" />
      </div>
      {[220, 280, 190].map((height) => (
        <Skeleton
          key={height}
          className="w-full rounded-[8px]"
          style={{ height }}
        />
      ))}
    </div>
  )
}
