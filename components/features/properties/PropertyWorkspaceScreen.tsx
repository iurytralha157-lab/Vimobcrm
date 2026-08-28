'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Globe2,
  History,
  ImageIcon,
  KeyRound,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react'
import { toast } from 'sonner'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useCreatePropertyKey,
  useCreatePropertyOwnership,
  useEndPropertyOwnership,
  useMovePropertyKey,
  usePropertyOwnerOptions,
  usePropertyWorkspace,
  useUpdatePropertyOwnership,
  useUpsertPropertyOffer,
} from '@/hooks/properties'
import { usePropertyHistory, useUpdateProperty } from '@/hooks/use-properties'
import { getPropertySiteInfo } from '@/lib/api/property-support'
import { buildPropertySiteUrl } from '@/lib/property-site-url'
import type {
  PropertyKeyMovementInput,
  PropertyKeyMovementType,
  PropertyOfferType,
  PropertyOfferUpsertInput,
  PropertyWorkspaceAsset,
  PropertyWorkspaceKey,
  PropertyWorkspaceOwnership,
} from '@/lib/validation'
import { cn } from '@/lib/utils'
import { getSafePropertyImageSource } from '@/lib/property-media'

import { PropertyKeyCreateDialog } from './detail/PropertyKeyCreateDialog'
import { PropertyKeyMovementDialog } from './detail/PropertyKeyMovementDialog'
import { PropertyOfferDialog } from './detail/PropertyOfferDialog'
import { PropertyOwnershipDialog, type OwnershipSubmitInput } from './detail/PropertyOwnershipDialog'
import { PropertyOwnershipEndDialog } from './detail/PropertyOwnershipEndDialog'
import { PropertyGallery } from './detail/PropertyWorkspaceOverview'
import {
  PropertyWorkspaceCommercialRegistration,
  PropertyWorkspaceMediaSection,
  PropertyWorkspaceOverviewSection,
  PropertyWorkspaceResponsiblesSection,
  PropertyWorkspaceTechnicalSection,
} from './detail/PropertyWorkspaceSections'
import { PropertyPublicationCenter } from './publication'

const OFFER_LABELS: Record<PropertyOfferType, string> = {
  sale: 'Venda',
  rent: 'Locação',
  seasonal: 'Temporada',
}

const OFFER_PERIOD_LABELS: Record<string, string> = {
  total: 'valor total',
  daily: 'por dia',
  weekly: 'por semana',
  monthly: 'por mês',
  yearly: 'por ano',
}

const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  reserved: 'Reservada',
  completed: 'Concluída',
  withdrawn: 'Retirada',
  expired: 'Expirada',
}

const KEY_STATUS_LABELS: Record<string, string> = {
  available: 'Disponível',
  checked_out: 'Em posse',
  lost: 'Perdida',
  inactive: 'Inativa',
}

const KEY_MOVEMENT_LABELS: Record<string, string> = {
  registration: 'Chave cadastrada',
  checkout: 'Chave retirada',
  transfer: 'Custódia transferida',
  return: 'Chave devolvida',
  location_change: 'Local alterado',
  mark_lost: 'Chave marcada como perdida',
  mark_found: 'Chave localizada',
  deactivate: 'Chave desativada',
  reactivate: 'Chave reativada',
}

type ActionableKeyMovement = Exclude<PropertyKeyMovementType, 'registration'>

const WORKSPACE_TAB_TRIGGER_CLASS =
  'mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]'
const WORKSPACE_TAB_ICON_CLASS = 'h-3 w-3 shrink-0'
const PROPERTY_ACTION_MENU_ITEM_CLASS =
  'h-8 gap-2 rounded-[6px] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]'
const PROPERTY_ACTION_MENU_ICON_CLASS = 'h-3.5 w-3.5 shrink-0'

function normalizeStatus(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function isShareAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function formatCurrency(value: number | null | undefined, currency = 'BRL') {
  if (value == null) return 'Valor não informado'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'Não informado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date)
}

function collectPropertyImages(property: {
  imagem_principal: string | null
  image_urls: string[] | null
  fotos: unknown
}, assets: PropertyWorkspaceAsset[]) {
  const normalizedPhotos = assets
    .filter((asset) => asset.asset_type === 'photo')
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order)
    .map((asset) => asset.access_url || asset.external_url)
    .map((value) => getSafePropertyImageSource(value))
    .filter((value): value is string => Boolean(value))
  const legacyImages = [property.imagem_principal, ...(property.image_urls ?? [])]
  if (Array.isArray(property.fotos)) {
    legacyImages.push(...property.fotos.filter((value): value is string => typeof value === 'string'))
  }
  const safeLegacyImages = legacyImages
    .map((value) => getSafePropertyImageSource(value))
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set([...normalizedPhotos, ...safeLegacyImages]))
}

function localDateISO() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function WorkspaceLoading() {
  return (
    <AppLayout title="Ficha do imóvel">
      <div className="mx-auto max-w-[1500px] space-y-6 py-2">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="aspect-[16/10] rounded-[8px] lg:col-span-7" />
          <div className="space-y-4 lg:col-span-5">
            <Skeleton className="h-32 rounded-[8px]" />
            <Skeleton className="h-32 rounded-[8px]" />
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export type PropertyWorkspaceTab =
  | 'overview'
  | 'technical'
  | 'commercial'
  | 'responsibles'
  | 'media'
  | 'publication'
  | 'keys'
  | 'history'

type PropertyWorkspaceScreenProps = {
  initialTab?: PropertyWorkspaceTab
}

export function PropertyWorkspaceScreen({ initialTab = 'overview' }: PropertyWorkspaceScreenProps) {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const propertyId = typeof params.id === 'string' ? params.id : null
  const workspaceQuery = usePropertyWorkspace(propertyId)
  const historyQuery = usePropertyHistory(propertyId)
  const updatePropertyMutation = useUpdateProperty()
  const offerMutation = useUpsertPropertyOffer(propertyId)
  const keyMutation = useCreatePropertyKey(propertyId)
  const movementMutation = useMovePropertyKey(propertyId)
  const normalizedResourcesAvailable = workspaceQuery.data?.meta.normalized_resources_available ?? true
  const ownerOptionsQuery = usePropertyOwnerOptions(Boolean(
    workspaceQuery.data?.meta.can_manage && normalizedResourcesAvailable,
  ))
  const createOwnershipMutation = useCreatePropertyOwnership(propertyId)
  const updateOwnershipMutation = useUpdatePropertyOwnership(propertyId)
  const endOwnershipMutation = useEndPropertyOwnership(propertyId)
  const [offerDialogOpen, setOfferDialogOpen] = useState(false)
  const [offerType, setOfferType] = useState<PropertyOfferType>('sale')
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [movementDialogOpen, setMovementDialogOpen] = useState(false)
  const [movementType, setMovementType] = useState<ActionableKeyMovement>('checkout')
  const [selectedKey, setSelectedKey] = useState<PropertyWorkspaceKey | null>(null)
  const [ownershipDialogOpen, setOwnershipDialogOpen] = useState(false)
  const [endOwnershipDialogOpen, setEndOwnershipDialogOpen] = useState(false)
  const [selectedOwnership, setSelectedOwnership] = useState<PropertyWorkspaceOwnership | null>(null)

  const response = workspaceQuery.data
  const workspace = response?.data
  const property = workspace?.property
  const siteInfoQuery = useQuery({
    queryKey: ['org-site-info', property?.organization_id],
    queryFn: () => getPropertySiteInfo(property?.organization_id),
    enabled: Boolean(property?.organization_id),
    staleTime: 1000 * 60 * 5,
  })
  const orderedAssets = useMemo(() => [...(workspace?.assets ?? [])].sort(
    (left, right) => left.sort_order - right.sort_order || left.created_at.localeCompare(right.created_at),
  ), [workspace?.assets])
  const images = useMemo(
    () => property ? collectPropertyImages(property, orderedAssets) : [],
    [property, orderedAssets],
  )
  const selectedOffer = workspace?.offers.find((offer) => offer.offer_type === offerType) ?? null

  if (workspaceQuery.isLoading) return <WorkspaceLoading />

  if (workspaceQuery.isError || !workspace || !property || !response) {
    return (
      <AppLayout title="Ficha do imóvel" borderless>
        <div className="property-workspace-surface mx-auto flex min-h-[55vh] max-w-2xl items-center p-6 text-[12px] font-light [&_button]:rounded-[6px] [&_button]:text-[12px] [&_button]:font-light">
          <Alert variant="destructive" className="rounded-[8px] border-0 bg-destructive/10">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Não foi possível abrir a ficha</AlertTitle>
            <AlertDescription className="mt-2">
              {workspaceQuery.error instanceof Error ? workspaceQuery.error.message : 'O imóvel não existe ou não está disponível para o seu perfil.'}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void workspaceQuery.refetch()}
                  disabled={workspaceQuery.isFetching}
                  className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                >
                  {workspaceQuery.isFetching ? 'Tentando novamente' : 'Tentar novamente'}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.push('/properties')}>Voltar para imóveis</Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </AppLayout>
    )
  }

  const address = [property.endereco, property.numero, property.bairro, property.cidade, property.uf]
    .filter(Boolean)
    .join(', ')
  const primaryOffer = workspace.offers.find((offer) => offer.status === 'active') ?? workspace.offers[0]
  const title = property.title || `${property.tipo_de_imovel || property.tipo || 'Imóvel'} em ${property.bairro || property.cidade || 'localização não informada'}`
  const propertyStatus = property.status || 'Sem status'
  const published = Boolean(property.published_on_site ?? property.anunciar)
  const normalizedStatus = normalizeStatus(property.status)
  const isSold = normalizedStatus === 'vendido' || normalizedStatus === 'sold'
  const isReserved = normalizedStatus === 'reservado' || normalizedStatus === 'reserved'
  const isRented = ['alugado', 'locado', 'rented'].includes(normalizedStatus)
  const isInactive = normalizedStatus === 'inativo' || normalizedStatus === 'inactive'
  const isPrivateStatus = ['privado', 'private', 'draft', 'rascunho', 'arquivado', 'archived'].includes(normalizedStatus)
  const isUnavailable = isSold || isReserved || isRented
  const dealType = normalizeStatus(property.tipo_de_negocio)
  const titleIntent = normalizeStatus(property.title)
  const isRentalIntent =
    ['aluguel', 'locacao', 'venda e aluguel', 'venda e locacao', 'temporada'].includes(dealType)
    || titleIntent.includes('locacao')
    || titleIntent.includes('aluguel')
    || titleIntent.includes('alugar')
    || (Number(property.valor_locacao) > 0 && property.preco == null)
  const isSaleIntent =
    ['venda', 'venda e aluguel', 'venda e locacao', 'lancamento'].includes(dealType)
  const isPubliclyAvailable = published && !isPrivateStatus && !isUnavailable && !isInactive
  const propertySiteUrl = isPubliclyAvailable
    ? buildPropertySiteUrl(property.code, siteInfoQuery.data)
    : null
  const today = localDateISO()
  const effectiveInitialTab: PropertyWorkspaceTab = initialTab

  const copyPropertyUrl = async () => {
    if (!propertySiteUrl) return false

    try {
      await navigator.clipboard.writeText(propertySiteUrl)
      toast.success('Link do imóvel copiado!')
      return true
    } catch {
      return false
    }
  }

  const handleShareProperty = async () => {
    if (!propertySiteUrl) {
      toast.info('Publique o imóvel no site para compartilhar o link.')
      return
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: property.title || property.code || 'Imóvel',
          url: propertySiteUrl,
        })
        return
      } catch (error) {
        if (isShareAbortError(error)) return
      }
    }

    if (!(await copyPropertyUrl())) {
      window.open(propertySiteUrl, '_blank', 'noopener,noreferrer')
      toast.info('Abrimos o link do imóvel em uma nova aba.')
    }
  }

  const openPropertySite = () => {
    if (!propertySiteUrl) return
    window.open(propertySiteUrl, '_blank', 'noopener,noreferrer')
  }

  const changePropertyStatus = (status: 'ativo' | 'reservado' | 'vendido' | 'alugado') => {
    if (updatePropertyMutation.isPending) return

    void updatePropertyMutation
      .mutateAsync({ id: property.id, status })
      .then(() => workspaceQuery.refetch())
      .catch(() => undefined)
  }

  const openOffer = (type: PropertyOfferType) => {
    setOfferType(type)
    setOfferDialogOpen(true)
  }

  const submitOffer = async (input: PropertyOfferUpsertInput) => {
    await offerMutation.mutateAsync({ offerType, input })
    setOfferDialogOpen(false)
  }

  const submitKey = async (input: Parameters<typeof keyMutation.mutateAsync>[0]) => {
    await keyMutation.mutateAsync(input)
    setKeyDialogOpen(false)
  }

  const openMovement = (propertyKey: PropertyWorkspaceKey, type: ActionableKeyMovement) => {
    setSelectedKey(propertyKey)
    setMovementType(type)
    setMovementDialogOpen(true)
  }

  const submitMovement = async (input: PropertyKeyMovementInput) => {
    if (!selectedKey) return
    await movementMutation.mutateAsync({ keyId: selectedKey.id, input })
    setMovementDialogOpen(false)
  }

  const openOwnership = (ownership: PropertyWorkspaceOwnership | null = null) => {
    setSelectedOwnership(ownership)
    setOwnershipDialogOpen(true)
  }

  const submitOwnership = async (command: OwnershipSubmitInput) => {
    if (command.mode === 'create') {
      await createOwnershipMutation.mutateAsync(command.input)
    } else {
      await updateOwnershipMutation.mutateAsync({
        ownershipId: command.ownershipId,
        input: command.input,
      })
    }
    setOwnershipDialogOpen(false)
  }

  const openEndOwnership = (ownership: PropertyWorkspaceOwnership) => {
    setSelectedOwnership(ownership)
    setEndOwnershipDialogOpen(true)
  }

  const submitEndOwnership = async (input: Parameters<typeof endOwnershipMutation.mutateAsync>[0]['input']) => {
    if (!selectedOwnership) return
    await endOwnershipMutation.mutateAsync({ ownershipId: selectedOwnership.id, input })
    setEndOwnershipDialogOpen(false)
  }

  return (
    <AppLayout title="Ficha do imóvel" borderless>
      <div className="property-workspace-surface min-h-full bg-transparent text-[12px] font-light [&_button]:rounded-[6px] [&_button]:text-[12px] [&_button]:font-light">
        <div className="mx-auto max-w-[1500px] space-y-6 py-2">
          <header className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/properties')}
                className="-ml-2 h-8 px-2 text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-soft)]"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Imóveis
              </Button>

              <div className="flex items-center gap-2">
                {response.meta.can_manage && (
                  <Button
                    size="sm"
                    onClick={() => router.push(`/properties/${property.id}/edit`)}
                    className="h-8 bg-primary px-3 text-primary-foreground shadow-none hover:bg-primary/90"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Editar imóvel
                  </Button>
                )}

                {(propertySiteUrl || response.meta.can_manage) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Ações do imóvel ${property.code || title}`}
                        className="h-8 w-8 border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      sideOffset={6}
                      className="w-56 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none"
                    >
                      {propertySiteUrl && (
                        <>
                          <DropdownMenuItem
                            className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                            onSelect={() => void handleShareProperty()}
                          >
                            <Share2 className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                            Compartilhar link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                            onSelect={openPropertySite}
                          >
                            <ExternalLink className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                            Abrir no site
                          </DropdownMenuItem>
                        </>
                      )}

                      {propertySiteUrl && response.meta.can_manage && (
                        <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                      )}

                      {response.meta.can_manage && (
                        <>
                          {!isReserved && !isSold && !isRented && (
                            <DropdownMenuItem
                              disabled={updatePropertyMutation.isPending}
                              className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                              onSelect={() => changePropertyStatus('reservado')}
                            >
                              <Clock3 className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                              Marcar como reservado
                            </DropdownMenuItem>
                          )}
                          {isSaleIntent && !isSold && (
                            <DropdownMenuItem
                              disabled={updatePropertyMutation.isPending}
                              className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                              onSelect={() => changePropertyStatus('vendido')}
                            >
                              <CheckCircle className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                              Marcar como vendido
                            </DropdownMenuItem>
                          )}
                          {isRentalIntent && !isRented && (
                            <DropdownMenuItem
                              disabled={updatePropertyMutation.isPending}
                              className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                              onSelect={() => changePropertyStatus('alugado')}
                            >
                              <KeyRound className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                              Marcar como alugado
                            </DropdownMenuItem>
                          )}
                          {(isUnavailable || isInactive || isPrivateStatus) && (
                            <DropdownMenuItem
                              disabled={updatePropertyMutation.isPending}
                              className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                              onSelect={() => changePropertyStatus('ativo')}
                            >
                              <RotateCcw className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                              Voltar disponível
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className={PROPERTY_ACTION_MENU_ITEM_CLASS}
                            onSelect={() => router.push(`/properties/${property.id}?tab=publication`)}
                          >
                            <Globe2 className={PROPERTY_ACTION_MENU_ICON_CLASS} />
                            Gerenciar publicação
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-7">
                <PropertyGallery images={images} title={title} />
              </div>

              <Card className="flex min-w-0 flex-col rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none lg:col-span-5">
                <CardContent className="flex flex-1 flex-col p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge className="rounded-[4px] border-0 bg-primary/10 font-mono text-[10px] font-light text-primary shadow-none hover:bg-primary/10">
                        {property.code}
                      </Badge>
                      <Badge variant="outline" className="rounded-[4px] border-0 text-[10px] font-light">
                        {propertyStatus}
                      </Badge>
                      <Badge
                        className={cn(
                          'rounded-[4px] border-0 text-[10px] font-light shadow-none',
                          published
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'bg-primary/10 text-primary hover:bg-primary/10',
                        )}
                      >
                        {published && <Globe2 className="mr-1 h-3 w-3" />}
                        {published ? 'Publicado no site' : 'Fora do site'}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-5">
                    <h1 className="text-[20px] font-normal leading-7 text-[var(--app-text-primary)] sm:text-[22px]">
                      {title}
                    </h1>
                    <p className="mt-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
                      {property.tipo_de_imovel || property.tipo || 'Tipo não informado'}
                    </p>
                    {address && (
                      <p className="mt-3 flex items-start gap-1.5 text-[12px] font-light leading-5 text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{address}</span>
                      </p>
                    )}
                  </div>

                  <div className="mt-5 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                    <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">Oferta principal</p>
                    <p className="mt-1 text-[20px] font-normal text-primary">
                      {formatCurrency(primaryOffer?.price ?? property.preco ?? property.valor_locacao, primaryOffer?.currency)}
                    </p>
                    <p className="mt-1 text-[11px] font-light text-muted-foreground">
                      {primaryOffer?.price_period
                        ? OFFER_PERIOD_LABELS[primaryOffer.price_period]
                        : primaryOffer
                          ? OFFER_LABELS[primaryOffer.offer_type]
                          : 'Valor do cadastro'}
                    </p>
                  </div>

                  <div className="mt-auto pt-5">
                    <div className="flex items-center gap-2 text-[11px] font-light text-muted-foreground">
                      <span className="font-normal text-[var(--app-text-primary)]">{workspace.summary.completeness_score}%</span>
                      de completude
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </header>

          <Tabs
            key={effectiveInitialTab}
            defaultValue={effectiveInitialTab}
            className="space-y-4"
          >
            <div
              data-collapse="compact"
              className="app-responsive-tab-list min-w-0 flex-1"
            >
              <TabsList
                data-responsive-tab-scroll
                aria-label="Seções da ficha do imóvel"
                className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <TabsTrigger
                  value="overview"
                  data-responsive-tab
                  aria-label="Visão geral"
                  title="Visão geral"
                  className={WORKSPACE_TAB_TRIGGER_CLASS}
                >
                  <FileText aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Visão geral</span>
                </TabsTrigger>
                <TabsTrigger value="technical" data-responsive-tab aria-label="Ficha técnica" title="Ficha técnica" className={WORKSPACE_TAB_TRIGGER_CLASS}>
                  <ShieldCheck aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Ficha técnica</span>
                </TabsTrigger>
                <TabsTrigger value="commercial" data-responsive-tab aria-label="Comercial" title="Comercial" className={WORKSPACE_TAB_TRIGGER_CLASS}>
                  <WalletCards aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Comercial</span>
                </TabsTrigger>
                <TabsTrigger value="responsibles" data-responsive-tab aria-label="Responsáveis" title="Responsáveis" className={WORKSPACE_TAB_TRIGGER_CLASS}>
                  <UserRound aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Responsáveis</span>
                </TabsTrigger>
                <TabsTrigger value="media" data-responsive-tab aria-label="Mídia e documentos" title="Mídia e documentos" className={WORKSPACE_TAB_TRIGGER_CLASS}>
                  <ImageIcon aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Mídia e documentos</span>
                </TabsTrigger>
                <TabsTrigger value="publication" data-responsive-tab aria-label="Publicação" title="Publicação" className={WORKSPACE_TAB_TRIGGER_CLASS}>
                  <Globe2 aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Publicação</span>
                </TabsTrigger>
                <TabsTrigger value="keys" data-responsive-tab aria-label="Chaves" title="Chaves" className={WORKSPACE_TAB_TRIGGER_CLASS}>
                  <KeyRound aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Chaves</span>
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  data-responsive-tab
                  aria-label="Histórico"
                  title="Histórico"
                  className={WORKSPACE_TAB_TRIGGER_CLASS}
                >
                  <History aria-hidden="true" className={WORKSPACE_TAB_ICON_CLASS} />
                  <span className="app-responsive-tab-label">Histórico</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview">
              <PropertyWorkspaceOverviewSection
                property={property}
                summary={workspace.summary}
              />
            </TabsContent>

            <TabsContent value="technical">
              <PropertyWorkspaceTechnicalSection property={property} />
            </TabsContent>

            <TabsContent value="commercial" className="space-y-6">
              <PropertyWorkspaceCommercialRegistration
                property={property}
              />

              {normalizedResourcesAvailable && (
                <div className="grid gap-4 xl:grid-cols-3">
                  {(['sale', 'rent', 'seasonal'] as PropertyOfferType[]).map((type) => {
                    const offer = workspace.offers.find((item) => item.offer_type === type)
                    return (
                      <Card key={type} className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between gap-3">
                            <CardTitle className="text-[14px] font-normal">{OFFER_LABELS[type]}</CardTitle>
                            <Badge
                              className="rounded-[4px] border-0 text-[10px] font-light"
                              variant={offer?.status === 'active' ? 'default' : 'secondary'}
                            >
                              {offer ? OFFER_STATUS_LABELS[offer.status] : 'Não criada'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                            <p className="text-[16px] font-normal">{formatCurrency(offer?.price, offer?.currency)}</p>
                            <p className="mt-1 text-[10px] font-light text-muted-foreground">
                              {offer?.price_period ? OFFER_PERIOD_LABELS[offer.price_period] : 'Período não informado'}
                            </p>
                          </div>
                          {offer && (
                            <>
                              <dl className="grid grid-cols-2 gap-2 text-[10px] font-light">
                                <div><dt className="text-muted-foreground">Moeda</dt><dd className="mt-0.5 font-normal">{offer.currency}</dd></div>
                                <div><dt className="text-muted-foreground">Disponível desde</dt><dd className="mt-0.5 font-normal">{formatDate(offer.available_from)}</dd></div>
                                <div><dt className="text-muted-foreground">Disponível até</dt><dd className="mt-0.5 font-normal">{formatDate(offer.available_until)}</dd></div>
                                <div><dt className="text-muted-foreground">Publicada em</dt><dd className="mt-0.5 font-normal">{formatDate(offer.published_at, true)}</dd></div>
                                <div><dt className="text-muted-foreground">Concluída em</dt><dd className="mt-0.5 font-normal">{formatDate(offer.completed_at, true)}</dd></div>
                                <div><dt className="text-muted-foreground">Criada em</dt><dd className="mt-0.5 font-normal">{formatDate(offer.created_at, true)}</dd></div>
                                <div><dt className="text-muted-foreground">Atualizada em</dt><dd className="mt-0.5 font-normal">{formatDate(offer.updated_at, true)}</dd></div>
                              </dl>
                              {Object.keys(offer.terms).length > 0 && (
                                <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[11px] font-light text-muted-foreground">
                                  Condições da oferta: <span className="font-normal text-[var(--app-text-primary)]">{Object.keys(offer.terms).length} campos estruturados</span>
                                </div>
                              )}
                              {Object.keys(offer.metadata).length > 0 && (
                                <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[11px] font-light text-muted-foreground">
                                  Metadados da oferta: <span className="font-normal text-[var(--app-text-primary)]">{Object.keys(offer.metadata).length} campos registrados</span>
                                </div>
                              )}
                              <p className="break-all font-mono text-[9px] font-light text-muted-foreground">Oferta: {offer.id}</p>
                            </>
                          )}
                          {response.meta.can_manage && (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => openOffer(type)}>
                              {offer ? <Pencil className="mr-2 h-3.5 w-3.5" /> : <Plus className="mr-2 h-3.5 w-3.5" />}
                              {offer ? 'Editar oferta' : 'Criar oferta'}
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="responsibles">
              <PropertyWorkspaceResponsiblesSection
                property={property}
                ownerships={workspace.ownerships}
                meta={response.meta}
                normalizedResourcesAvailable={normalizedResourcesAvailable}
                today={today}
                onCreate={() => openOwnership()}
                onEdit={openOwnership}
                onEnd={openEndOwnership}
              />
            </TabsContent>

            <TabsContent value="media">
              <PropertyWorkspaceMediaSection
                property={property}
                assets={orderedAssets}
              />
            </TabsContent>

            <TabsContent value="publication" className="space-y-6">
              {normalizedResourcesAvailable ? (
                <PropertyPublicationCenter propertyId={property.id} />
              ) : (
                <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                  <CardContent className="p-5">
                    <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {[
                        ['Publicado no site', (property.published_on_site ?? property.anunciar) == null ? 'Não informado' : (property.published_on_site ?? property.anunciar) ? 'Sim' : 'Não'],
                        ['Destaque', (property.is_featured ?? property.destaque) == null ? 'Não informado' : (property.is_featured ?? property.destaque) ? 'Sim' : 'Não'],
                        ['Super destaque', property.super_destaque == null ? 'Não informado' : property.super_destaque ? 'Sim' : 'Não'],
                        ['Visibilidade do endereço', property.address_visibility || property.public_address_visibility || 'Não informado'],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                          <dt className="text-[10px] font-light uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
                          <dd className="mt-1 text-[12px] font-normal">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="keys" className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[14px] font-normal">Custódia de chaves</h2>
                  <p className="text-[12px] font-light text-muted-foreground">
                    Saiba onde cada conjunto está e quem é o responsável.
                  </p>
                </div>
                {response.meta.can_manage && normalizedResourcesAvailable && (
                  <Button size="sm" onClick={() => setKeyDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Cadastrar chave
                  </Button>
                )}
              </div>

              {!normalizedResourcesAvailable && (
                <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                  <CardContent className="p-5">
                    <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">Local das chaves</p>
                    <p className="mt-2 text-[12px] font-normal text-[var(--app-text-primary)]">
                      {'local_chaves' in property && property.local_chaves ? property.local_chaves : 'Informação não disponível para este perfil.'}
                    </p>
                  </CardContent>
                </Card>
              )}

              {workspace.keys.length > 0 ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {workspace.keys.map((propertyKey) => (
                    <Card key={propertyKey.id} className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                              <KeyRound className="h-5 w-5" />
                            </span>
                            <div>
                              <CardTitle className="text-[14px] font-normal">
                                {propertyKey.label}
                              </CardTitle>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {propertyKey.key_code || "Sem código interno"}
                              </p>
                            </div>
                          </div>
                          <Badge
                            className="rounded-[4px] border-0 text-[10px] font-light"
                            variant={
                              propertyKey.status === "available"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {KEY_STATUS_LABELS[propertyKey.status]}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-[12px] font-light">
                          <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                            <span className="block text-xs text-muted-foreground">
                              Local
                            </span>
                            {propertyKey.current_location || "Não informado"}
                          </div>
                          <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                            <span className="block text-xs text-muted-foreground">
                              Responsável
                            </span>
                            {propertyKey.holder_name || "Na imobiliária"}
                          </div>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-[10px] font-light text-muted-foreground sm:grid-cols-4">
                          <div>
                            <dt>Retirada em</dt>
                            <dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(propertyKey.checked_out_at, true)}</dd>
                          </div>
                          <div>
                            <dt>Devolução prevista</dt>
                            <dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(propertyKey.expected_return_at, true)}</dd>
                          </div>
                          <div>
                            <dt>Cadastrada em</dt>
                            <dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(propertyKey.created_at, true)}</dd>
                          </div>
                          <div>
                            <dt>Atualizada em</dt>
                            <dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(propertyKey.updated_at, true)}</dd>
                          </div>
                          {propertyKey.holder_user_id && (
                            <div className="col-span-2 sm:col-span-4">
                              <dt>ID do responsável</dt>
                              <dd className="mt-0.5 break-all font-mono font-normal text-[var(--app-text-primary)]">{propertyKey.holder_user_id}</dd>
                            </div>
                          )}
                        </dl>
                        {response.meta.can_manage && normalizedResourcesAvailable && (
                          <div className="flex flex-wrap gap-2">
                            {propertyKey.status === "available" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    openMovement(propertyKey, "checkout")
                                  }
                                >
                                  Retirar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    openMovement(propertyKey, "location_change")
                                  }
                                >
                                  Mudar local
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    openMovement(propertyKey, "mark_lost")
                                  }
                                >
                                  Marcar perdida
                                </Button>
                              </>
                            )}
                            {propertyKey.status === "checked_out" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    openMovement(propertyKey, "return")
                                  }
                                >
                                  Devolver
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    openMovement(propertyKey, "transfer")
                                  }
                                >
                                  Transferir
                                </Button>
                              </>
                            )}
                            {propertyKey.status === "lost" && (
                              <Button
                                size="sm"
                                onClick={() =>
                                  openMovement(propertyKey, "mark_found")
                                }
                              >
                                Registrar localização
                              </Button>
                            )}
                            {propertyKey.status === "inactive" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  openMovement(propertyKey, "reactivate")
                                }
                              >
                                Reativar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  openMovement(propertyKey, "deactivate")
                                }
                              >
                                Desativar
                              </Button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="border-dashed shadow-none">
                  <CardContent className="p-10 text-center text-[12px] font-light text-muted-foreground">
                    Nenhuma chave cadastrada para este imóvel.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-6">
              <div className={cn("grid gap-6", normalizedResourcesAvailable && "lg:grid-cols-2")}>
                <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
                      <History className="h-4 w-4" />
                      Histórico do imóvel
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {historyQuery.isLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-14" />
                        <Skeleton className="h-14" />
                        <Skeleton className="h-14" />
                      </div>
                    ) : historyQuery.isError ? (
                      <div className="rounded-[8px] bg-destructive/10 p-4">
                        <p className="text-[12px] font-normal text-destructive">Não foi possível carregar o histórico.</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-8"
                          onClick={() => void historyQuery.refetch()}
                          disabled={historyQuery.isFetching}
                        >
                          {historyQuery.isFetching ? 'Tentando novamente' : 'Tentar novamente'}
                        </Button>
                      </div>
                    ) : historyQuery.data && historyQuery.data.length > 0 ? (
                      <div className="space-y-4">
                        {historyQuery.data.map((event) => {
                          const message = typeof event.metadata?.message === 'string' ? event.metadata.message : null
                          return (
                            <article key={event.id} className="flex gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                              <span className="mt-1 h-2 w-2 shrink-0 rounded-[4px] bg-primary" />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="break-words text-[12px] font-normal">{event.title}</p>
                                  <Badge variant="secondary" className="rounded-[4px] border-0 text-[9px] font-light">{event.type}</Badge>
                                </div>
                                {message && <p className="mt-1 whitespace-pre-wrap text-[11px] font-light text-muted-foreground">{message}</p>}
                                <p className="mt-1 text-[10px] font-light text-muted-foreground">{formatDate(event.created_at, true)}</p>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-[12px] font-light text-muted-foreground">
                        Nenhuma alteração registrada.
                      </p>
                    )}
                  </CardContent>
                </Card>

                {normalizedResourcesAvailable && (
                  <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
                      <KeyRound className="h-4 w-4" />
                      Movimentações de chaves
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {workspace.recent_key_movements.length > 0 ? (
                      <div className="space-y-4">
                        {workspace.recent_key_movements.map((movement) => (
                          <article key={movement.id} className="flex gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">
                              <Clock3 className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-normal">
                                {KEY_MOVEMENT_LABELS[movement.movement_type] ||
                                  movement.movement_type}
                              </p>
                              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] font-light text-muted-foreground">
                                <div><dt>Responsável</dt><dd className="mt-0.5 break-words font-normal text-[var(--app-text-primary)]">{movement.holder_name || 'Não informado'}</dd></div>
                                <div><dt>Origem</dt><dd className="mt-0.5 break-words font-normal text-[var(--app-text-primary)]">{movement.from_location || 'Não informada'}</dd></div>
                                <div><dt>Destino</dt><dd className="mt-0.5 break-words font-normal text-[var(--app-text-primary)]">{movement.to_location || 'Não informado'}</dd></div>
                                <div><dt>Ocorrência</dt><dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(movement.occurred_at, true)}</dd></div>
                                <div><dt>Devolução prevista</dt><dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(movement.expected_return_at, true)}</dd></div>
                                <div><dt>Registrada em</dt><dd className="mt-0.5 font-normal text-[var(--app-text-primary)]">{formatDate(movement.created_at, true)}</dd></div>
                              </dl>
                              <div className="mt-2 space-y-1 break-all font-mono text-[9px] font-light text-muted-foreground">
                                <p>Chave: {movement.property_key_id}</p>
                                {movement.holder_user_id && <p>Responsável: {movement.holder_user_id}</p>}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] font-light text-muted-foreground">
                        Nenhuma movimentação registrada.
                      </p>
                    )}
                  </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {normalizedResourcesAvailable && offerDialogOpen && (
        <PropertyOfferDialog
          open
          onOpenChange={setOfferDialogOpen}
          offerType={offerType}
          offer={selectedOffer}
          pending={offerMutation.isPending}
          onSubmit={submitOffer}
        />
      )}
      {normalizedResourcesAvailable && keyDialogOpen && (
        <PropertyKeyCreateDialog
          open
          onOpenChange={setKeyDialogOpen}
          pending={keyMutation.isPending}
          onSubmit={submitKey}
        />
      )}
      {normalizedResourcesAvailable && movementDialogOpen && (
        <PropertyKeyMovementDialog
          open
          onOpenChange={setMovementDialogOpen}
          movementType={movementType}
          propertyKey={selectedKey}
          pending={movementMutation.isPending}
          onSubmit={submitMovement}
        />
      )}
      {normalizedResourcesAvailable && ownershipDialogOpen && (
        <PropertyOwnershipDialog
          open
          onOpenChange={setOwnershipDialogOpen}
          ownership={selectedOwnership}
          ownerOptions={ownerOptionsQuery.data ?? []}
          ownerOptionsLoading={ownerOptionsQuery.isLoading}
          canViewOwnerContacts={response.meta.can_view_owner_contacts}
          pending={
            createOwnershipMutation.isPending ||
            updateOwnershipMutation.isPending
          }
          onSubmit={submitOwnership}
        />
      )}
      {normalizedResourcesAvailable && endOwnershipDialogOpen && selectedOwnership && (
        <PropertyOwnershipEndDialog
          open
          onOpenChange={setEndOwnershipDialogOpen}
          ownership={selectedOwnership}
          pending={endOwnershipMutation.isPending}
          onSubmit={submitEndOwnership}
        />
      )}
    </AppLayout>
  );
}

export default PropertyWorkspaceScreen
