'use client'

import { Loader2, Map, MapPinned, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

import type { PropertyLocationsTab } from './model'

function CounterBadge({
  count,
  loading = false,
}: {
  count: number
  loading?: boolean
}) {
  return (
    <span
      data-responsive-tab-badge
      className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-[color-mix(in_srgb,var(--app-text-primary)_10%,transparent)] px-1.5 text-[11px] font-light text-[var(--app-text-secondary)]"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : count}
    </span>
  )
}

type LocationsNavigationProps = {
  tab: PropertyLocationsTab
  search: string
  onSearchChange: (value: string) => void
  citiesCount: number
  neighborhoodsCount: number
  loadingCities: boolean
  loadingNeighborhoods: boolean
}

export function LocationsNavigation({
  tab,
  search,
  onSearchChange,
  citiesCount,
  neighborhoodsCount,
  loadingCities,
  loadingNeighborhoods,
}: LocationsNavigationProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* Condomínios and Proprietários already have their own section tab. */}
      {(tab === 'cities' || tab === 'neighborhoods') ? <div
        data-collapse="compact"
        className="app-responsive-tab-list min-w-0 flex-1"
      >
        <TabsList
          data-responsive-tab-scroll
          aria-label="Cadastros de imóveis"
          className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TabsTrigger
            value="cities"
            data-responsive-tab
            aria-label="Cidades"
            title="Cidades"
            className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
          >
            <MapPinned aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="app-responsive-tab-label">Cidades</span>
            <CounterBadge count={citiesCount} loading={loadingCities} />
          </TabsTrigger>
          <TabsTrigger
            value="neighborhoods"
            data-responsive-tab
            aria-label="Bairros"
            title="Bairros"
            className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
          >
            <Map aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="app-responsive-tab-label">Bairros</span>
            <CounterBadge
              count={neighborhoodsCount}
              loading={loadingNeighborhoods}
            />
          </TabsTrigger>
        </TabsList>
      </div> : null}
      <div className={tab === 'cities' || tab === 'neighborhoods' ? 'relative w-[min(42vw,280px)] min-w-[120px] shrink-0 sm:w-64' : 'relative min-w-0 flex-1 rounded-[12px] bg-[var(--app-surface-solid)] p-2'}>
        <Search className={tab === 'cities' || tab === 'neighborhoods' ? 'absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' : 'absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground'} aria-hidden="true" />
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-9 text-[12px] font-light shadow-none"
        />
      </div>
    </div>
  )
}
