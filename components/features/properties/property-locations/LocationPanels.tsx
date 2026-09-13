'use client'

import type { Dispatch, SetStateAction } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import type {
  PropertyCity,
  PropertyCondominium,
  PropertyNeighborhood,
} from '@/hooks/use-property-locations'

import {
  EmptyState,
  LoadingState,
  LocationErrorState,
} from './FeedbackStates'
import {
  CityFormDialog,
  CondominiumFormDialog,
  NeighborhoodFormDialog,
} from './LocationFormDialogs'
import {
  CitiesTable,
  CondominiumsTable,
  NeighborhoodsTable,
} from './LocationTables'
import type {
  CityFormState,
  CondominiumFormState,
  LocationDeletionTarget,
  NeighborhoodFormState,
} from './model'

type QueryState = {
  loading: boolean
  isError: boolean
  isFetching: boolean
  onRetry: () => void
}

type CitiesPanelProps = {
  cities: PropertyCity[]
  sourceCount: number
  query: QueryState
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  editing: boolean
  savePending: boolean
  form: CityFormState
  setForm: Dispatch<SetStateAction<CityFormState>>
  onSave: () => void
  onAssign: (city: PropertyCity) => void
  onEdit: (city: PropertyCity) => void
  onDelete: (target: LocationDeletionTarget) => void
}

export function CitiesPanel({
  cities,
  sourceCount,
  query,
  dialogOpen,
  onDialogOpenChange,
  editing,
  savePending,
  form,
  setForm,
  onSave,
  onAssign,
  onEdit,
  onDelete,
}: CitiesPanelProps) {
  return (
    <TabsContent value="cities" className="mt-4">
      <section className="rounded-[8px] bg-card p-4">
        <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-medium">Cidades</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Itens marcados como “Da carteira” vêm dos imóveis já cadastrados e
              são somente leitura.
            </p>
          </div>
          <CityFormDialog
            open={dialogOpen}
            onOpenChange={onDialogOpenChange}
            pending={savePending}
            editing={editing}
            form={form}
            setForm={setForm}
            onSubmit={onSave}
          />
        </div>

        {query.loading ? (
          <LoadingState />
        ) : query.isError && sourceCount === 0 ? (
          <LocationErrorState
            label="as cidades"
            loading={query.isFetching}
            onRetry={query.onRetry}
          />
        ) : cities.length === 0 ? (
          <EmptyState text="Nenhuma cidade cadastrada" />
        ) : (
          <CitiesTable
            cities={cities}
            onAssign={onAssign}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </section>
    </TabsContent>
  )
}

type NeighborhoodsPanelProps = {
  neighborhoods: PropertyNeighborhood[]
  sourceCount: number
  catalogCities: PropertyCity[]
  selectedCityId: string
  onSelectedCityChange: (cityId: string) => void
  query: QueryState
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  editing: boolean
  savePending: boolean
  form: NeighborhoodFormState
  setForm: Dispatch<SetStateAction<NeighborhoodFormState>>
  onSave: () => void
  onAssign: (neighborhood: PropertyNeighborhood) => void
  onEdit: (neighborhood: PropertyNeighborhood) => void
  onDelete: (target: LocationDeletionTarget) => void
}

export function NeighborhoodsPanel({
  neighborhoods,
  sourceCount,
  catalogCities,
  selectedCityId,
  onSelectedCityChange,
  query,
  dialogOpen,
  onDialogOpenChange,
  editing,
  savePending,
  form,
  setForm,
  onSave,
  onAssign,
  onEdit,
  onDelete,
}: NeighborhoodsPanelProps) {
  return (
    <TabsContent value="neighborhoods" className="mt-4">
      <section className="rounded-[8px] bg-card p-4">
        <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center md:w-auto">
            <h2 className="text-base font-medium">Bairros</h2>
            <Select
              value={selectedCityId || '__all__'}
              onValueChange={(value) =>
                onSelectedCityChange(value === '__all__' ? '' : value)
              }
            >
              <SelectTrigger className="h-9 w-full border-0 shadow-none sm:w-48">
                <SelectValue placeholder="Filtrar por cidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as cidades</SelectItem>
                {catalogCities.map((city) => (
                  <SelectItem key={city.id} value={city.id}>
                    {city.name} {city.uf ? `(${city.uf})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <NeighborhoodFormDialog
            open={dialogOpen}
            onOpenChange={onDialogOpenChange}
            pending={savePending}
            editing={editing}
            cities={catalogCities}
            form={form}
            setForm={setForm}
            onSubmit={onSave}
          />
        </div>

        {query.loading ? (
          <LoadingState />
        ) : query.isError && sourceCount === 0 ? (
          <LocationErrorState
            label="os bairros"
            loading={query.isFetching}
            onRetry={query.onRetry}
          />
        ) : neighborhoods.length === 0 ? (
          <EmptyState text="Nenhum bairro cadastrado" />
        ) : (
          <NeighborhoodsTable
            neighborhoods={neighborhoods}
            onAssign={onAssign}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </section>
    </TabsContent>
  )
}

type CondominiumsPanelProps = {
  condominiums: PropertyCondominium[]
  sourceCount: number
  catalogCities: PropertyCity[]
  catalogNeighborhoods: PropertyNeighborhood[]
  selectedNeighborhoodId: string
  onSelectedNeighborhoodChange: (neighborhoodId: string) => void
  onSelectedCityChange: (cityId: string) => void
  query: QueryState
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  editing: boolean
  savePending: boolean
  form: CondominiumFormState
  setForm: Dispatch<SetStateAction<CondominiumFormState>>
  onSave: () => void
  onEdit: (condominium: PropertyCondominium) => void
  onDelete: (target: LocationDeletionTarget) => void
}

export function CondominiumsPanel({
  condominiums,
  sourceCount,
  catalogCities,
  catalogNeighborhoods,
  selectedNeighborhoodId,
  onSelectedNeighborhoodChange,
  onSelectedCityChange,
  query,
  dialogOpen,
  onDialogOpenChange,
  editing,
  savePending,
  form,
  setForm,
  onSave,
  onEdit,
  onDelete,
}: CondominiumsPanelProps) {
  return (
    <TabsContent value="condominiums" className="mt-4">
      <section className="rounded-[8px] bg-card p-4">
        <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center md:w-auto">
            <h2 className="text-base font-medium">Condomínios</h2>
            <Select
              value={selectedNeighborhoodId || '__all__'}
              onValueChange={(value) =>
                onSelectedNeighborhoodChange(
                  value === '__all__' ? '' : value,
                )
              }
            >
              <SelectTrigger className="h-9 w-full border-0 shadow-none sm:w-48">
                <SelectValue placeholder="Filtrar por bairro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os bairros</SelectItem>
                {catalogNeighborhoods.map((neighborhood) => (
                  <SelectItem key={neighborhood.id} value={neighborhood.id}>
                    {neighborhood.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CondominiumFormDialog
            open={dialogOpen}
            onOpenChange={onDialogOpenChange}
            pending={savePending}
            editing={editing}
            cities={catalogCities}
            neighborhoods={catalogNeighborhoods}
            form={form}
            setForm={setForm}
            onSelectedCityChange={onSelectedCityChange}
            onSubmit={onSave}
          />
        </div>

        {query.loading ? (
          <LoadingState />
        ) : query.isError && sourceCount === 0 ? (
          <LocationErrorState
            label="os condomínios"
            loading={query.isFetching}
            onRetry={query.onRetry}
          />
        ) : condominiums.length === 0 ? (
          <EmptyState text="Nenhum condomínio cadastrado" />
        ) : (
          <CondominiumsTable
            condominiums={condominiums}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </section>
    </TabsContent>
  )
}
