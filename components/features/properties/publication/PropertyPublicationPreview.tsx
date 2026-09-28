'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  Bath,
  BedDouble,
  Car,
  ChevronLeft,
  ChevronRight,
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
import { formatPropertyCurrency } from '@/lib/property-display-utils'
import type { PropertyChannelPublication } from '@/lib/validation'

type PropertyPublicationPreviewProps = {
  publication: PropertyChannelPublication
  imageUrls?: string[]
}

function formatPreviewPrice(price: number | string | null | undefined, label?: string) {
  let formattedPrice = 'Preço sob consulta'
  if (typeof price === 'number') {
    formattedPrice = formatPropertyCurrency(price)
  } else if (typeof price === 'string' && price.trim()) {
    formattedPrice = price
  }
  return label ? `${formattedPrice} · ${label}` : formattedPrice
}

export function PropertyPublicationPreview({ publication, imageUrls }: PropertyPublicationPreviewProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const preview = publication.preview
  const images = Array.from(new Set([
    ...(imageUrls ?? [preview.primary_image_url, ...(preview.image_urls ?? [])]),
  ].filter((value): value is string => Boolean(value))))
  const selectedImage = images[selectedImageIndex] || images[0]
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
            {selectedImage ? (
              <Image
                src={selectedImage}
                alt={`${preview.title || `Prévia de ${publication.label}`} · foto ${images.indexOf(selectedImage) + 1} de ${images.length}`}
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
              <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)]/90 p-1 text-[var(--app-text-primary)]">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Foto anterior" onClick={() => setSelectedImageIndex((index) => (index - 1 + images.length) % images.length)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-10 text-center text-xs">{images.indexOf(selectedImage) + 1}/{images.length}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Próxima foto" onClick={() => setSelectedImageIndex((index) => (index + 1) % images.length)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            <DialogHeader className="pr-8">
              <DialogTitle className="text-[20px] font-normal leading-tight">
                {preview.title || 'Imóvel sem título público'}
              </DialogTitle>
              <DialogDescription>
                {publication.published_version == null
                  ? 'Prévia do imóvel com fotos públicas disponíveis neste momento. A publicação ainda será processada pelo canal.'
                  : 'Prévia da versão registrada para este canal. Dados internos não são incluídos.'}
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
