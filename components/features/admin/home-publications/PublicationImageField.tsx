import Image from 'next/image'
import { ImageIcon, ImagePlus, Trash2 } from 'lucide-react'
import type { ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'

export function PublicationImageField({
  variant, imageUrl, title, disabled, selected, canRestore, onSelect, onRemove, onRestore,
}: {
  variant: 'desktop' | 'mobile'
  imageUrl: string | null
  title: string
  disabled: boolean
  selected: boolean
  canRestore: boolean
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onRemove: () => void
  onRestore: () => void
}) {
  const label = variant === 'desktop' ? 'Desktop' : 'Celular'
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-soft)]">
      <p className="px-3 py-2 text-sm font-normal">Imagem {label}{variant === 'mobile' ? ' (opcional)' : ''}</p>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={title || 'Prévia do slide'}
          width={2070}
          height={228}
          sizes="(max-width: 1024px) 100vw, 280px"
          className="block h-auto w-full object-contain"
          unoptimized
        />
      ) : (
        <div className="flex min-h-28 flex-col items-center justify-center text-muted-foreground">
          <ImageIcon className="h-8 w-8" strokeWidth={1.5} />
          <p className="mt-2 text-xs">Escolha uma imagem para o slide</p>
        </div>
      )}
      <div className="space-y-2 border-t border-[var(--app-border)] p-3">
        <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 text-xs font-normal transition-colors hover:bg-[var(--app-surface-hover)] focus-within:ring-2 focus-within:ring-primary/30">
          <ImagePlus className="h-3.5 w-3.5" />
          {imageUrl ? 'Trocar imagem' : 'Escolher imagem'} {label}
          <input type="file" aria-label={`Imagem para ${label.toLowerCase()}`} accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onSelect} disabled={disabled} />
        </label>
        {imageUrl ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled} className="w-full text-red-500 hover:bg-red-500/10 hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" />
            {selected ? 'Remover seleção' : 'Remover imagem'} {label}
          </Button>
        ) : null}
        {canRestore ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRestore} disabled={disabled} className="w-full">Restaurar imagem {label} atual</Button>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">JPEG, PNG ou WebP de até 5 MB. {variant === 'desktop' ? 'Recomendado: 2070 × 228 px.' : 'Sem esta versão, o celular usa a imagem desktop.'} A arte aparece inteira, sem corte e sem clique.</p>
        {selected ? <p className="text-xs text-muted-foreground">A imagem será enviada ao salvar.</p> : null}
      </div>
    </div>
  )
}
