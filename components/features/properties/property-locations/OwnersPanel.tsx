'use client'

import { Fragment } from 'react'
import {
  AlertTriangle,
  Edit2,
  Link2,
  Loader2,
  Mail,
  Phone,
  Plus,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TabsContent } from '@/components/ui/tabs'
import type { PropertyOwner } from '@/hooks/use-property-owners'

import { EmptyState, LoadingState, OwnerErrorState } from './FeedbackStates'
import { getOwnerContact, getOwnerPropertyCount } from './model'

function OwnerContactDetails({
  owner,
  visible,
}: {
  owner: PropertyOwner
  visible: boolean
}) {
  if (!visible) {
    return (
      <span className="text-sm text-muted-foreground">
        Contato oculto pela organização
      </span>
    )
  }

  const contact = getOwnerContact(owner)
  return (
    <div className="min-w-0 space-y-1 text-sm">
      {contact ? (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{contact}</span>
        </div>
      ) : null}
      {owner.email ? (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{owner.email}</span>
        </div>
      ) : null}
      {!contact && !owner.email ? (
        <span className="text-muted-foreground">Sem contato informado</span>
      ) : null}
    </div>
  )
}

function OwnerPropertyPreview({ owner }: { owner: PropertyOwner }) {
  const ownerProperties = owner.properties ?? []
  if (ownerProperties.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        Nenhum imóvel vinculado
      </span>
    )
  }

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {ownerProperties.map((property) => (
        <div key={property.id} className="rounded-[6px] bg-card px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{property.code || 'Sem código'}</span>
            {property.tipo_de_negocio ? (
              <span className="rounded-[6px] bg-muted px-2 py-0.5 text-xs">
                {property.tipo_de_negocio}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {property.title || 'Imóvel sem título'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[property.bairro, property.cidade].filter(Boolean).join(' - ') ||
              'Localização não informada'}
          </p>
        </div>
      ))}
    </div>
  )
}

type OwnersListProps = {
  owners: PropertyOwner[]
  isMobile: boolean
  canSeeOwnerContact: boolean
  expandedOwnerId: string | null
  onExpandedOwnerChange: (ownerId: string | null) => void
  onAssign: (owner: PropertyOwner) => void
  onEdit: (owner: PropertyOwner) => void
  onDeactivate: (owner: PropertyOwner) => void
}

function OwnersList({
  owners,
  isMobile,
  canSeeOwnerContact,
  expandedOwnerId,
  onExpandedOwnerChange,
  onAssign,
  onEdit,
  onDeactivate,
}: OwnersListProps) {
  if (!isMobile) {
    return (
      <div className="overflow-x-auto">
        <Table className="min-w-[760px] [&_tr]:border-border/40">
          <TableHeader>
            <TableRow>
              <TableHead>Proprietário</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Imóveis vinculados</TableHead>
              <TableHead className="w-48 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {owners.map((owner) => {
              const propertyCount = getOwnerPropertyCount(owner)
              const expanded = expandedOwnerId === owner.id

              return (
                <Fragment key={owner.id}>
                  <TableRow>
                    <TableCell className="min-w-56">
                      <div className="font-medium">{owner.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {owner.media_source || 'Origem não informada'}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-52">
                      <OwnerContactDetails
                        owner={owner}
                        visible={canSeeOwnerContact}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-[6px] bg-muted px-2.5 text-xs font-medium hover:bg-muted/80"
                        onClick={() =>
                          onExpandedOwnerChange(expanded ? null : owner.id)
                        }
                        disabled={propertyCount === 0}
                        aria-expanded={expanded}
                        aria-controls={`owner-properties-${owner.id}`}
                      >
                        {propertyCount}{' '}
                        {propertyCount === 1 ? 'imóvel' : 'imóveis'}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onAssign(owner)}
                          aria-label={`Vincular imóveis a ${owner.name}`}
                        >
                          <Link2
                            className="mr-2 h-4 w-4"
                            aria-hidden="true"
                          />
                          Imóveis
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(owner)}
                          aria-label={`Editar ${owner.name}`}
                        >
                          <Edit2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                          onClick={() => {
                            if (propertyCount === 0) onDeactivate(owner)
                          }}
                          aria-disabled={propertyCount > 0}
                          aria-describedby={
                            propertyCount > 0
                              ? `owner-deactivate-reason-${owner.id}`
                              : undefined
                          }
                          title={
                            propertyCount > 0
                              ? 'Desvincule os imóveis antes de desativar'
                              : 'Desativar proprietário'
                          }
                          aria-label={`Desativar ${owner.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {propertyCount > 0 ? (
                          <span
                            id={`owner-deactivate-reason-${owner.id}`}
                            className="sr-only"
                          >
                            Desvincule os imóveis antes de desativar este
                            proprietário.
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow id={`owner-properties-${owner.id}`}>
                      <TableCell colSpan={4} className="bg-muted/20 p-4">
                        <OwnerPropertyPreview owner={owner} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {owners.map((owner) => {
        const propertyCount = getOwnerPropertyCount(owner)
        const expanded = expandedOwnerId === owner.id

        return (
          <article
            key={owner.id}
            className="rounded-[8px] bg-[var(--app-surface-soft)] p-3"
          >
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium">{owner.name}</h3>
              <p className="truncate text-xs text-muted-foreground">
                {owner.media_source || 'Origem não informada'}
              </p>
            </div>
            <div className="mt-3">
              <OwnerContactDetails
                owner={owner}
                visible={canSeeOwnerContact}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-2 h-8 justify-center rounded-[6px] bg-muted px-2.5 text-xs font-medium hover:bg-muted/80"
                onClick={() =>
                  onExpandedOwnerChange(expanded ? null : owner.id)
                }
                disabled={propertyCount === 0}
                aria-expanded={expanded}
                aria-controls={`owner-properties-mobile-${owner.id}`}
              >
                {propertyCount} {propertyCount === 1 ? 'imóvel' : 'imóveis'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onAssign(owner)}
                aria-label={`Vincular imóveis a ${owner.name}`}
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Imóveis
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEdit(owner)}
                aria-label={`Editar ${owner.name}`}
              >
                <Edit2 className="h-4 w-4" aria-hidden="true" />
                Editar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-2 text-destructive hover:bg-destructive/10 hover:text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => {
                  if (propertyCount === 0) onDeactivate(owner)
                }}
                aria-disabled={propertyCount > 0}
                aria-describedby={
                  propertyCount > 0
                    ? `owner-deactivate-reason-mobile-${owner.id}`
                    : undefined
                }
                title={
                  propertyCount > 0
                    ? 'Desvincule os imóveis antes de desativar'
                    : 'Desativar proprietário'
                }
                aria-label={`Desativar ${owner.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Desativar
              </Button>
              {propertyCount > 0 ? (
                <span
                  id={`owner-deactivate-reason-mobile-${owner.id}`}
                  className="sr-only"
                >
                  Desvincule os imóveis antes de desativar este proprietário.
                </span>
              ) : null}
            </div>
            {expanded ? (
              <div
                id={`owner-properties-mobile-${owner.id}`}
                className="mt-3 border-t border-border/40 pt-3"
              >
                <OwnerPropertyPreview owner={owner} />
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

type OwnersPanelProps = OwnersListProps & {
  loading: boolean
  isError: boolean
  isFetching: boolean
  onRetry: () => void
  ownerTotalCount: number
  debouncedSearch: string
  hasMore: boolean | undefined
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onCreate: () => void
}

export function OwnersPanel({
  owners,
  loading,
  isError,
  isFetching,
  onRetry,
  ownerTotalCount,
  debouncedSearch,
  isMobile,
  canSeeOwnerContact,
  expandedOwnerId,
  onExpandedOwnerChange,
  onAssign,
  onEdit,
  onDeactivate,
  hasMore,
  isFetchNextPageError,
  isFetchingNextPage,
  onLoadMore,
  onCreate,
}: OwnersPanelProps) {
  return (
    <TabsContent value="owners" className="mt-4">
      <section className="rounded-[8px] bg-card p-4">
        <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-medium">Proprietários</h2>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {loading
                ? 'Carregando proprietários...'
                : `${ownerTotalCount} ${
                    ownerTotalCount === 1
                      ? 'proprietário'
                      : 'proprietários'
                  }`}
            </p>
          </div>
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Novo proprietário
          </Button>
        </div>

        {loading ? (
          <LoadingState />
        ) : isError && owners.length === 0 ? (
          <OwnerErrorState loading={isFetching} onRetry={onRetry} />
        ) : owners.length === 0 ? (
          <EmptyState
            text={
              debouncedSearch
                ? 'Nenhum proprietário encontrado'
                : 'Nenhum proprietário cadastrado'
            }
          />
        ) : (
          <>
            <OwnersList
              owners={owners}
              isMobile={isMobile}
              canSeeOwnerContact={canSeeOwnerContact}
              expandedOwnerId={expandedOwnerId}
              onExpandedOwnerChange={onExpandedOwnerChange}
              onAssign={onAssign}
              onEdit={onEdit}
              onDeactivate={onDeactivate}
            />

            <div className="flex flex-col items-center gap-2 pt-4">
              <p className="text-xs text-muted-foreground">
                Exibindo {owners.length} de {ownerTotalCount}
              </p>
              {hasMore || isFetchNextPageError ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={onLoadMore}
                  disabled={isFetchingNextPage}
                  className="h-8 rounded-[6px] px-3 text-xs font-light shadow-none"
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
                      : 'Carregar mais'}
                </Button>
              ) : null}
              {isFetchNextPageError ? (
                <p
                  className="flex items-center gap-2 text-xs text-destructive"
                  role="status"
                >
                  <AlertTriangle
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  Não foi possível carregar a próxima página.
                </p>
              ) : null}
            </div>
          </>
        )}
      </section>
    </TabsContent>
  )
}
