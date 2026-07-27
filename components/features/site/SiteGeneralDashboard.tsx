'use client'

import Image from 'next/image'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe2,
  Link2,
  Power,
  Settings2,
  ShieldAlert,
  Tag,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ImageUpload } from '@/components/ui/image-upload'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { OrganizationSite } from '@/lib/api/site'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import type { SiteGeneralValues } from './site-control-center-types'
import { SitePerformancePanel } from './SitePerformancePanel'

type SiteGeneralDashboardProps = {
  site: OrganizationSite
  values: SiteGeneralValues
  canManage: boolean
  publicUrl: string | null
  previewUrl: string | null
  onChange: (patch: Partial<SiteGeneralValues>) => void
  onOpenDomainGuide: () => void
  onUploadLogo: (url: string | null) => Promise<void>
  onUploadFavicon: (url: string | null) => Promise<void>
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))
}

function getLifecycleLabel(values: SiteGeneralValues) {
  if (!values.is_active) return 'Rascunho'
  if (values.maintenance_mode) return 'Em manutenção'
  return 'Publicado'
}

export function SiteGeneralDashboard({
  site,
  values,
  canManage,
  publicUrl,
  previewUrl,
  onChange,
  onOpenDomainGuide,
  onUploadLogo,
  onUploadFavicon,
}: SiteGeneralDashboardProps) {
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false)
  const hasCustomDomain = Boolean(values.custom_domain.trim())
  const domainConnected = hasCustomDomain && site.domain_verified
  const lifecycleLabel = getLifecycleLabel(values)

  const copyPublicUrl = async () => {
    if (!publicUrl) return
    await navigator.clipboard.writeText(publicUrl)
    toast.success('Endereço copiado.')
  }

  const handleMaintenanceChange = (checked: boolean) => {
    if (!checked) {
      onChange({ maintenance_mode: false })
      return
    }
    setMaintenanceDialogOpen(true)
  }

  return (
    <>
      <section className="app-card overflow-hidden" aria-labelledby="site-control-center-title">
        <div className="flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
              {site.logo_url ? (
                <Image
                  src={site.logo_url}
                  alt=""
                  width={48}
                  height={48}
                  className="h-full w-full object-contain p-2"
                  unoptimized
                />
              ) : (
                <Globe2 className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="site-control-center-title" className="truncate text-base font-semibold">
                  {domainConnected
                    ? values.custom_domain
                    : publicUrl
                      ? publicUrl.replace(/^https?:\/\//, '')
                      : 'Seu site imobiliário'}
                </h2>
                <span
                  className={cn(
                    'rounded-[6px] px-2 py-1 text-[11px] font-medium',
                    values.maintenance_mode && values.is_active
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : values.is_active
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[var(--app-surface-soft)] text-muted-foreground',
                  )}
                >
                  {lifecycleLabel}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Criado em {formatCreatedAt(site.created_at)}
              </p>
              {publicUrl && (
                <button
                  type="button"
                  onClick={copyPublicUrl}
                  className="mt-2 flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="truncate font-mono">{publicUrl.replace(/^https?:\/\//, '')}</span>
                  <Copy className="h-3 w-3 shrink-0" />
                </button>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!domainConnected && (
              <Button
                type="button"
                onClick={onOpenDomainGuide}
                className="rounded-[6px]"
              >
                <Link2 className="mr-2 h-4 w-4" />
                {hasCustomDomain ? 'Ver guia' : 'Conectar domínio'}
              </Button>
            )}
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <Button
                  type="button"
                  variant={domainConnected ? 'default' : 'outline'}
                  className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-foreground shadow-none hover:bg-[var(--app-surface-hover)]"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Abrir site
                </Button>
              </a>
            )}
          </div>
        </div>

        <div
          className={cn(
            'mx-5 mb-5 flex flex-col gap-3 rounded-[8px] px-4 py-3 md:mx-6 md:mb-6 sm:flex-row sm:items-center sm:justify-between',
            domainConnected
              ? 'bg-emerald-500/10'
              : hasCustomDomain
                ? 'bg-amber-500/10'
                : 'bg-[var(--app-surface-soft)]',
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {domainConnected ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : hasCustomDomain ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            ) : (
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">
                {domainConnected
                  ? 'Domínio conectado'
                  : hasCustomDomain
                    ? 'O domínio ainda não está conectado ao seu site'
                    : 'Você ainda não conectou um domínio próprio'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {domainConnected
                  ? `${values.custom_domain} está verificado e pronto para receber visitantes.`
                  : hasCustomDomain
                    ? 'Conclua o Worker no Cloudflare e faça a verificação. Você pode continuar editando normalmente.'
                    : 'O endereço Vimob continua disponível; conectar um domínio próprio é opcional.'}
              </p>
            </div>
          </div>
          {!domainConnected && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenDomainGuide}
              className="shrink-0 hover:bg-[var(--app-surface-hover)]"
            >
              {hasCustomDomain ? 'Ver guia' : 'Configurar'}
            </Button>
          )}
        </div>
      </section>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(390px,0.92fr)]">
        <section className="app-card p-5 md:p-6" aria-labelledby="site-essentials-title">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            <h2 id="site-essentials-title" className="text-base font-semibold">Essenciais</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            O necessário para identificar, publicar e acessar o site.
          </p>

          <div className="mt-5 space-y-3">
            <div className="app-card-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Power className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Publicação</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Em rascunho, o site continua editável e não fica público.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto">
                <span className="text-xs text-muted-foreground">{values.is_active ? 'Publicado' : 'Rascunho'}</span>
                <Switch
                  checked={values.is_active}
                  onCheckedChange={(checked) => onChange({
                    is_active: checked,
                    ...(!checked ? { maintenance_mode: false } : {}),
                  })}
                  disabled={!canManage}
                  aria-label="Publicar site"
                />
              </div>
            </div>

            <div className="app-card-soft p-4">
              <Label htmlFor="site-slug" className="flex items-center gap-2 text-sm">
                <Tag className="h-4 w-4 text-muted-foreground" />
                Slug do site
              </Label>
              <Input
                id="site-slug"
                className="mt-3 border-0 bg-[var(--app-surface-solid)] shadow-none"
                placeholder="sua-imobiliaria"
                value={values.subdomain}
                onChange={(event) => onChange({
                  subdomain: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                })}
                disabled={!canManage}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Mantém o site acessível mesmo sem domínio próprio.
              </p>
            </div>

            <div className="app-card-soft p-4">
              <Label htmlFor="site-title" className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Título do site
              </Label>
              <Input
                id="site-title"
                className="mt-3 border-0 bg-[var(--app-surface-solid)] shadow-none"
                placeholder="Nome da sua imobiliária"
                value={values.site_title}
                onChange={(event) => onChange({ site_title: event.target.value })}
                maxLength={180}
                disabled={!canManage}
              />
            </div>

            <div className="app-card-soft p-4">
              <Label htmlFor="site-description" className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Descrição
              </Label>
              <Textarea
                id="site-description"
                className="mt-3 min-h-24 resize-y border-0 bg-[var(--app-surface-solid)] shadow-none"
                placeholder="Uma breve descrição da sua imobiliária..."
                value={values.site_description}
                onChange={(event) => onChange({ site_description: event.target.value })}
                maxLength={500}
                disabled={!canManage}
              />
              <p className="mt-2 text-right text-[11px] text-muted-foreground">
                {values.site_description.length}/500
              </p>
            </div>

            <div className="app-card-soft p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <Link2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Domínio próprio</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {values.custom_domain || 'Nenhum domínio informado'}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-end border-0 bg-[var(--app-surface-solid)] shadow-none hover:bg-[var(--app-surface-hover)] sm:self-auto"
                  onClick={onOpenDomainGuide}
                >
                  {domainConnected ? 'Revisar' : 'Configurar'}
                </Button>
              </div>
            </div>

            <div className="app-card-soft p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <Wrench className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Modo manutenção</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Mantém o endereço no ar e mostra um aviso aos visitantes.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={values.maintenance_mode}
                  onCheckedChange={handleMaintenanceChange}
                  disabled={!canManage || !values.is_active}
                  aria-label="Ativar modo manutenção"
                />
              </div>

              {values.maintenance_mode && (
                <div className="mt-4">
                  <Label htmlFor="maintenance-message" className="text-xs">Mensagem para os visitantes</Label>
                  <Textarea
                    id="maintenance-message"
                    className="mt-2 min-h-20 resize-y border-0 bg-[var(--app-surface-solid)] shadow-none"
                    value={values.maintenance_message}
                    placeholder="Estamos preparando novidades. Voltamos em breve."
                    maxLength={500}
                    onChange={(event) => onChange({ maintenance_message: event.target.value })}
                    disabled={!canManage}
                  />
                  <p className="mt-2 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300">
                    <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    A alteração pode levar até 5 minutos para aparecer em domínios com cache do Cloudflare.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <SitePerformancePanel
          publicUrl={publicUrl}
          isPublished={values.is_active && !values.maintenance_mode}
        />
      </div>

      <section className="app-card mt-4 p-5 md:p-6" aria-labelledby="site-identity-title">
        <div>
          <h2 id="site-identity-title" className="text-base font-semibold">Identidade do site</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Logo principal e ícone exibido na aba do navegador.
          </p>
        </div>
        <div className="mt-5 grid items-start gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)]">
          <ImageUpload
            label="Logo"
            description="PNG, JPG ou WebP recomendado"
            value={site.logo_url}
            onChange={onUploadLogo}
            bucket="site-images"
            path="sites"
            assetType="logo"
            disabled={!canManage}
            aspectRatio="banner"
            className="min-w-0"
          />
          <ImageUpload
            label="Favicon"
            description="Ícone do navegador"
            value={site.favicon_url}
            onChange={onUploadFavicon}
            bucket="site-images"
            path="sites"
            assetType="favicon"
            disabled={!canManage}
            aspectRatio="square"
            className="min-w-0 md:max-w-[260px]"
          />
        </div>
      </section>

      <AlertDialog open={maintenanceDialogOpen} onOpenChange={setMaintenanceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar modo manutenção?</AlertDialogTitle>
            <AlertDialogDescription>
              Depois de salvar, os visitantes verão apenas a mensagem de manutenção e o site deixará de ser indexado até você desativar esse modo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onChange({
                maintenance_mode: true,
                maintenance_message: values.maintenance_message || 'Estamos preparando novidades. Voltamos em breve.',
              })}
            >
              Ativar manutenção
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
