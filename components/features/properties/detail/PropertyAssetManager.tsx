'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react'

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

import { PropertyAssetDeleteDialog } from './PropertyAssetDeleteDialog'
import { PropertyAssetDialog, type AssetSubmitCommand } from './PropertyAssetDialog'
import { AssetCatalog } from './PropertyWorkspaceOverview'

export function PropertyAssetManager({ propertyId }: { propertyId: string }) {
  const workspaceQuery = usePropertyWorkspace(propertyId)
  const createMutation = useCreatePropertyAsset(propertyId)
  const updateMutation = useUpdatePropertyAsset(propertyId)
  const deleteMutation = useDeletePropertyAsset(propertyId)
  const reorderMutation = useReorderPropertyAssets(propertyId)
  const primaryMutation = useSetPrimaryPropertyAsset(propertyId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<PropertyWorkspaceAsset | null>(null)
  const [deletingAsset, setDeletingAsset] = useState<PropertyWorkspaceAsset | null>(null)

  const response = workspaceQuery.data
  const assets = useMemo(
    () => [...(response?.data.assets ?? [])].sort(
      (left, right) => left.asset_type.localeCompare(right.asset_type)
        || left.sort_order - right.sort_order
        || left.created_at.localeCompare(right.created_at),
    ),
    [response?.data.assets],
  )
  const canManage = Boolean(response?.meta.can_manage && response.meta.normalized_resources_available !== false)
  const photoCount = assets.filter((asset) => asset.asset_type === 'photo').length
  const photoCreationDisabled = photoCount >= PROPERTY_MEDIA_MAX_PHOTOS
  const pending = createMutation.isPending
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
      await createMutation.mutateAsync({ input: command.input, file: command.file })
    } else {
      await updateMutation.mutateAsync({ assetId: command.assetId, input: command.input })
    }
    setDialogOpen(false)
    setEditingAsset(null)
  }

  const moveAsset = async (asset: PropertyWorkspaceAsset, direction: -1 | 1) => {
    const siblings = assets.filter((item) => item.asset_type === asset.asset_type)
    const currentIndex = siblings.findIndex((item) => item.id === asset.id)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return

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
      <div className="flex min-h-28 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando mídias protegidas…
      </div>
    )
  }

  if (workspaceQuery.isError || !response) {
    return (
      <div className="rounded-[8px] bg-destructive/10 p-4 text-[12px] text-destructive">
        Não foi possível carregar as mídias. Atualize a ficha e tente novamente.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[12px] font-normal text-[var(--app-text-primary)]">Biblioteca canônica do imóvel</p>
          <p className="mt-1 text-[11px] font-light text-muted-foreground">
            Arquivos ficam privados no Storage e alterações desta área são salvas automaticamente.
          </p>
          <p className="mt-1 text-[11px] font-light text-muted-foreground">
            {photoCount}/{PROPERTY_MEDIA_MAX_PHOTOS} fotos
            {photoCreationDisabled
              ? ' — limite atingido; remova uma foto para adicionar outra.'
              : ''}
          </p>
        </div>
        {canManage && (
          <Button type="button" size="sm" onClick={openCreate} disabled={pending}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Adicionar mídia
          </Button>
        )}
      </div>

      <AssetCatalog
        assets={assets}
        renderActions={canManage ? (asset) => {
          const siblings = assets.filter((item) => item.asset_type === asset.asset_type)
          const index = siblings.findIndex((item) => item.id === asset.id)
          return (
            <div className="mt-3 flex flex-wrap gap-1 border-t border-[var(--app-border)] pt-3">
              {asset.asset_type === 'photo' && !asset.is_primary && asset.visibility === 'public' && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => primaryMutation.mutate({ assetId: asset.id, input: { expected_updated_at: asset.updated_at } })}>
                  <Star className="mr-1.5 h-3.5 w-3.5" />Principal
                </Button>
              )}
              <Button type="button" variant="ghost" size="icon" aria-label="Mover para cima" disabled={pending || index <= 0} onClick={() => void moveAsset(asset, -1).catch(() => undefined)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Mover para baixo" disabled={pending || index >= siblings.length - 1} onClick={() => void moveAsset(asset, 1).catch(() => undefined)}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setEditingAsset(asset); setDialogOpen(true) }}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />Editar
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => setDeletingAsset(asset)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remover
              </Button>
            </div>
          )
        } : undefined}
      />

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
