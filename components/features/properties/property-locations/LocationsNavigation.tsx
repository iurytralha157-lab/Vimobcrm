'use client'

import {
  Building2,
  Loader2,
  Map,
  MapPinned,
  Search,
  UserRound,
} from 'lucide-react'

import { Input } from '@/components/ui/input'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

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
      className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-primary px-1.5 text-[11px] font-medium text-primary-foreground"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : count}
    </span>
  )
}

type LocationsNavigationProps = {
  search: string
  onSearchChange: (value: string) => void
  citiesCount: number
  neighborhoodsCount: number
  condominiumsCount: number
  ownersCount: number
  loadingCities: boolean
  loadingNeighborhoods: boolean
  loadingCondominiums: boolean
  loadingOwners: boolean
}

export function LocationsNavigation({
  search,
  onSearchChange,
  citiesCount,
  neighborhoodsCount,
  condominiumsCount,
  ownersCount,
  loadingCities,
  loadingNeighborhoods,
  loadingCondominiums,
  loadingOwners,
}: LocationsNavigationProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
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
          <TabsTrigger
            value="condominiums"
            data-responsive-tab
            aria-label="Condomínios"
            title="Condomínios"
            className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
          >
            <Building2 aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="app-responsive-tab-label">Condomínios</span>
            <CounterBadge
              count={condominiumsCount}
              loading={loadingCondominiums}
            />
          </TabsTrigger>
          <TabsTrigger
            value="owners"
            data-responsive-tab
            aria-label="Proprietários"
            title="Proprietários"
            className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
          >
            <UserRound aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="app-responsive-tab-label">Proprietários</span>
            <CounterBadge count={ownersCount} loading={loadingOwners} />
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="relative w-[min(42vw,280px)] min-w-[120px] shrink-0 sm:w-64">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
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
