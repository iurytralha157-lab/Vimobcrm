'use client'

import Image from 'next/image'
import {
  Bath,
  BedDouble,
  Car,
  ExternalLink,
  Eye,
  ImageIcon,
  MapPin,
  Ruler,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PropertyChannelPublication } from '@/lib/validation'

type PropertyPublicationPreviewProps = {
  publication: PropertyChannelPublication
}

function formatPreviewPrice(price: number | string | null | undefined, label?: string) {
  let formattedPrice = 'Preço sob consulta'
  if (typeof price === 'number') {
    formattedPrice = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    }).format(price)
  } else if (typeof price === 'string' && price.trim()) {
    formattedPrice = price
  }
  return label ? `${formattedPrice} · ${label}` : formattedPrice
}

export function PropertyPublicationPreview({ publication }: PropertyPublicationPreviewProps) {
  const preview = publication.preview
  const images = Array.from(new Set([
    preview.primary_image_url,
    ...(preview.image_urls ?? []),
  ].filter((value): value is string => Boolean(value))))
  const publicURL = publication.public_url || preview.public_url
  const metrics = [
    { label: 'Quartos', value: preview.bedrooms, icon: BedDouble },
    { label: 'Banheiros', value: preview.bathrooms, icon: Bath },
    { label: 'Vagas', value: preview.parking_spaces, icon: Car },
    { label: 'Área', value: preview.area == null ? null : `${preview.area} m²`, icon: Ruler },
  ].filter((item) => item.value != null)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Eye className="mr-2 h-4 w-4" />
          Ver prévia
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0">
        <ScrollArea className="max-h-[92vh]">
          <div className="relative aspect-[16/8] min-h-52 bg-muted sm:min-h-72">
            {images[0] ? (
              <Image
                src={images[0]}
                alt={preview.title || `Prévia de ${publication.label}`}
                fill
                sizes="(max-width: 768px) 100vw, 896px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-14 w-14 opacity-30" />
              </div>
            )}
            <Badge className="absolute left-4 top-4 bg-[var(--app-surface-solid)]/80 text-[var(--app-text-primary)] hover:bg-[var(--app-surface-solid)]">
              Prévia segura · {publication.label}
            </Badge>
            {images.length > 1 && (
              <Badge className="absolute bottom-4 right-4 bg-[var(--app-surface-solid)]/80 text-[var(--app-text-primary)] hover:bg-[var(--app-surface-solid)]">
                {images.length} imagens
              </Badge>
            )}
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-[20px] font-normal leading-tight">
                {preview.title || 'Imóvel sem título público'}
              </DialogTitle>
              <DialogDescription>
                Esta é a projeção pública gerada pelo servidor para este canal. Dados internos não são incluídos.
              </DialogDescription>
            </DialogHeader>

            <div>
              <p className="text-[20px] font-normal text-primary">
                {formatPreviewPrice(preview.price, preview.price_label)}
              </p>
              {preview.address && (
                <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {preview.address}
                </p>
              )}
            </div>

            {metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {metrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border bg-muted/30 p-3">
                    <metric.icon className="mb-2 h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{metric.value}</p>
                    <p className="text-xs text-muted-foreground">{metric.label}</p>
                  </div>
                ))}
              </div>
            )}

            {preview.description && (
              <div>
                <h3 className="text-[14px] font-normal">Descrição pública</h3>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                  {preview.description}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Versão atual {publication.current_version || 'ainda não criada'}
              </p>
              {publicURL && publication.observed_state === 'published' && (
                <Button asChild size="sm">
                  <a href={publicURL} target="_blank" rel="noopener noreferrer">
                    Abrir publicação
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
