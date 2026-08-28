'use client'

import { useState, type FormEvent } from 'react'
import { FileUp, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  PropertyAssetCreateInput,
  PropertyAssetUpdateInput,
  PropertyWorkspaceAsset,
} from '@/lib/validation'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])

type AssetCreateInput = Omit<PropertyAssetCreateInput, 'storage_path'>

type AssetSubmitCommand =
  | { mode: 'create'; input: AssetCreateInput; file?: File | null }
  | { mode: 'update'; assetId: string; input: PropertyAssetUpdateInput }

interface PropertyAssetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset?: PropertyWorkspaceAsset | null
  pending?: boolean
  onSubmit: (command: AssetSubmitCommand) => Promise<void>
}

function valueOrNull(value: string) {
  return value.trim() || null
}

export function PropertyAssetDialog({
  open,
  onOpenChange,
  asset,
  pending = false,
  onSubmit,
}: PropertyAssetDialogProps) {
  const editing = Boolean(asset)
  const [assetType, setAssetType] = useState<PropertyWorkspaceAsset['asset_type']>(asset?.asset_type ?? 'photo')
  const [visibility, setVisibility] = useState<PropertyWorkspaceAsset['visibility']>(asset?.visibility ?? 'internal')
  const [sourceMode, setSourceMode] = useState<'file' | 'url'>(asset?.external_url ? 'url' : 'file')
  const [file, setFile] = useState<File | null>(null)
  const [externalURL, setExternalURL] = useState(asset?.external_url ?? '')
  const [title, setTitle] = useState(asset?.title ?? '')
  const [description, setDescription] = useState(asset?.description ?? '')
  const [documentCategory, setDocumentCategory] = useState(asset?.document_category ?? '')
  const [expiresAt, setExpiresAt] = useState(asset?.expires_at ?? '')
  const [localError, setLocalError] = useState<string | null>(null)

  const supportsFile = assetType === 'photo' || assetType === 'floor_plan' || assetType === 'document'
  const storedAsset = Boolean(asset?.storage_path)

  const changeAssetType = (value: PropertyWorkspaceAsset['asset_type']) => {
    setAssetType(value)
    setLocalError(null)
    if (value === 'video' || value === 'virtual_tour') {
      setSourceMode('url')
      setFile(null)
    }
  }

  const validateFile = (candidate: File) => {
    if (!ALLOWED_UPLOAD_TYPES.has(candidate.type)) {
      return 'Use arquivos JPEG, PNG, WebP, GIF ou PDF.'
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      return 'O arquivo deve ter no máximo 10 MB.'
    }
    if (assetType === 'photo' && !candidate.type.startsWith('image/')) {
      return 'Fotos precisam usar um formato de imagem.'
    }
    if (assetType === 'document' && candidate.type !== 'application/pdf') {
      return 'Documentos precisam usar o formato PDF.'
    }
    return null
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLocalError(null)

    if (!editing && sourceMode === 'file') {
      if (!file) {
        setLocalError('Selecione um arquivo para enviar.')
        return
      }
      const fileError = validateFile(file)
      if (fileError) {
        setLocalError(fileError)
        return
      }
    }

    const common = {
      asset_type: assetType,
      visibility,
      title: valueOrNull(title),
      description: valueOrNull(description),
      document_category: assetType === 'document' ? valueOrNull(documentCategory) : null,
      expires_at: assetType === 'document' ? valueOrNull(expiresAt) : null,
      metadata: asset?.metadata ?? {},
    }

    if (asset) {
      await onSubmit({
        mode: 'update',
        assetId: asset.id,
        input: {
          ...common,
          storage_path: storedAsset ? undefined : null,
          external_url: storedAsset ? undefined : valueOrNull(externalURL),
          file_name: asset.file_name,
          mime_type: asset.mime_type,
          file_size_bytes: asset.file_size_bytes,
          expected_updated_at: asset.updated_at,
        },
      })
      return
    }

    await onSubmit({
      mode: 'create',
      input: {
        ...common,
        external_url: sourceMode === 'url' ? valueOrNull(externalURL) : null,
        file_name: sourceMode === 'file' ? file?.name ?? null : null,
        mime_type: sourceMode === 'file' ? file?.type ?? null : null,
        file_size_bytes: sourceMode === 'file' ? file?.size ?? null : null,
        sort_order: 0,
        is_primary: false,
      },
      file: sourceMode === 'file' ? file : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar mídia ou documento' : 'Adicionar mídia ou documento'}</DialogTitle>
            <DialogDescription>
              Organize fotos, plantas, documentos, vídeos e tours com visibilidade controlada.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="asset-type">Tipo</Label>
                <Select value={assetType} onValueChange={(value) => changeAssetType(value as PropertyWorkspaceAsset['asset_type'])} disabled={editing}>
                  <SelectTrigger id="asset-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="photo">Foto</SelectItem>
                    <SelectItem value="floor_plan">Planta</SelectItem>
                    <SelectItem value="document">Documento</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                    <SelectItem value="virtual_tour">Tour virtual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset-visibility">Visibilidade</Label>
                <Select value={visibility} onValueChange={(value) => setVisibility(value as PropertyWorkspaceAsset['visibility'])}>
                  <SelectTrigger id="asset-visibility"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Público</SelectItem>
                    <SelectItem value="internal">Uso interno</SelectItem>
                    <SelectItem value="confidential">Confidencial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="asset-source">Origem</Label>
                <Select value={sourceMode} onValueChange={(value) => setSourceMode(value as 'file' | 'url')}>
                  <SelectTrigger id="asset-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {supportsFile && <SelectItem value="file">Enviar arquivo</SelectItem>}
                    <SelectItem value="url">URL externa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {!editing && sourceMode === 'file' && (
              <div className="space-y-2 rounded-lg border border-dashed p-4">
                <Label htmlFor="asset-file" className="flex items-center gap-2"><FileUp className="h-4 w-4" />Arquivo</Label>
                <Input
                  id="asset-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null
                    setFile(nextFile)
                    setLocalError(nextFile ? validateFile(nextFile) : null)
                  }}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {assetType === 'document' ? 'PDF' : assetType === 'photo' ? 'JPEG, PNG, WebP ou GIF' : 'JPEG, PNG, WebP, GIF ou PDF'}, com até 10 MB.
                </p>
              </div>
            )}

            {((!editing && sourceMode === 'url') || (editing && !storedAsset)) && (
              <div className="space-y-2">
                <Label htmlFor="asset-url">URL externa</Label>
                <Input
                  id="asset-url"
                  type="url"
                  value={externalURL}
                  onChange={(event) => setExternalURL(event.target.value)}
                  placeholder="https://..."
                  required
                />
              </div>
            )}

            {editing && storedAsset && (
              <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                O arquivo armazenado será preservado. Para substituí-lo, remova este ativo e envie um novo.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="asset-title">Título</Label>
              <Input id="asset-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="Ex.: Fachada principal" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-description">Descrição</Label>
              <Textarea id="asset-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2_000} />
            </div>

            {assetType === 'document' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="asset-document-category">Categoria</Label>
                  <Input id="asset-document-category" value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value)} maxLength={120} placeholder="Ex.: matrícula" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-expires-at">Validade</Label>
                  <Input id="asset-expires-at" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                </div>
              </div>
            )}

            {localError && <p role="alert" className="text-sm text-destructive">{localError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending || Boolean(localError)}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Salvar alterações' : 'Adicionar ativo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type { AssetSubmitCommand }
