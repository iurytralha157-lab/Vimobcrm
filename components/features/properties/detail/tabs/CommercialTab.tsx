"use client";

import { Pencil, Plus } from "lucide-react";

import { Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyOfferType, PropertyWorkspaceOffer } from "@/lib/validation";
import { cn } from "@/lib/utils";

import { formatPropertyMoney } from "../../property-display";
import {
  PROPERTY_SECONDARY_BUTTON_CLASS,
  PropertyChip,
  PropertyFieldGrid,
  filledFields,
} from "../../property-ui";
import { hasField, type WorkspaceProperty } from "../property-workspace-model";

const OFFER_LABELS: Record<PropertyOfferType, string> = {
  sale: "Venda",
  rent: "Locação",
  seasonal: "Temporada",
};
const OFFER_HINTS: Record<PropertyOfferType, string> = {
  sale: "Crie se também for vender",
  rent: "Crie se também for alugar",
  seasonal: "Crie se também for por temporada",
};
const OFFER_PERIOD_LABELS: Record<string, string> = {
  total: "valor total",
  daily: "por dia",
  weekly: "por semana",
  monthly: "por mês",
  yearly: "por ano",
};
const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  reserved: "Reservada",
  completed: "Concluída",
  withdrawn: "Retirada",
  expired: "Expirada",
};

const money = (value: number | null | undefined) => (value ? formatPropertyMoney(value) : null);

function OfferCard({
  type,
  offer,
  canManage,
  onOpen,
}: {
  type: PropertyOfferType;
  offer?: PropertyWorkspaceOffer;
  canManage: boolean;
  onOpen: () => void;
}) {
  const details = offer
    ? [
        offer.price_period ? OFFER_PERIOD_LABELS[offer.price_period] : null,
        offer.available_from ? `Disponível desde ${formatPropertyDate(offer.available_from)}` : null,
        offer.available_until ? `até ${formatPropertyDate(offer.available_until)}` : null,
      ].filter(Boolean).join(" · ")
    : OFFER_HINTS[type];
  return (
    <Panel
      title={OFFER_LABELS[type]}
      aside={(
        <PropertyChip tone={offer?.status === "active" ? "success" : "neutral"}>
          {offer ? OFFER_STATUS_LABELS[offer.status] : "Não criada"}
        </PropertyChip>
      )}
    >
      <p className={cn("text-[22px] font-normal leading-tight tabular-nums", offer?.price == null ? "text-[var(--app-text-tertiary)]" : "text-[var(--app-text-primary)]")}>
        {offer?.price == null ? "Sem valor" : formatPropertyMoney(offer.price, offer.currency)}
      </p>
      <p className="mt-1 min-h-4 text-[12px] font-light text-[var(--app-text-secondary)]">{details}</p>
      {canManage && (
        <Button type="button" variant="ghost" onClick={onOpen} className={cn(PROPERTY_SECONDARY_BUTTON_CLASS, "mt-3")}>
          {offer ? <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          {offer ? "Editar oferta" : "Criar oferta"}
        </Button>
      )}
    </Panel>
  );
}

export function CommercialOffers({
  offers,
  canManage,
  onOpenOffer,
}: {
  offers: PropertyWorkspaceOffer[];
  canManage: boolean;
  onOpenOffer: (type: PropertyOfferType) => void;
}) {
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-3">
      {(["sale", "rent", "seasonal"] as PropertyOfferType[]).map((type) => (
        <OfferCard
          key={type}
          type={type}
          offer={offers.find((item) => item.offer_type === type)}
          canManage={canManage}
          onOpen={() => onOpenOffer(type)}
        />
      ))}
    </div>
  );
}

export function CommercialCosts({ property }: { property: WorkspaceProperty }) {
  const fields = filledFields([
    { label: "Preço de venda", value: money(property.preco) },
    { label: "Valor de locação", value: money(property.valor_locacao) },
    { label: "Condomínio", value: money(property.condominio) },
    { label: "IPTU", value: money(property.iptu) },
    { label: "Seguro incêndio", value: money(property.seguro_incendio) },
    { label: "Taxa de serviço", value: money(property.taxa_de_servico) },
    { label: "ITR", value: money(property.valor_itr) },
    { label: "Seguro fiança", value: money(property.valor_seguro_fianca) },
  ]);
  if (fields.length === 0) return null;
  return <Panel title="Custos do imóvel"><PropertyFieldGrid fields={fields} /></Panel>;
}

/** Internal fields reach the page only for roles the API allows; absent keys stay hidden. */
export function CommercialConditions({ property }: { property: WorkspaceProperty }) {
  const fields = filledFields([
    { label: "Comissão", value: property.commission_percentage != null ? `${property.commission_percentage}%` : null },
    { label: "Comissão de venda", value: money(property.comissao_venda) },
    { label: "Comissão de locação", value: money(property.comissao_locacao) },
    { label: "Tipo de comissão", value: property.tipo_comissao },
    { label: "Início da comissão", value: property.data_inicio_comissao ? formatPropertyDate(property.data_inicio_comissao) : null },
    { label: "Condição comercial", value: property.condicao_comercial },
    { label: "Condição de pagamento", value: property.condicao_pagamento },
    { label: "Venda avaliada", value: money(property.valor_venda_avaliado) },
    { label: "Locação avaliada", value: money(property.valor_locacao_avaliado) },
    { label: "Financiamento", value: property.aceita_financiamento ? "Aceita" : null },
    { label: "Permuta", value: property.aceita_permuta ? "Aceita" : null },
    { label: "Exclusividade", value: property.exclusividade ? "Sim" : null },
    { label: "Divisão de comissão", value: property.commission_split_percent != null ? `${property.commission_split_percent}%` : null },
    { label: "Autorização até", value: property.third_party_authorized_until ? formatPropertyDate(property.third_party_authorized_until) : null },
  ]);
  const comments = hasField(property, "comentarios_internos") ? property.comentarios_internos : null;
  if (fields.length === 0 && !comments) return null;
  return (
    <Panel title="Comissão e condições" aside="Só para a equipe">
      {fields.length > 0 && <PropertyFieldGrid fields={fields} />}
      {comments && (
        <div className="mt-3">
          <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Comentários internos</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-light leading-5 text-[var(--app-text-primary)]">{comments}</p>
        </div>
      )}
    </Panel>
  );
}
