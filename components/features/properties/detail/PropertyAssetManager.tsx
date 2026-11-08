'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Loader2, Plus } from 'lucide-react'

import { EmptyNote, Panel, safeExternalUrl } from '@/components/features/marketing/marketing-ui'
import { Button } from '@/components/ui/button'
import {
  useCreatePropertyAsset,
  useDeletePropertyAsset,
  usePropertyWorkspace,
  useReorderPropertyAssets,
  useSetPrimaryPropertyAsset,
  useUpdatePropertyAsset,
} from '@/hooks/properties'
import type { PropertyWorkspaceAsset } from '@/lib/validation'
import { PROPERTY_MEDIA_MAX_PHOTOS } from '@/lib/property-media-draft'
import {
  releaseConfirmedPropertyAssetSortOrders,
  reserveNextPropertyAssetSortOrder,
} from '@/lib/property-asset-order'

import { PROPERTY_PRIMARY_BUTTON_CLASS, PROPERTY_SECONDARY_BUTTON_CLASS, PropertyChipTabs } from '../property-ui'
import { PropertyAssetDeleteDialog } from './PropertyAssetDeleteDialog'
import { PropertyAssetDialog, type AssetSubmitCommand } from './PropertyAssetDialog'
import { ASSET_CATEGORY_LABELS } from './media/property-asset-labels'
import { PropertyAssetRows, PropertyPhotoGrid } from './media/PropertyMediaGrid'
import { PropertyMediaSelection } from './media/PropertyMediaSelection'

type AssetCategory = PropertyWorkspaceAsset['asset_type']
const CATEGORIES: AssetCategory[] = ['photo', 'video', 'virtual_tour', 'floor_plan', 'document']
const GRID_PAGE_SIZE = 12

export function PropertyAssetManager({ propertyId, disabled = false, legacyPhotoCount = 0 }: { propertyId: string; disabled?: boolean; legacyPhotoCount?: number }) {
  const workspaceQuery = usePropertyWorkspace(propertyId)
  const createMutation = useCreatePropertyAsset(propertyId)
  const updateMutation = useUpdatePropertyAsset(propertyId)
  const deleteMutation = useDeletePropertyAsset(propertyId)
  const reorderMutation = useReorderPropertyAssets(propertyId)
  const primaryMutation = useSetPrimaryPropertyAsset(propertyId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<PropertyWorkspaceAsset | null>(null)
  const [deletingAsset, setDeletingAsset] = useState<PropertyWorkspaceAsset | null>(null)
  const [category, setCategory] = useState<AssetCategory>('photo')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE)
  const sortOrderReservations = useRef({
    propertyId,
    nextByType: new Map<string, number>(),
  })

  const response = workspaceQuery.data
  const assets = useMemo(
    () => [...(response?.data.assets ?? [])].sort(
      (left, right) => left.asset_type.localeCompare(right.asset_type)
        || left.sort_order - right.sort_order
        || left.created_at.localeCompare(right.created_at),
    ),
    [response?.data.assets],
  )
  useEffect(() => {
    if (!response || sortOrderReservations.current.propertyId !== propertyId) return
    releaseConfirmedPropertyAssetSortOrders(assets, sortOrderReservations.current.nextByType)
  }, [assets, propertyId, response])
  const canManage = Boolean(response?.meta.can_manage && response.meta.normalized_resources_available !== false)
  const photoCount = assets.filter((asset) => asset.asset_type === 'photo').length
  const photoCreationDisabled = photoCount >= PROPERTY_MEDIA_MAX_PHOTOS
  const pending = disabled || createMutation.isPending
    || updateMutation.isPending
    || deleteMutation.isPending
    || reorderMutation.isPending
    || primaryMutation.isPending

  const openCreate = () => {
    setEditingAsset(null)
    setDialogOpen(true)
  }

  const submitAsset = async (command: AssetSubmitCommand) => {
    if (command.mode === 'create') {
      if (sortOrderReservations.current.propertyId !== propertyId) {
        sortOrderReservations.current = {
          propertyId,
          nextByType: new Map<string, number>(),
        }
      }
      const nextSortOrder = reserveNextPropertyAssetSortOrder(
        assets,
        command.input.asset_type,
        sortOrderReservations.current.nextByType,
      )
      await createMutation.mutateAsync({
        input: { ...command.input, sort_order: nextSortOrder },
        file: command.file,
      })
    } else {
      await updateMutation.mutateAsync({ assetId: command.assetId, input: command.input })
    }
    setDialogOpen(false)
    setEditingAsset(null)
  }

  const moveAssetTo = async (asset: PropertyWorkspaceAsset, targetIndex: number) => {
    const siblings = assets.filter((item) => item.asset_type === asset.asset_type)
    const currentIndex = siblings.findIndex((item) => item.id === asset.id)
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length || targetIndex === currentIndex) return

    const reordered = [...siblings]
    const [moved] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    await reorderMutation.mutateAsync({
      items: reordered.map((item, index) => ({
        id: item.id,
        sort_order: index,
        expected_updated_at: item.updated_at,
      })),
    })
  }

  if (workspaceQuery.isLoading) {
    return (
      <div className="flex min-h-28 items-center justify-center rounded-[12px] bg-[var(--app-surface-solid)] text-[12px] font-light text-[var(--app-text-secondary)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando mídias protegidas…
      </div>
    )
  }

  if (workspaceQuery.isError || !response) {
    return (
      <div className="rounded-[12px] bg-destructive/10 p-4 text-[12px] font-light text-destructive">
        Não foi possível carregar as mídias. Atualize a ficha e tente novamente.
      </div>
    )
  }

  const property = response.data.property
  const categoryAssets = assets.filter((asset) => asset.asset_type === category)
  const shownAssets = categoryAssets.slice(0, visibleCount)
  const selectedIndex = categoryAssets.findIndex((asset) => asset.id === selectedId)
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0
  const selected = categoryAssets[safeIndex] ?? null
  const legacyLink = category === 'video' && 'video_imovel' in property
    ? safeExternalUrl(property.video_imovel)
    : category === 'virtual_tour' && 'tour_virtual' in property
      ? safeExternalUrl(property.tour_virtual)
      : null
  const legacyDocuments = category === 'document' ? property.documents ?? property.arquivos : null
  const legacyDocumentCount = Array.isArray(legacyDocuments)
    ? legacyDocuments.length
    : legacyDocuments ? Object.keys(legacyDocuments).length : 0

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <PropertyChipTabs
          value={category}
          ariaLabel="Categorias de mídia"
          onChange={(next) => {
            setCategory(next)
            setSelectedId(null)
            setVisibleCount(GRID_PAGE_SIZE)
          }}
          options={CATEGORIES.map((value) => ({
            value,
            label: `${ASSET_CATEGORY_LABELS[value]} ${assets.filter((asset) => asset.asset_type === value).length}`,
          }))}
        />
        {canManage && (
          <Button type="button" onClick={openCreate} disabled={pending} className={PROPERTY_PRIMARY_BUTTON_CLASS}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Adicionar mídia
          </Button>
        )}
      </div>

      {photoCreationDisabled && category === 'photo' && (
        <p role="status" className="rounded-[8px] bg-warning/10 px-3 py-2 text-[12px] font-light leading-[18px] text-[var(--app-text-primary)]">
          {photoCount} de {PROPERTY_MEDIA_MAX_PHOTOS} fotos: limite atingido, remova uma foto para adicionar outra. Fotos importadas existentes são preservadas e os outros dados do imóvel continuam editáveis.
          Para substituir uma foto usada no site, confira a versão na <a className="underline" href={`/properties/${propertyId}?tab=publication`}>Central de Publicação</a> antes de remover ou reenviar arquivos.
        </p>
      )}

      <div className="@container">
        <div className="grid min-w-0 gap-3 @[720px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Panel
            title={ASSET_CATEGORY_LABELS[category]}
            aside={category === 'photo'
              ? `${photoCount} de ${PROPERTY_MEDIA_MAX_PHOTOS}${canManage ? ' · arraste para mudar a ordem' : ''}`
              : category === 'document' ? 'Salvos automaticamente e protegidos' : undefined}
          >
            {categoryAssets.length === 0 && !legacyLink && legacyDocumentCount === 0 ? (
              <EmptyNote>
                {category === 'photo' && legacyPhotoCount > 0
                  ? `${legacyPhotoCount} ${legacyPhotoCount === 1 ? 'foto do cadastro anterior aparece' : 'fotos do cadastro anterior aparecem'} na Visão geral. As que você enviar aqui passam a ser as fotos do imóvel.`
                  : 'Nada cadastrado nesta categoria.'}
              </EmptyNote>
            ) : category === 'photo' || category === 'floor_plan' ? (
              <PropertyPhotoGrid
                assets={shownAssets}
                selectedId={selected?.id ?? null}
                canReorder={canManage && !pending}
                onSelect={(asset) => setSelectedId(asset.id)}
                onMove={(asset, targetIndex) => void moveAssetTo(asset, targetIndex).catch(() => undefined)}
              />
            ) : (
              <PropertyAssetRows assets={shownAssets} selectedId={selected?.id ?? null} onSelect={(asset) => setSelectedId(asset.id)} />
            )}
            {legacyLink && (
              <a href={legacyLink} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-[6px] px-2 py-2 text-[13px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]">
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" aria-hidden="true" />
                Link informado no cadastro
              </a>
            )}
            {legacyDocumentCount > 0 && (
              <p className="mt-2 px-2 text-[12px] font-light text-[var(--app-text-secondary)]">
                {legacyDocumentCount} {legacyDocumentCount === 1 ? 'documento registrado' : 'documentos registrados'} no cadastro anterior.
              </p>
            )}
            {shownAssets.length < categoryAssets.length && (
              <Button type="button" variant="ghost" className={`${PROPERTY_SECONDARY_BUTTON_CLASS} mt-3`} onClick={() => setVisibleCount((count) => count + GRID_PAGE_SIZE)}>
                Carregar mais ({shownAssets.length} de {categoryAssets.length})
              </Button>
            )}
          </Panel>

          {selected && (
            <PropertyMediaSelection
              asset={selected}
              position={safeIndex + 1}
              total={categoryAssets.length}
              canManage={canManage}
              pending={pending}
              onSetPrimary={() => primaryMutation.mutate({ assetId: selected.id, input: { expected_updated_at: selected.updated_at } })}
              onMove={(direction) => void moveAssetTo(selected, safeIndex + direction).catch(() => undefined)}
              onEdit={() => { setEditingAsset(selected); setDialogOpen(true) }}
              onDelete={() => setDeletingAsset(selected)}
            />
          )}
        </div>
      </div>

      {dialogOpen && (
        <PropertyAssetDialog
          key={editingAsset?.id ?? `create-${photoCreationDisabled}`}
          open
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) setEditingAsset(null)
          }}
          asset={editingAsset}
          photoCreationDisabled={photoCreationDisabled}
          pending={createMutation.isPending || updateMutation.isPending}
          onSubmit={submitAsset}
        />
      )}

      {deletingAsset && (
        <PropertyAssetDeleteDialog
          open
          onOpenChange={(open) => !open && setDeletingAsset(null)}
          asset={deletingAsset}
          pending={deleteMutation.isPending}
          onConfirm={async () => {
            await deleteMutation.mutateAsync({
              assetId: deletingAsset.id,
              input: { expected_updated_at: deletingAsset.updated_at },
            })
            setDeletingAsset(null)
          }}
        />
      )}
    </div>
  )
}
