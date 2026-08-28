'use client'

import {
  ArrowLeft,
  Check,
  Cloud,
  Code2,
  Copy,
  ExternalLink,
  Globe2,
  Route,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OrganizationSite } from '@/lib/api/site'
import { getCloudflareSetupInstructions } from '@/lib/site/cloudflare-worker'
import { cn } from '@/lib/utils'

import { DnsVerificationStatus } from './DnsVerificationStatus'

type DomainConnectionGuideProps = {
  site: OrganizationSite
  domain: string
  canManage: boolean
  workerCode: string
  onDomainChange: (domain: string) => void
  onBack: () => void
}

function normalizeDomainInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/\s+/g, '')
}

function GuideStep({
  number,
  icon: Icon,
  title,
  description,
  children,
}: {
  number: number
  icon: typeof Cloud
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <section className="app-card-soft p-5 md:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/50 text-[12px] font-light text-primary-foreground">
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h2 className="text-[14px] font-normal">{title}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {children && <div className="mt-4">{children}</div>}
        </div>
      </div>
    </section>
  )
}

export function DomainConnectionGuide({
  site,
  domain,
  canManage,
  workerCode,
  onDomainChange,
  onBack,
}: DomainConnectionGuideProps) {
  const persistedDomain = site.custom_domain?.trim() || ''
  const normalizedDomain = domain.trim().toLowerCase()
  const domainSaved = Boolean(normalizedDomain) && normalizedDomain === persistedDomain
  const instructions = domainSaved
    ? getCloudflareSetupInstructions(normalizedDomain, workerCode)
    : ''

  const copyText = async (value: string, successMessage: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(successMessage)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 hover:bg-[var(--app-surface-hover)]"
            onClick={onBack}
            aria-label="Voltar ao painel geral"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-[14px] font-normal">Conecte seu domínio à Vimob</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              O Cloudflare mantém SSL, cache e disponibilidade enquanto a Vimob entrega o site.
            </p>
          </div>
        </div>
        {instructions && (
          <Button
            type="button"
            variant="outline"
            className="self-end border-0 bg-[var(--app-surface-soft)] shadow-none hover:bg-[var(--app-surface-hover)] sm:self-auto"
            onClick={() => copyText(instructions, 'Instruções copiadas.')}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copiar instruções
          </Button>
        )}
      </div>

      <section className="app-card p-5 md:p-6">
        <div className="flex items-start gap-3">
          <Globe2 className="mt-0.5 h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <Label htmlFor="custom-domain-guide" className="text-[12px] font-light">Seu domínio</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Informe somente o domínio, sem https:// ou caminhos.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                id="custom-domain-guide"
                placeholder="www.suaimobiliaria.com.br"
                value={domain}
                onChange={(event) => onDomainChange(normalizeDomainInput(event.target.value))}
                disabled={!canManage}
                className="border-0 bg-[var(--app-surface-soft)] shadow-none"
              />
              <div
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-[8px] px-3 py-2 text-xs',
                  site.domain_verified && domainSaved
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-[var(--app-surface-soft)] text-muted-foreground',
                )}
              >
                {site.domain_verified && domainSaved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {site.domain_verified && domainSaved ? 'Conectado' : domainSaved ? 'Salvo' : 'Salve para continuar'}
              </div>
            </div>
            {!domainSaved && normalizedDomain && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                Clique em “Salvar alterações” no topo antes de copiar o Worker. Ao salvar um novo domínio, a Vimob gera um token exclusivo de verificação.
              </p>
            )}
          </div>
        </div>
      </section>

      <GuideStep
        number={1}
        icon={Cloud}
        title="Crie ou acesse sua conta no Cloudflare"
        description="O plano gratuito é suficiente para conectar e proteger o domínio."
      >
        <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener noreferrer">
          <Button type="button" variant="outline" className="border-0 bg-[var(--app-surface-solid)] shadow-none hover:bg-[var(--app-surface-hover)]">
            Abrir Cloudflare
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        </a>
      </GuideStep>

      <GuideStep
        number={2}
        icon={ShieldCheck}
        title="Adicione o domínio e atualize os nameservers"
        description={
          domainSaved
            ? `Adicione ao Cloudflare a zona raiz correspondente a ${normalizedDomain} e troque os nameservers no registrador onde o domínio foi comprado.`
            : 'Salve o domínio no Vimob para ver as instruções com o endereço correto.'
        }
      >
        <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-sm text-muted-foreground">
          O Cloudflare mostrará dois nameservers. Copie os dois exatamente como aparecem e substitua os atuais no seu registrador. A propagação pode levar algumas horas.
        </div>
      </GuideStep>

      <GuideStep
        number={3}
        icon={Code2}
        title="Crie e publique o Worker"
        description="No Cloudflare, abra Workers & Pages, crie um Worker e substitua todo o código do editor."
      >
        {domainSaved ? (
          <>
            <div className="max-h-[360px] overflow-auto rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light leading-6 text-[var(--app-text-secondary)]">
              <pre><code>{workerCode}</code></pre>
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              onClick={() => copyText(workerCode, 'Código do Worker copiado.')}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar código
            </Button>
          </>
        ) : (
          <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-sm text-muted-foreground">
            O código será liberado depois que o domínio for salvo.
          </div>
        )}
      </GuideStep>

      <GuideStep
        number={4}
        icon={Route}
        title="Adicione a rota do domínio"
        description={
          domainSaved
            ? `Em Settings > Domains & Routes, conecte a rota ${normalizedDomain}/* ao Worker publicado.`
            : 'Depois de salvar o domínio, a rota exata aparecerá aqui.'
        }
      />

      <GuideStep
        number={5}
        icon={ShieldCheck}
        title="Verifique a conexão"
        description="A Vimob procura o token exclusivo servido pelo Worker. Nenhum IP fixo ou segredo do Cloudflare é solicitado."
      >
        {domainSaved ? (
          <DnsVerificationStatus
            domain={normalizedDomain}
            isVerified={site.domain_verified}
            verifiedAt={site.domain_verified_at}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Salve o domínio para liberar a verificação.</p>
        )}
      </GuideStep>
    </div>
  )
}
