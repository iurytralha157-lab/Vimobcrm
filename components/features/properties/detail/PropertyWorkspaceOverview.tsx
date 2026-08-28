'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import {
  Bath,
  BedDouble,
  Building2,
  Car,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe2,
  ImageIcon,
  MapPin,
  Ruler,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PropertyWorkspaceAsset, PropertyWorkspacePayload } from '@/lib/validation'
import { cn } from '@/lib/utils'

type WorkspaceProperty = PropertyWorkspacePayload['property']

type PropertyWorkspaceOverviewProps = {
  property: WorkspaceProperty
  assets: PropertyWorkspaceAsset[]
  images: string[]
  title: string
}

type DetailItem = {
  label: string
  value: string | number | null | undefined
}

const ASSET_TYPE_LABELS: Record<PropertyWorkspaceAsset['asset_type'], string> = {
  photo: 'Foto',
  video: 'Vídeo',
  virtual_tour: 'Tour virtual',
  floor_plan: 'Planta',
  document: 'Documento',
}

const ASSET_VISIBILITY_LABELS: Record<PropertyWorkspaceAsset['visibility'], string> = {
  public: 'Público',
  internal: 'Interno',
  confidential: 'Confidencial',
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return 'Não informado'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'Não informado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(
    'pt-BR',
    withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' },
  ).format(date)
}

function formatBoolean(value: boolean | null | undefined) {
  if (value == null) return 'Não informado'
  return value ? 'Sim' : 'Não'
}

function formatArea(value: number | null | undefined) {
  return value == null ? 'Não informado' : `${value.toLocaleString('pt-BR')} m²`
}

function formatFileSize(value: number | null) {
  if (value == null) return 'Não informado'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function DetailGrid({ items, columns = 2 }: { items: DetailItem[]; columns?: 2 | 3 }) {
  return (
    <dl className={cn('grid gap-2', columns === 3 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2')}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5">
          <dt className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-[12px] font-normal text-[var(--app-text-primary)]">
            {item.value === '' || item.value == null ? 'Não informado' : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function PropertyGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const thumbnailButtons = useRef<Array<HTMLButtonElement | null>>([])
  const safeIndex = images.length === 0 ? 0 : Math.min(activeIndex, images.length - 1)
  const activeImage = images[safeIndex]

  useEffect(() => {
    thumbnailButtons.current[safeIndex]?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [safeIndex])

  function showPreviousImage() {
    setActiveIndex((current) => {
      const boundedIndex = Math.min(Math.max(current, 0), images.length - 1)
      return (boundedIndex - 1 + images.length) % images.length
    })
  }

  function showNextImage() {
    setActiveIndex((current) => {
      const boundedIndex = Math.min(Math.max(current, 0), images.length - 1)
      return (boundedIndex + 1) % images.length
    })
  }

  return (
    <Card className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <CardTitle id="property-gallery-title" className="text-[14px] font-normal">
          Galeria do imóvel
        </CardTitle>
        <Badge variant="secondary" className="rounded-[4px] border-0 text-[10px] font-light">
          <ImageIcon className="mr-1 h-3 w-3" />
          {images.length}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)] sm:aspect-[16/9]">
          {activeImage ? (
            <Image
              src={activeImage}
              alt={`${title} — foto ${safeIndex + 1}`}
              fill
              loading="eager"
              sizes="(max-width: 1024px) 100vw, 66vw"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <span className="flex h-14 w-14 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
                <Building2 className="h-6 w-6 opacity-50" />
              </span>
              <span className="text-[12px] font-light">Imagem não cadastrada</span>
            </div>
          )}
          {images.length > 0 && (
            <span className="absolute bottom-3 right-3 rounded-[4px] bg-[var(--app-surface-solid)]/90 px-2 py-1 text-[10px] font-normal text-[var(--app-text-primary)]">
              {safeIndex + 1} / {images.length}
            </span>
          )}
          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Foto anterior"
                onClick={showPreviousImage}
                className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-solid)]/90 text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-solid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Próxima foto"
                onClick={showNextImage}
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-solid)]/90 text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-solid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {images.length > 1 && (
          <div
            className="flex max-w-full gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Miniaturas do imóvel"
          >
            {images.map((image, index) => (
              <button
                key={`${image}-${index}`}
                ref={(node) => {
                  thumbnailButtons.current[index] = node
                }}
                type="button"
                aria-label={`Ver foto ${index + 1} de ${images.length}`}
                aria-pressed={safeIndex === index}
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'relative aspect-[4/3] w-[88px] shrink-0 overflow-hidden rounded-[6px] border-2 bg-[var(--app-surface-soft)] transition-colors sm:w-[104px]',
                  safeIndex === index
                    ? 'border-primary'
                    : 'border-transparent hover:border-primary/35',
                )}
              >
                <Image
                  src={image}
                  alt=""
                  fill
                  loading={safeIndex === index ? 'eager' : 'lazy'}
                  sizes="104px"
                  className="object-cover"
                  unoptimized
                />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AssetCatalog({ assets }: { assets: PropertyWorkspaceAsset[] }) {
  if (assets.length === 0) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-5 text-center text-[12px] font-light text-muted-foreground">
        Nenhuma mídia ou documento cadastrado.
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset) => {
        const href = asset.access_url || asset.external_url
        const displayName = asset.title || asset.file_name || ASSET_TYPE_LABELS[asset.asset_type]

        return (
          <article key={asset.id} className="min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-primary">
                  {asset.asset_type === 'photo' ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <h4 className="break-words text-[12px] font-normal text-[var(--app-text-primary)]">{displayName}</h4>
                  <p className="mt-0.5 text-[10px] font-light text-muted-foreground">
                    {ASSET_TYPE_LABELS[asset.asset_type]} · {ASSET_VISIBILITY_LABELS[asset.visibility]}
                  </p>
                </div>
              </div>
              {asset.is_primary && (
                <Badge className="shrink-0 rounded-[4px] border-0 text-[9px] font-light">Principal</Badge>
              )}
            </div>

            {asset.description && (
              <p className="mt-3 whitespace-pre-wrap text-[11px] font-light leading-4 text-muted-foreground">
                {asset.description}
              </p>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--app-border)] pt-3 text-[10px] font-light">
              <div>
                <dt className="text-muted-foreground">Arquivo</dt>
                <dd className="mt-0.5 break-words text-[var(--app-text-primary)]">{asset.file_name || 'Não informado'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Formato</dt>
                <dd className="mt-0.5 break-words text-[var(--app-text-primary)]">{asset.mime_type || 'Não informado'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tamanho</dt>
                <dd className="mt-0.5 text-[var(--app-text-primary)]">{formatFileSize(asset.file_size_bytes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ordem</dt>
                <dd className="mt-0.5 text-[var(--app-text-primary)]">{asset.sort_order + 1}</dd>
              </div>
              {asset.asset_type === 'document' && (
                <>
                  <div>
                    <dt className="text-muted-foreground">Categoria</dt>
                    <dd className="mt-0.5 text-[var(--app-text-primary)]">{asset.document_category || 'Não informada'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Validade</dt>
                    <dd className="mt-0.5 text-[var(--app-text-primary)]">{formatDate(asset.expires_at)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-muted-foreground">Criado em</dt>
                <dd className="mt-0.5 text-[var(--app-text-primary)]">{formatDate(asset.created_at, true)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Atualizado em</dt>
                <dd className="mt-0.5 text-[var(--app-text-primary)]">{formatDate(asset.updated_at, true)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Origem do arquivo</dt>
                <dd className="mt-0.5 text-[var(--app-text-primary)]">
                  {asset.storage_path ? 'Armazenamento protegido' : asset.external_url ? 'Link externo' : 'Não informada'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Metadados</dt>
                <dd className="mt-0.5 text-[var(--app-text-primary)]">{Object.keys(asset.metadata).length} campos registrados</dd>
              </div>
            </dl>

            <p className="mt-3 break-all font-mono text-[9px] font-light text-muted-foreground">ID: {asset.id}</p>

            {href && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-[4px] text-[11px] font-normal text-primary hover:underline"
              >
                Abrir arquivo
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </article>
        )
      })}
    </div>
  )
}

export function PropertyWorkspaceOverview({
  property,
  assets,
  images,
  title,
}: PropertyWorkspaceOverviewProps) {
  const propertyType = property.tipo_de_imovel || property.tipo
  const hasManagerRegistration = Object.prototype.hasOwnProperty.call(property, 'numero_matricula')

  return (
    <div className="space-y-4 sm:space-y-5">
      <section aria-labelledby="property-gallery-title" className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <PropertyGallery images={images} title={title} />

        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px] font-normal">Características principais</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {[
              { icon: BedDouble, label: 'Quartos', value: property.quartos ?? 'Não informado' },
              { icon: Bath, label: 'Banheiros', value: property.banheiros ?? 'Não informado' },
              { icon: Car, label: 'Vagas', value: property.vagas ?? 'Não informado' },
              { icon: Ruler, label: 'Área útil', value: formatArea(property.area_util) },
              { icon: Ruler, label: 'Área total', value: formatArea(property.area_total) },
              { icon: Building2, label: 'Tipo', value: propertyType || 'Não informado' },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                <item.icon className="mb-2 h-4 w-4 text-primary" />
                <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">
                  {item.label}
                </p>
                <p className="mt-1 break-words text-[12px] font-normal text-[var(--app-text-primary)]">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="property-registration-title" className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle id="property-registration-title" className="flex items-center gap-2 text-[14px] font-normal">
              <Building2 className="h-4 w-4 text-primary" />
              Dados do cadastro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid
              items={[
                { label: 'Tipo do imóvel', value: property.tipo_de_imovel || property.tipo },
                { label: 'Preço de venda cadastrado', value: formatCurrency(property.preco) },
                { label: 'Valor de locação cadastrado', value: formatCurrency(property.valor_locacao) },
                { label: 'IPTU', value: formatCurrency(property.iptu) },
                ...(hasManagerRegistration
                  ? [{ label: 'Matrícula', value: property.numero_matricula }]
                  : []),
              ]}
              columns={3}
            />
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
              <MapPin className="h-4 w-4 text-primary" />
              Localização
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid
              items={[
                { label: 'Logradouro', value: property.endereco },
                { label: 'Número', value: property.numero },
                { label: 'Bairro', value: property.bairro },
                { label: 'Cidade', value: property.cidade },
                { label: 'UF', value: property.uf },
                { label: 'CEP', value: property.cep },
                { label: 'Visibilidade do endereço', value: property.address_visibility || property.public_address_visibility },
              ]}
            />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="property-description-title" className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle id="property-description-title" className="text-[14px] font-normal">Descrição e divulgação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">Descrição pública</p>
              <p className="mt-2 whitespace-pre-wrap text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
                {property.descricao_site || 'Nenhuma descrição pública cadastrada.'}
              </p>
            </div>
            <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">Descrição do cadastro</p>
              <p className="mt-2 whitespace-pre-wrap text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
                {property.descricao || 'Nenhuma descrição cadastrada.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
              <Globe2 className="h-4 w-4 text-primary" />
              Origem e publicação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailGrid
              items={[
                { label: 'Publicado no site', value: formatBoolean(property.published_on_site ?? property.anunciar) },
                ...(property.owner_name ? [{ label: 'Proprietário', value: property.owner_name }] : []),
              ]}
            />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="property-assets-title">
        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="pb-3">
            <CardTitle id="property-assets-title" className="flex items-center justify-between gap-3 text-[14px] font-normal">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Mídias e documentos
              </span>
              <Badge variant="secondary" className="rounded-[4px] border-0 text-[10px] font-light">{assets.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AssetCatalog assets={assets} />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
