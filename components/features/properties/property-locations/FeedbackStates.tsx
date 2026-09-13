'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border-0 shadow-none"
      />
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export function LocationErrorState({
  label,
  loading,
  onRetry,
}: {
  label: string
  loading: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-normal">Não foi possível carregar {label}</p>
      <p className="mt-1 text-xs font-light text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={loading}
        className="mt-4 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : null}
        Tentar novamente
      </Button>
    </div>
  )
}

export function OwnerErrorState({
  loading,
  onRetry,
}: {
  loading: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-4 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium">
        Não foi possível carregar os proprietários
      </p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Verifique sua conexão e tente novamente.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={loading}
        className="mt-4 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : null}
        Tentar novamente
      </Button>
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
