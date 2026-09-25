'use client'

import Image from 'next/image'
import { useRef, useState, type ChangeEvent } from 'react'
import { Loader2, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { uploadFile } from '@/lib/upload-utils'

type SiteFooterLogoUploadProps = {
  value: string | null
  onChange: (url: string | null) => Promise<void>
  disabled: boolean
}

export function SiteFooterLogoUpload({ value, onChange, disabled }: SiteFooterLogoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setPending(true)
    try {
      const url = await uploadFile(file, {
        bucket: 'site-images',
        path: 'sites',
        assetType: 'footer_logo',
        maxSizeInMB: 5,
      })
      if (url) await onChange(url)
    } catch {
      // The site mutation reports the save error; keep the current preview.
    } finally {
      setPending(false)
      event.target.value = ''
    }
  }

  const handleRemove = async () => {
    setPending(true)
    try {
      await onChange(null)
    } catch {
      // The site mutation reports the save error; keep the current preview.
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <Label htmlFor="site-footer-logo" className="text-sm font-medium">
        Logo do rodapé (opcional)
      </Label>
      <button
        type="button"
        className="relative flex min-h-[150px] w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/20 bg-muted/30 transition-colors hover:border-primary/50 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || pending}
        aria-label={value ? 'Trocar logo do rodapé' : 'Enviar logo do rodapé'}
      >
        {pending ? (
          <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            Salvando logo...
          </span>
        ) : value ? (
          <Image src={value} alt="Prévia da logo do rodapé" fill sizes="320px" className="object-contain p-2" unoptimized />
        ) : (
          <span className="flex flex-col items-center gap-2 text-center text-sm">
            <Upload className="h-6 w-6 text-primary" />
            Clique para fazer upload
          </span>
        )}
      </button>
      <input
        id="site-footer-logo"
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={handleFileChange}
        disabled={disabled || pending}
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Se estiver vazia, o rodapé usa a logo principal. PNG, JPG ou WebP até 5 MB.
        </p>
        {value ? (
          <Button type="button" size="sm" variant="ghost" onClick={handleRemove} disabled={disabled || pending} aria-label="Remover logo do rodapé">
            <X className="mr-1 h-4 w-4" /> Remover
          </Button>
        ) : null}
      </div>
    </div>
  )
}
