'use client'

import { useMemo } from 'react'
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Property } from '@/hooks/use-properties'
import { cn } from '@/lib/utils'

import { EmptyState, LoadingState } from './FeedbackStates'
import type { AssignmentTarget } from './model'

type AssignmentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: AssignmentTarget | null
  search: string
  onSearchChange: (value: string) => void
  properties: Property[]
  selectedPropertyIds: string[]
  onToggleProperty: (propertyId: string) => void
  loading: boolean
  isError: boolean
  isFetching: boolean
  onRetry: () => void
  hasNextPage: boolean | undefined
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  onFetchNextPage: () => void
  propertyTotalCount: number
  assigning: boolean
  onAssign: () => void
}

export function AssignmentDialog({
  open,
  onOpenChange,
  target,
  search,
  onSearchChange,
  properties,
  selectedPropertyIds,
  onToggleProperty,
  loading,
  isError,
  isFetching,
  onRetry,
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  onFetchNextPage,
  propertyTotalCount,
  assigning,
  onAssign,
}: AssignmentDialogProps) {
  const selectedPropertySet = useMemo(
    () => new Set(selectedPropertyIds),
    [selectedPropertyIds],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!assigning) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-0">
        <DialogHeader>
          <DialogTitle>Vincular imóveis</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-[8px] bg-muted/40 p-3">
            <p className="text-sm font-medium">{target?.title}</p>
            {target?.subtitle ? (
              <p className="text-xs text-muted-foreground">
                {target.subtitle}
              </p>
            ) : null}
          </div>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar imóveis..."
              disabled={assigning}
              className="h-9 border-0 pl-9 text-sm shadow-none"
            />
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <LoadingState />
            ) : isError && properties.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center px-4 py-6 text-center">
                <AlertTriangle
                  className="h-5 w-5 text-primary"
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm font-medium">
                  Não foi possível carregar os imóveis
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRetry}
                  disabled={isFetching}
                  className="mt-3 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none"
                >
                  {isFetching ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Tentar novamente
                </Button>
              </div>
            ) : properties.length === 0 ? (
              <EmptyState text="Nenhum imóvel encontrado" />
            ) : (
              <>
                {properties.map((property) => {
                  const checked = selectedPropertySet.has(property.id)
                  const propertyLabel =
                    property.code || property.title || 'imóvel sem código'

                  return (
                    <button
                      key={property.id}
                      type="button"
                      aria-pressed={checked}
                      aria-label={`${
                        checked ? 'Remover' : 'Selecionar'
                      } ${propertyLabel}`}
                      onClick={() => onToggleProperty(property.id)}
                      disabled={assigning}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[6px] bg-muted/35 p-3 text-left transition hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30',
                        checked && 'bg-primary/10',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-border/70 bg-background text-primary-foreground',
                          checked && 'border-primary bg-primary',
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span>{property.code || 'Sem código'}</span>
                          <span className="rounded-[6px] bg-background/70 px-2 py-0.5 text-xs">
                            {property.tipo_de_negocio ||
                              property.finalidade ||
                              'Imóvel'}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {property.title ||
                            property.tipo_de_imovel ||
                            property.tipo_de_negocio ||
                            'Imóvel sem título'}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[property.bairro, property.cidade]
                            .filter(Boolean)
                            .join(' - ') || 'Localização não informada'}
                        </span>
                      </span>
                    </button>
                  )
                })}
                {hasNextPage || isFetchNextPageError ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onFetchNextPage}
                      disabled={isFetchingNextPage}
                      className="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light shadow-none"
                    >
                      {isFetchingNextPage ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      {isFetchingNextPage
                        ? 'Carregando...'
                        : isFetchNextPageError
                          ? 'Tentar carregar mais'
                          : 'Carregar mais imóveis'}
                    </Button>
                    {isFetchNextPageError ? (
                      <p className="text-xs text-destructive" role="status">
                        Não foi possível carregar a próxima página.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="text-xs text-muted-foreground">
              <p>{selectedPropertyIds.length} imóvel(is) selecionado(s)</p>
              <p>
                Exibindo {properties.length} de {propertyTotalCount}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={assigning}
              >
                Cancelar
              </Button>
              <Button onClick={onAssign} disabled={assigning}>
                {assigning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Vincular selecionados
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
