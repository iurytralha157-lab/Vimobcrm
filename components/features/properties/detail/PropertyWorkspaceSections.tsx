'use client'

import type { ReactNode } from 'react'
import {
  Building2,
  Check,
  FileText,
  Globe2,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  PropertyWorkspaceMeta,
  PropertyWorkspaceOwnership,
  PropertyWorkspacePayload,
} from '@/lib/validation'

import { AssetCatalog } from './PropertyWorkspaceOverview'

type WorkspaceProperty = PropertyWorkspacePayload['property']
type WorkspaceSummary = PropertyWorkspacePayload['summary']

type DetailItem = {
  label: string
  value: string | number | null | undefined
  mono?: boolean
}

function hasField(property: WorkspaceProperty, field: keyof WorkspaceProperty) {
  return Object.prototype.hasOwnProperty.call(property, field)
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

function DetailGrid({ items }: { items: DetailItem[] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5">
          <dt className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">
            {item.label}
          </dt>
          <dd className={`mt-1 break-words text-[12px] font-normal text-[var(--app-text-primary)]${item.mono ? ' font-mono' : ''}`}>
            {item.value === '' || item.value == null ? 'Não informado' : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function StructuredData({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null
  const itemCount = Array.isArray(value)
    ? value.length
    : typeof value === 'object'
      ? Object.keys(value).length
      : 1
  if (itemCount === 0) return null

  return (
    <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5">
      <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">{label}</p>
      <p className="mt-1 text-[12px] font-normal text-[var(--app-text-primary)]">
        {itemCount} {itemCount === 1 ? 'registro estruturado' : 'registros estruturados'} disponíveis
      </p>
    </div>
  )
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof Building2
  children: ReactNode
}) {
  return (
    <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function PropertyWorkspaceOverviewSection({
  property,
  summary,
}: {
  property: WorkspaceProperty
  summary: WorkspaceSummary
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <SectionCard title="Descrição e divulgação" icon={FileText}>
        <div className="space-y-3">
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
        </div>
      </SectionCard>

      <div className="space-y-4">
        <SectionCard title="Prontidão da publicação" icon={Globe2}>
          <div className="space-y-2">
            {summary.checklist.length > 0 ? summary.checklist.map((check) => (
              <div key={check.code} className="flex items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] ${check.resolved ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'}`}>
                  {check.resolved ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </span>
                <span className="text-[11px] font-light text-[var(--app-text-secondary)]">{check.label}</span>
              </div>
            )) : (
              <p className="text-[11px] font-light text-muted-foreground">Checklist ainda não disponível.</p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

export function PropertyWorkspaceTechnicalSection({ property }: { property: WorkspaceProperty }) {
  const identityItems: DetailItem[] = [
    { label: 'Tipo do imóvel', value: property.tipo_de_imovel || property.tipo },
    ...(hasField(property, 'tipo_de_negocio') ? [{ label: 'Tipo de negócio', value: property.tipo_de_negocio }] : []),
    ...(hasField(property, 'finalidade') ? [{ label: 'Finalidade', value: property.finalidade }] : []),
    { label: 'Quartos', value: property.quartos },
    ...(hasField(property, 'suites') ? [{ label: 'Suítes', value: property.suites }] : []),
    { label: 'Banheiros', value: property.banheiros },
    { label: 'Vagas', value: property.vagas },
    { label: 'Área útil', value: formatArea(property.area_util) },
    { label: 'Área total', value: formatArea(property.area_total) },
    ...(hasField(property, 'andar') ? [{ label: 'Andar', value: property.andar }] : []),
    ...(hasField(property, 'ano_construcao') ? [{ label: 'Ano de construção', value: property.ano_construcao }] : []),
    ...(hasField(property, 'ano_reforma') ? [{ label: 'Ano da reforma', value: property.ano_reforma }] : []),
    ...(hasField(property, 'mobilia') ? [{ label: 'Mobília', value: property.mobilia }] : []),
    ...(hasField(property, 'mobiliado') ? [{ label: 'Mobiliado', value: formatBoolean(property.mobiliado) }] : []),
    ...(hasField(property, 'regra_pet') ? [{ label: 'Aceita pet', value: formatBoolean(property.regra_pet) }] : []),
    ...(hasField(property, 'padrao') ? [{ label: 'Padrão', value: property.padrao }] : []),
    ...(hasField(property, 'detalhes_extras') ? [{ label: 'Detalhes extras', value: property.detalhes_extras?.join(', ') }] : []),
    ...(hasField(property, 'marcadores') ? [{ label: 'Marcadores', value: property.marcadores?.join(', ') }] : []),
  ]

  const locationItems: DetailItem[] = [
    { label: 'Logradouro', value: property.endereco },
    { label: 'Número', value: property.numero },
    ...(hasField(property, 'complemento') ? [{ label: 'Complemento', value: property.complemento }] : []),
    { label: 'Bairro', value: property.bairro },
    { label: 'Cidade', value: property.cidade },
    { label: 'UF', value: property.uf },
    ...(hasField(property, 'pais') ? [{ label: 'País', value: property.pais }] : []),
    { label: 'CEP', value: property.cep },
    ...(hasField(property, 'latitude') ? [{ label: 'Latitude', value: property.latitude }] : []),
    ...(hasField(property, 'longitude') ? [{ label: 'Longitude', value: property.longitude }] : []),
    ...(hasField(property, 'posicao_localizacao') ? [{ label: 'Posição da localização', value: property.posicao_localizacao }] : []),
    ...(hasField(property, 'zoneamento') ? [{ label: 'Zoneamento', value: property.zoneamento }] : []),
    ...(hasField(property, 'proximidades') ? [{ label: 'Proximidades', value: property.proximidades?.join(', ') }] : []),
    { label: 'Visibilidade do endereço', value: property.address_visibility || property.public_address_visibility },
  ]

  const conditionItems: DetailItem[] = [
    { label: 'Destaque', value: formatBoolean(property.is_featured ?? property.destaque) },
    ...(hasField(property, 'super_destaque') ? [{ label: 'Super destaque', value: formatBoolean(property.super_destaque) }] : []),
    ...(hasField(property, 'placa_no_local') ? [{ label: 'Placa no local', value: formatBoolean(property.placa_no_local) }] : []),
    ...(hasField(property, 'aceita_permuta') ? [{ label: 'Aceita permuta', value: formatBoolean(property.aceita_permuta) }] : []),
    ...(hasField(property, 'aceita_financiamento') ? [{ label: 'Aceita financiamento', value: formatBoolean(property.aceita_financiamento) }] : []),
    ...(hasField(property, 'exclusividade') ? [{ label: 'Exclusividade', value: formatBoolean(property.exclusividade) }] : []),
    ...(hasField(property, 'usou_fgts') ? [{ label: 'Usou FGTS', value: formatBoolean(property.usou_fgts) }] : []),
    { label: 'Publicado no site', value: formatBoolean(property.published_on_site ?? property.anunciar) },
  ]

  const traceItems: DetailItem[] = [
    { label: 'ID do imóvel', value: property.id, mono: true },
    { label: 'ID da organização', value: property.organization_id, mono: true },
    ...(hasField(property, 'property_type_id') ? [{ label: 'ID do tipo', value: property.property_type_id, mono: true }] : []),
    ...(hasField(property, 'condominium_id') ? [{ label: 'ID do condomínio', value: property.condominium_id, mono: true }] : []),
    ...(hasField(property, 'city_id') ? [{ label: 'ID da cidade', value: property.city_id, mono: true }] : []),
    ...(hasField(property, 'neighborhood_id') ? [{ label: 'ID do bairro', value: property.neighborhood_id, mono: true }] : []),
    ...(
      hasField(property, 'responsible_user_id') || hasField(property, 'cadastrado_por')
        ? [{ label: 'Responsável interno', value: property.responsible_user_id || property.cadastrado_por, mono: true }]
        : []
    ),
    ...(hasField(property, 'corretor_id') ? [{ label: 'Corretor', value: property.corretor_id, mono: true }] : []),
    ...(hasField(property, 'created_at') ? [{ label: 'Criado em', value: formatDate(property.created_at, true) }] : []),
    ...(hasField(property, 'updated_at') ? [{ label: 'Atualizado em', value: formatDate(property.updated_at, true) }] : []),
  ]

  const managerReferenceItems: DetailItem[] = [
    ...(hasField(property, 'numero_matricula') ? [{ label: 'Matrícula', value: property.numero_matricula }] : []),
    ...(hasField(property, 'codigo_iptu') ? [{ label: 'Código do IPTU', value: property.codigo_iptu }] : []),
    ...(hasField(property, 'codigo_eletricidade') ? [{ label: 'Código de eletricidade', value: property.codigo_eletricidade }] : []),
    ...(hasField(property, 'codigo_agua') ? [{ label: 'Código de água', value: property.codigo_agua }] : []),
    ...(hasField(property, 'ocupacao') ? [{ label: 'Ocupação', value: property.ocupacao }] : []),
    ...(hasField(property, 'situacao_imovel') ? [{ label: 'Situação do imóvel', value: property.situacao_imovel }] : []),
    ...(hasField(property, 'autorizado_comercializacao') ? [{ label: 'Comercialização autorizada', value: formatBoolean(property.autorizado_comercializacao) }] : []),
    ...(hasField(property, 'referencia_alternativa') ? [{ label: 'Referência alternativa', value: property.referencia_alternativa }] : []),
    ...(hasField(property, 'external_provider') ? [{ label: 'Provedor externo', value: property.external_provider }] : []),
    ...(hasField(property, 'external_id') ? [{ label: 'ID externo', value: property.external_id, mono: true }] : []),
    ...(hasField(property, 'imoview_codigo') ? [{ label: 'Código Imoview', value: property.imoview_codigo, mono: true }] : []),
    ...(hasField(property, 'vista_codigo') ? [{ label: 'Código Vista', value: property.vista_codigo, mono: true }] : []),
    ...(hasField(property, 'created_by') ? [{ label: 'Criado por', value: property.created_by, mono: true }] : []),
    ...(hasField(property, 'aprovacao_ambiental') ? [{ label: 'Aprovação ambiental', value: property.aprovacao_ambiental }] : []),
    ...(hasField(property, 'projeto_aprovado') ? [{ label: 'Projeto aprovado', value: formatBoolean(property.projeto_aprovado) }] : []),
    ...(hasField(property, 'status_descritivo') ? [{ label: 'Status descritivo', value: property.status_descritivo }] : []),
  ]

  return (
    <div className="space-y-4">
      <SectionCard title="Características do imóvel" icon={Building2}><DetailGrid items={identityItems} /></SectionCard>
      <SectionCard title="Endereço e visibilidade" icon={MapPin}><DetailGrid items={locationItems} /></SectionCard>
      <SectionCard title="Divulgação e condições" icon={Globe2}><DetailGrid items={conditionItems} /></SectionCard>
      <SectionCard title="Rastreabilidade" icon={ShieldCheck}><DetailGrid items={traceItems} /></SectionCard>
      {managerReferenceItems.length > 0 && (
        <SectionCard title="Referências internas autorizadas" icon={FileText}>
          <DetailGrid items={managerReferenceItems} />
          {hasField(property, 'observacoes_documentacao') && (
            <div className="mt-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">Observações da documentação</p>
              <p className="mt-2 whitespace-pre-wrap text-[12px] font-light text-[var(--app-text-secondary)]">{property.observacoes_documentacao || 'Não informado'}</p>
            </div>
          )}
          <StructuredData label="Metadados do cadastro" value={property.metadata} />
        </SectionCard>
      )}
    </div>
  )
}

export function PropertyWorkspaceCommercialRegistration({
  property,
}: {
  property: WorkspaceProperty
}) {
  const managerItems: DetailItem[] = [
    ...(hasField(property, 'commission_percentage') ? [{ label: 'Comissão percentual', value: property.commission_percentage == null ? null : `${property.commission_percentage}%` }] : []),
    ...(hasField(property, 'comissao_venda') ? [{ label: 'Comissão de venda', value: formatCurrency(property.comissao_venda) }] : []),
    ...(hasField(property, 'comissao_locacao') ? [{ label: 'Comissão de locação', value: formatCurrency(property.comissao_locacao) }] : []),
    ...(hasField(property, 'tipo_comissao') ? [{ label: 'Tipo de comissão', value: property.tipo_comissao }] : []),
    ...(hasField(property, 'data_inicio_comissao') ? [{ label: 'Início da comissão', value: formatDate(property.data_inicio_comissao) }] : []),
    ...(hasField(property, 'condicao_comercial') ? [{ label: 'Condição comercial', value: property.condicao_comercial }] : []),
    ...(hasField(property, 'condicao_pagamento') ? [{ label: 'Condição de pagamento', value: property.condicao_pagamento }] : []),
    ...(hasField(property, 'valor_venda_avaliado') ? [{ label: 'Venda avaliada', value: formatCurrency(property.valor_venda_avaliado) }] : []),
    ...(hasField(property, 'valor_locacao_avaliado') ? [{ label: 'Locação avaliada', value: formatCurrency(property.valor_locacao_avaliado) }] : []),
  ]

  return (
    <div className="space-y-4">
      <SectionCard title="Valores do cadastro" icon={WalletCards}>
        <DetailGrid items={[
          { label: 'Preço de venda', value: formatCurrency(property.preco) },
          { label: 'Valor de locação', value: formatCurrency(property.valor_locacao) },
          { label: 'IPTU', value: formatCurrency(property.iptu) },
          ...(hasField(property, 'condominio') ? [{ label: 'Condomínio', value: formatCurrency(property.condominio) }] : []),
          ...(hasField(property, 'seguro_incendio') ? [{ label: 'Seguro incêndio', value: formatCurrency(property.seguro_incendio) }] : []),
          ...(hasField(property, 'taxa_de_servico') ? [{ label: 'Taxa de serviço', value: formatCurrency(property.taxa_de_servico) }] : []),
          ...(hasField(property, 'valor_itr') ? [{ label: 'ITR', value: formatCurrency(property.valor_itr) }] : []),
          ...(hasField(property, 'valor_seguro_fianca') ? [{ label: 'Seguro fiança', value: formatCurrency(property.valor_seguro_fianca) }] : []),
        ]} />
      </SectionCard>
      {managerItems.length > 0 && (
        <SectionCard title="Condições internas autorizadas" icon={ShieldCheck}>
          <DetailGrid items={managerItems} />
          {hasField(property, 'comentarios_internos') && (
            <div className="mt-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">Comentários internos</p>
              <p className="mt-2 whitespace-pre-wrap text-[12px] font-light text-[var(--app-text-secondary)]">{property.comentarios_internos || 'Não informado'}</p>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}

function ownerFieldItems(ownership: PropertyWorkspaceOwnership): DetailItem[] {
  const owner = ownership.owner
  return [
    { label: 'ID do proprietário', value: owner.id, mono: true },
    ...('phone_residential' in owner ? [{ label: 'Telefone residencial', value: owner.phone_residential }] : []),
    ...('phone_commercial' in owner ? [{ label: 'Telefone comercial', value: owner.phone_commercial }] : []),
    ...('cellphone' in owner ? [{ label: 'Celular', value: owner.cellphone }] : []),
    ...('email' in owner ? [{ label: 'E-mail', value: owner.email }] : []),
    ...('media_source' in owner ? [{ label: 'Origem', value: owner.media_source }] : []),
    ...('notify_email' in owner ? [{ label: 'Notificar por e-mail', value: formatBoolean(owner.notify_email) }] : []),
    { label: 'Vigência inicial', value: formatDate(ownership.valid_from) },
    { label: 'Vigência final', value: ownership.valid_to ? formatDate(ownership.valid_to) : 'Sem encerramento' },
    { label: 'Cadastro do proprietário', value: formatDate(owner.created_at, true) },
    { label: 'Atualização do proprietário', value: formatDate(owner.updated_at, true) },
    { label: 'Criação do vínculo', value: formatDate(ownership.created_at, true) },
    { label: 'Atualização do vínculo', value: formatDate(ownership.updated_at, true) },
  ]
}

export function PropertyWorkspaceResponsiblesSection({
  property,
  ownerships,
  meta,
  normalizedResourcesAvailable,
  today,
  onCreate,
  onEdit,
  onEnd,
}: {
  property: WorkspaceProperty
  ownerships: PropertyWorkspaceOwnership[]
  meta: PropertyWorkspaceMeta
  normalizedResourcesAvailable: boolean
  today: string
  onCreate: () => void
  onEdit: (ownership: PropertyWorkspaceOwnership) => void
  onEnd: (ownership: PropertyWorkspaceOwnership) => void
}) {
  const ownerItems: DetailItem[] = [
    { label: 'Nome', value: property.owner_name },
    ...(hasField(property, 'owner_id') ? [{ label: 'ID do proprietário', value: property.owner_id, mono: true }] : []),
    ...(hasField(property, 'owner_phone_residential') ? [{ label: 'Telefone residencial', value: property.owner_phone_residential }] : []),
    ...(hasField(property, 'owner_phone_commercial') ? [{ label: 'Telefone comercial', value: property.owner_phone_commercial }] : []),
    ...(hasField(property, 'owner_cellphone') ? [{ label: 'Celular', value: property.owner_cellphone }] : []),
    ...(hasField(property, 'owner_email') ? [{ label: 'E-mail', value: property.owner_email }] : []),
    ...(hasField(property, 'owner_media_source') ? [{ label: 'Origem', value: property.owner_media_source }] : []),
    ...(hasField(property, 'owner_notify_email') ? [{ label: 'Notificar por e-mail', value: formatBoolean(property.owner_notify_email) }] : []),
  ]
  const hasOwner = ownerItems.some((item) => item.value != null && item.value !== '')

  return (
    <div className="space-y-4">
      <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-[14px] font-normal">Proprietários e participação</CardTitle>
              <p className="mt-1 text-[11px] font-light text-muted-foreground">
                Dados dos proprietários e suas participações no imóvel.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!meta.can_view_owner_contacts && (
                <Badge variant="secondary" className="rounded-[4px] border-0 text-[10px] font-light">Contatos protegidos</Badge>
              )}
              {meta.can_manage && normalizedResourcesAvailable && (
                <Button size="sm" variant="outline" onClick={onCreate}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Vincular proprietário
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {ownerships.length > 0 ? ownerships.map((ownership) => {
            const active = ownership.valid_from <= today && (!ownership.valid_to || today < ownership.valid_to)
            const status = active ? 'Ativo' : ownership.valid_from > today ? 'Agendado' : 'Histórico'
            return (
              <article key={ownership.id} className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-primary">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-[12px] font-normal">{ownership.owner.name}</h3>
                        {ownership.is_primary && <Badge variant="secondary" className="rounded-[4px] border-0 text-[9px] font-light">Principal</Badge>}
                        <Badge variant={active ? 'default' : 'outline'} className="rounded-[4px] border-0 text-[9px] font-light">{status}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] font-light text-muted-foreground">Participação de {ownership.ownership_percentage}%</p>
                    </div>
                  </div>
                  {meta.can_manage && (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(ownership)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Editar</Button>
                      {!ownership.valid_to && <Button size="sm" variant="ghost" onClick={() => onEnd(ownership)}>Encerrar vínculo</Button>}
                    </div>
                  )}
                </div>
                <div className="mt-3"><DetailGrid items={ownerFieldItems(ownership)} /></div>
                <p className="mt-2 break-all font-mono text-[9px] font-light text-muted-foreground">Vínculo: {ownership.id}</p>
                {('notes' in ownership.owner || 'notes' in ownership) && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {'notes' in ownership.owner && <div className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px] font-light"><span className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Nota do proprietário</span><span className="mt-1 block whitespace-pre-wrap">{ownership.owner.notes || 'Não informado'}</span></div>}
                    {'notes' in ownership && <div className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px] font-light"><span className="block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Nota do vínculo</span><span className="mt-1 block whitespace-pre-wrap">{ownership.notes || 'Não informado'}</span></div>}
                  </div>
                )}
              </article>
            )
          }) : hasOwner ? (
            <DetailGrid items={ownerItems} />
          ) : (
            <p className="rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-muted-foreground">Nenhum proprietário vinculado.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function PropertyWorkspaceMediaSection({
  property,
  assets,
}: {
  property: WorkspaceProperty
  assets: PropertyWorkspacePayload['assets']
}) {
  const mediaLinkItems: DetailItem[] = [
    ...(hasField(property, 'video_imovel') ? [{ label: 'Vídeo do imóvel', value: property.video_imovel }] : []),
    ...(hasField(property, 'tour_virtual') ? [{ label: 'Tour virtual', value: property.tour_virtual }] : []),
  ]

  return (
    <div className="space-y-4">
      {mediaLinkItems.length > 0 && (
        <SectionCard title="Links de mídia do cadastro" icon={Globe2}>
          <DetailGrid items={mediaLinkItems} />
        </SectionCard>
      )}
      <SectionCard title="Mídias e documentos" icon={FileText}>
        <AssetCatalog assets={assets} />
      </SectionCard>
      {(hasField(property, 'documents') || hasField(property, 'arquivos')) && (
        <SectionCard title="Documentos do imóvel" icon={ShieldCheck}>
          <div className="space-y-2">
            <StructuredData label="Documentos" value={property.documents ?? property.arquivos} />
          </div>
        </SectionCard>
      )}
    </div>
  )
}
