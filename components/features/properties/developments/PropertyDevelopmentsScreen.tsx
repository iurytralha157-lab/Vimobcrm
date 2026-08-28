'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  DoorOpen,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreatePropertyDevelopment, usePropertyDevelopments } from '@/hooks/properties'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
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
  MetricCard,
  formatDevelopmentDate,
  isSafeDevelopmentImageUrl,
} from './development-ui'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

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

  const metrics = useMemo(() => {
		const availableUnits = response?.meta.inventory_available
			?? visibleDevelopments.reduce((sum, item) => sum + item.inventory.available, 0)
		const totalUnits = response?.meta.inventory_total
			?? visibleDevelopments.reduce((sum, item) => sum + item.inventory.total, 0)
		const active = response?.meta.commercial_active
			?? visibleDevelopments.filter((item) => item.commercial_status === 'active').length
		const inConstruction = response?.meta.under_construction
			?? visibleDevelopments.filter((item) => item.status === 'under_construction').length
    return { availableUnits, totalUnits, active, inConstruction }
	}, [response?.meta, visibleDevelopments])

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
      <div className="mx-auto max-w-[1500px] space-y-6 py-2">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[12px] font-light text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Inventário de lançamentos
            </div>
            <h1 className="text-2xl font-normal tracking-tight sm:text-3xl">Empreendimentos</h1>
            <p className="mt-2 max-w-2xl text-sm font-light leading-6 text-muted-foreground">
              Controle o ciclo completo, da estrutura do projeto ao espelho de unidades e à tabela comercial.
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Novo empreendimento
            </Button>
          )}
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores do catálogo">
			<MetricCard label="Empreendimentos" value={total} hint={`${metrics.active} com comercial ativo`} icon={Building2} />
          <MetricCard label="Unidades no inventário" value={metrics.totalUnits} hint="Em todos os projetos filtrados" icon={DoorOpen} tone="muted" />
          <MetricCard label="Unidades disponíveis" value={metrics.availableUnits} hint={metrics.totalUnits > 0 ? `${Math.round((metrics.availableUnits / metrics.totalUnits) * 100)}% do estoque` : 'Sem estoque cadastrado'} icon={CheckCircle2} tone="success" />
          <MetricCard label="Em obras" value={metrics.inConstruction} hint="Acompanhamento de entrega" icon={CalendarClock} tone="warning" />
        </section>

        <section className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 shadow-none" aria-label="Filtros de empreendimentos">
          <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_190px_190px_190px_auto]">
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
          </div>
        </section>

        {developmentsQuery.isLoading ? (
          <DevelopmentLoadingGrid />
        ) : developmentsQuery.isError && visibleDevelopments.length === 0 ? (
          <DevelopmentEmptyState
            title="Não foi possível carregar os empreendimentos"
            description={getErrorMessage(developmentsQuery.error)}
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
			<section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Catálogo de empreendimentos">
            {visibleDevelopments.map((development) => {
              const availability = development.inventory.total > 0
                ? Math.round((development.inventory.available / development.inventory.total) * 100)
                : 0
              const location = [development.neighborhood, development.city, development.state].filter(Boolean).join(', ')
              return (
                <Link href={`/properties/developments/${development.id}`} key={development.id} className="group rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <Card className="app-card h-full overflow-hidden rounded-[8px] border-0 shadow-none transition-colors group-hover:bg-[var(--app-surface-hover)]">
                    <div className="relative aspect-[16/8] overflow-hidden bg-muted">
                      {isSafeDevelopmentImageUrl(development.main_image_url) ? (
                        <Image src={development.main_image_url} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw" className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/5 via-muted to-primary/10"><Building2 className="h-12 w-12 text-primary/25" aria-hidden="true" /></div>
                      )}
                      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                        <Badge className="bg-[var(--app-surface-solid)]/90 text-foreground shadow-none">{DEVELOPMENT_STATUS_LABELS[development.status] ?? development.status}</Badge>
                        <Badge variant={development.commercial_status === 'active' ? 'default' : 'secondary'} className="shadow-none">{COMMERCIAL_STATUS_LABELS[development.commercial_status] ?? development.commercial_status}</Badge>
                      </div>
                    </div>
                    <CardContent className="space-y-4 p-5">
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[12px] font-light text-muted-foreground">{development.code} · {DEVELOPMENT_TYPE_LABELS[development.development_type] ?? development.development_type}</p>
                            <h2 className="mt-1 line-clamp-2 text-[14px] font-normal group-hover:text-primary">{development.name}</h2>
                          </div>
                          {development.published_on_site && <span title="Publicado no site" className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/10" />}
                        </div>
                        <p className="mt-2 flex min-h-5 items-center gap-1.5 text-sm font-light text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{location || 'Localização não informada'}</p>
                      </div>
                      <div className="grid grid-cols-3 divide-x rounded-[6px] bg-[var(--app-surface-soft)] py-3 text-center">
                        <div><p className="font-normal">{development.inventory.total}</p><p className="text-[11px] font-light text-muted-foreground">Unidades</p></div>
                        <div><p className="font-normal text-emerald-600">{development.inventory.available}</p><p className="text-[11px] font-light text-muted-foreground">Disponíveis</p></div>
                        <div><p className="font-normal">{development.inventory.reserved}</p><p className="text-[11px] font-light text-muted-foreground">Reservadas</p></div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Obra</span><span className="font-medium">{development.construction_progress}%</span></div>
                        <Progress value={development.construction_progress} className="h-1.5" />
                      </div>
                      <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Entrega: {formatDevelopmentDate(development.expected_delivery_date)}</span>
                        <span className="flex items-center gap-1"><CircleDollarSign className="h-3.5 w-3.5" />{availability}% livre</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
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
