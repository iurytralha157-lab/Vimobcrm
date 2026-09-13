'use client'

import { Link2, Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  PropertyCity,
  PropertyCondominium,
  PropertyNeighborhood,
} from '@/hooks/use-property-locations'
import { formatFixedBRLCurrency } from '@/lib/utils/formatting'

import {
  isLegacyCatalogValue,
  type CatalogLocation,
  type LocationDeletionTarget,
} from './model'

function LocationSourceBadge({ location }: { location: CatalogLocation }) {
  if (!isLegacyCatalogValue(location)) return null

  const propertyCount = location.property_count ?? 0
  return (
    <span className="inline-flex rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-muted-foreground">
      Da carteira{propertyCount > 0
        ? ` · ${propertyCount} imóvel${propertyCount === 1 ? '' : 'is'}`
        : ''}
    </span>
  )
}

type CitiesTableProps = {
  cities: PropertyCity[]
  onAssign: (city: PropertyCity) => void
  onEdit: (city: PropertyCity) => void
  onDelete: (target: LocationDeletionTarget) => void
}

export function CitiesTable({
  cities,
  onAssign,
  onEdit,
  onDelete,
}: CitiesTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[520px] [&_tr]:border-border/40">
        <TableHeader>
          <TableRow>
            <TableHead>Cidade</TableHead>
            <TableHead>UF</TableHead>
            <TableHead className="w-44 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cities.map((city) => (
            <TableRow key={city.id}>
              <TableCell className="font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{city.name}</span>
                  <LocationSourceBadge location={city} />
                </div>
              </TableCell>
              <TableCell>
                {city.uf ? (
                  <span className="rounded-[6px] bg-muted px-2 py-1 text-xs">
                    {city.uf}
                  </span>
                ) : (
                  '-'
                )}
              </TableCell>
              <TableCell>
                {isLegacyCatalogValue(city) ? (
                  <span className="text-xs font-light text-muted-foreground">
                    Somente leitura
                  </span>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onAssign(city)}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Imóveis
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar cidade ${city.name}`}
                      onClick={() => onEdit(city)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Excluir cidade ${city.name}`}
                      onClick={() =>
                        onDelete({
                          type: 'city',
                          id: city.id,
                          name: city.name,
                          expected_updated_at: city.updated_at,
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type NeighborhoodsTableProps = {
  neighborhoods: PropertyNeighborhood[]
  onAssign: (neighborhood: PropertyNeighborhood) => void
  onEdit: (neighborhood: PropertyNeighborhood) => void
  onDelete: (target: LocationDeletionTarget) => void
}

export function NeighborhoodsTable({
  neighborhoods,
  onAssign,
  onEdit,
  onDelete,
}: NeighborhoodsTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[560px] [&_tr]:border-border/40">
        <TableHeader>
          <TableRow>
            <TableHead>Bairro</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead className="w-44 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {neighborhoods.map((neighborhood) => (
            <TableRow key={neighborhood.id}>
              <TableCell className="font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{neighborhood.name}</span>
                  <LocationSourceBadge location={neighborhood} />
                </div>
              </TableCell>
              <TableCell>
                {neighborhood.city?.name}
                {neighborhood.city?.uf ? ` (${neighborhood.city.uf})` : ''}
              </TableCell>
              <TableCell>
                {isLegacyCatalogValue(neighborhood) ? (
                  <span className="text-xs font-light text-muted-foreground">
                    Somente leitura
                  </span>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onAssign(neighborhood)}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Imóveis
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar bairro ${neighborhood.name}`}
                      onClick={() => onEdit(neighborhood)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Excluir bairro ${neighborhood.name}`}
                      onClick={() =>
                        onDelete({
                          type: 'neighborhood',
                          id: neighborhood.id,
                          name: neighborhood.name,
                          expected_updated_at: neighborhood.updated_at,
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type CondominiumsTableProps = {
  condominiums: PropertyCondominium[]
  onEdit: (condominium: PropertyCondominium) => void
  onDelete: (target: LocationDeletionTarget) => void
}

export function CondominiumsTable({
  condominiums,
  onEdit,
  onDelete,
}: CondominiumsTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[760px] [&_tr]:border-border/40">
        <TableHeader>
          <TableRow>
            <TableHead>Condomínio</TableHead>
            <TableHead>Bairro</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead>Taxa</TableHead>
            <TableHead>Portaria</TableHead>
            <TableHead className="w-44 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {condominiums.map((condominium) => (
            <TableRow key={condominium.id}>
              <TableCell className="font-medium">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{condominium.name}</span>
                  <LocationSourceBadge location={condominium} />
                </div>
              </TableCell>
              <TableCell>{condominium.neighborhood?.name || '-'}</TableCell>
              <TableCell>
                {condominium.city?.name}
                {condominium.city?.uf ? ` (${condominium.city.uf})` : ''}
              </TableCell>
              <TableCell>
                {condominium.default_condominium_fee != null
                  ? formatFixedBRLCurrency(
                      Number(condominium.default_condominium_fee),
                    )
                  : '-'}
              </TableCell>
              <TableCell>
                {condominium.has_concierge
                  ? condominium.concierge_type || 'Sim'
                  : '-'}
              </TableCell>
              <TableCell>
                {isLegacyCatalogValue(condominium) ? (
                  <span className="text-xs font-light text-muted-foreground">
                    Somente leitura
                  </span>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar condomínio ${condominium.name}`}
                      onClick={() => onEdit(condominium)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Excluir condomínio ${condominium.name}`}
                      onClick={() =>
                        onDelete({
                          type: 'condominium',
                          id: condominium.id,
                          name: condominium.name,
                          expected_updated_at: condominium.updated_at,
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
