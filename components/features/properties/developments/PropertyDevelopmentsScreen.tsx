'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { PropertySectionTabs } from '@/components/features/properties/PropertySectionTabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreatePropertyDevelopment, usePropertyDevelopments } from '@/hooks/properties'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { getErrorMessageOrFallback as getErrorMessage } from '@/lib/api/vimob-error'
import type {
  PropertyDevelopmentCommercialStatus,
  PropertyDevelopmentStatus,
  PropertyDevelopmentType,
} from '@/lib/validation'

import { DevelopmentCreateDialog, type DevelopmentCreateValues } from './DevelopmentDialogs'
import {
  COMMERCIAL_STATUS_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_TYPE_LABELS,
  DevelopmentEmptyState,
  DevelopmentLoadingGrid,
} from './development-ui'
import { DevelopmentCatalogCard, DevelopmentKpis } from './DevelopmentCatalogCard'

const PAGE_SIZE = 24

export function PropertyDevelopmentsScreen() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<PropertyDevelopmentStatus | 'all'>('all')
  const [commercialStatus, setCommercialStatus] = useState<PropertyDevelopmentCommercialStatus | 'all'>('all')
  const [type, setType] = useState<PropertyDevelopmentType | 'all'>('all')
	const [offset, setOffset] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const debouncedSearch = useDebouncedValue(search, 300)

  const developmentsQuery = usePropertyDevelopments({
    search: debouncedSearch.trim() || undefined,
    status: status === 'all' ? undefined : status,
    commercial_status: commercialStatus === 'all' ? undefined : commercialStatus,
		development_type: type === 'all' ? undefined : type,
		limit: PAGE_SIZE,
		offset,
  })
  const createDevelopment = useCreatePropertyDevelopment()
  const response = developmentsQuery.data
  const developments = useMemo(() => response?.data ?? [], [response?.data])
	const visibleDevelopments = developments
  const canManage = response?.meta.can_manage ?? false
	const total = response?.meta.total ?? 0
	const currentPage = Math.floor(offset / PAGE_SIZE) + 1
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setCommercialStatus('all')
    setType('all')
		setOffset(0)
  }

  const submitDevelopment = async (values: DevelopmentCreateValues) => {
    try {
      const created = await createDevelopment.mutateAsync(values)
      setCreateOpen(false)
      router.push(`/properties/developments/${created.id}`)
    } catch {
      // The domain hook owns the user-facing error toast.
    }
  }

  return (
    <AppLayout title="Lançamentos e empreendimentos">
      <div className="properties-screen animate-in space-y-3">
        <PropertySectionTabs activeSection="developments" />
        <DevelopmentKpis
          total={response?.meta.total}
          commercialActive={response?.meta.commercial_active}
          inventoryTotal={response?.meta.inventory_total}
          inventoryAvailable={response?.meta.inventory_available}
          underConstruction={response?.meta.under_construction}
        />

        <section className="rounded-[12px] bg-[var(--app-surface-solid)] p-2" aria-label="Filtros de empreendimentos">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_minmax(0,160px)_minmax(0,160px)_minmax(0,160px)_auto_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
			  <Input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} placeholder="Buscar por nome, código ou cidade…" className="pl-9" aria-label="Buscar empreendimentos" />
            </div>
			<Select value={status} onValueChange={(value) => { setStatus(value as PropertyDevelopmentStatus | 'all'); setOffset(0) }}>
              <SelectTrigger aria-label="Filtrar por etapa"><SelectValue placeholder="Etapa" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas as etapas</SelectItem>{Object.entries(DEVELOPMENT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
			<Select value={commercialStatus} onValueChange={(value) => { setCommercialStatus(value as PropertyDevelopmentCommercialStatus | 'all'); setOffset(0) }}>
              <SelectTrigger aria-label="Filtrar por status comercial"><SelectValue placeholder="Comercial" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todo o comercial</SelectItem>{Object.entries(COMMERCIAL_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
			<Select value={type} onValueChange={(value) => { setType(value as PropertyDevelopmentType | 'all'); setOffset(0) }}>
              <SelectTrigger aria-label="Filtrar por tipo"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos os tipos</SelectItem>{Object.entries(DEVELOPMENT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" onClick={clearFilters} className="px-3"><SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />Limpar</Button>
            {canManage && (
              <Button onClick={() => setCreateOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Novo empreendimento
              </Button>
            )}
          </div>
        </section>

        {developmentsQuery.isLoading ? (
          <DevelopmentLoadingGrid />
        ) : developmentsQuery.isError && visibleDevelopments.length === 0 ? (
          <DevelopmentEmptyState
            title="Não foi possível carregar os empreendimentos"
            description={getErrorMessage(developmentsQuery.error, 'Não foi possível concluir a operação.')}
            action={<Button variant="outline" disabled={developmentsQuery.isFetching} onClick={() => void developmentsQuery.refetch()}>Tentar novamente</Button>}
          />
        ) : visibleDevelopments.length === 0 ? (
          <DevelopmentEmptyState
            title={debouncedSearch || status !== 'all' || commercialStatus !== 'all' || type !== 'all' ? 'Nenhum resultado para estes filtros' : 'Seu catálogo de lançamentos começa aqui'}
            description={debouncedSearch || status !== 'all' || commercialStatus !== 'all' || type !== 'all' ? 'Ajuste os filtros para ampliar a busca.' : 'Crie o primeiro empreendimento e organize fases, torres, plantas, unidades e preços.'}
            action={canManage ? <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo empreendimento</Button> : undefined}
          />
        ) : (
			<>
			{developmentsQuery.isError ? (
				<div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="status">
					A atualização falhou; mantendo os empreendimentos já carregados.
				</div>
			) : null}
			<section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Catálogo de empreendimentos">
            {visibleDevelopments.map((development) => (
              <DevelopmentCatalogCard key={development.id} development={development} canOpen={canManage} />
            ))}
			</section>
			{total > PAGE_SIZE && (
				<nav className="flex items-center justify-between gap-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-4 py-3" aria-label="Paginação do catálogo">
					<p className="text-sm font-light text-muted-foreground">Página {currentPage} de {pageCount} · {total} empreendimentos</p>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" disabled={offset === 0 || developmentsQuery.isFetching} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Anterior</Button>
						<Button variant="outline" size="sm" disabled={offset + visibleDevelopments.length >= total || developmentsQuery.isFetching} onClick={() => setOffset((value) => value + PAGE_SIZE)}>Próxima</Button>
					</div>
				</nav>
			)}
			</>
        )}
      </div>

      {createOpen && (
        <DevelopmentCreateDialog open onOpenChange={setCreateOpen} pending={createDevelopment.isPending} onSubmit={submitDevelopment} />
      )}
    </AppLayout>
  )
}

export default PropertyDevelopmentsScreen
