"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { RequiredMark } from "../PropertyFormFields";
import type { PropertyFormPortfolioType, PropertyFormThirdPartyKind } from "../property-form-portfolio";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

const PORTFOLIO_OPTIONS: Array<{ value: PropertyFormPortfolioType; label: string; hint: string }> = [
  { value: "ready", label: "Pronto", hint: "Carteira própria, para venda ou aluguel" },
  { value: "launch", label: "Lançamento", hint: "Unidade de um empreendimento" },
  { value: "third_party", label: "De terceiro", hint: "De parceiro ou proprietário particular" },
];

const KIND_OPTIONS: Array<{ value: Exclude<PropertyFormThirdPartyKind, "">; label: string; hint: string }> = [
  { value: "partner", label: "Parceiro", hint: "Imobiliária ou corretor parceiro" },
  { value: "private_owner", label: "Proprietário particular", hint: "Usa os dados da etapa Proprietário" },
];

function ChoiceCard({ selected, disabled, label, hint, onSelect }: { selected: boolean; disabled?: boolean; label: string; hint: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "min-w-0 rounded-[8px] border px-3 py-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-[var(--app-border)] bg-transparent hover:bg-[var(--app-surface-hover)]",
        disabled && !selected && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className="block text-[13px] font-light text-[var(--app-text-primary)]">{label}</span>
      <span className="block text-[12px] font-light leading-4 text-[var(--app-text-secondary)]">{hint}</span>
    </button>
  );
}

export function PortfolioFields() {
  const { formData, set, handlePortfolioTypeChange, portfolioLocks, canEditOwnerDetails, canManagePropertyCatalogs } = usePropertyFormSections();
  const isThirdParty = formData.portfolio_type === "third_party";
  const isPartner = formData.third_party_kind === "partner";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span id="property-portfolio-type-label" className="text-sm font-medium leading-none">
          Tipo de carteira <RequiredMark />
        </span>
        <div role="radiogroup" aria-labelledby="property-portfolio-type-label" className="grid grid-cols-1 gap-2 @[480px]:grid-cols-3">
          {PORTFOLIO_OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              label={option.label}
              hint={option.hint}
              selected={formData.portfolio_type === option.value}
              disabled={Boolean(portfolioLocks.typeLockReason) && formData.portfolio_type !== option.value}
              onSelect={() => handlePortfolioTypeChange(option.value)}
            />
          ))}
        </div>
        {portfolioLocks.typeLockReason && (
          <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{portfolioLocks.typeLockReason}</p>
        )}
      </div>

      {isThirdParty && (
        <div className="space-y-4">
          <div className="space-y-2">
            <span id="property-third-party-kind-label" className="text-sm font-medium leading-none">
              De quem é o imóvel <RequiredMark />
            </span>
            <div
              id="property-third-party-kind"
              tabIndex={-1}
              role="radiogroup"
              aria-labelledby="property-third-party-kind-label"
              className="grid grid-cols-1 gap-2 @[480px]:grid-cols-2"
            >
              {KIND_OPTIONS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  label={option.label}
                  hint={option.hint}
                  selected={formData.third_party_kind === option.value}
                  disabled={Boolean(portfolioLocks.kindLockReason) && formData.third_party_kind !== option.value}
                  onSelect={() => set("third_party_kind", option.value)}
                />
              ))}
            </div>
            {portfolioLocks.kindLockReason && (
              <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{portfolioLocks.kindLockReason}</p>
            )}
          </div>

          {isPartner && (
            <div className="grid grid-cols-1 gap-4 @[480px]:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="property-partner-name">
                  Nome do parceiro <RequiredMark />
                </Label>
                <Input
                  id="property-partner-name"
                  maxLength={160}
                  value={formData.partner_name}
                  onChange={(event) => set("partner_name", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-partner-contact">Contato do parceiro</Label>
                <Input
                  id="property-partner-contact"
                  maxLength={200}
                  disabled={!canEditOwnerDetails}
                  placeholder={canEditOwnerDetails ? "Telefone ou e-mail" : "Contato protegido"}
                  value={formData.partner_contact}
                  onChange={(event) => set("partner_contact", event.target.value)}
                />
              </div>
            </div>
          )}

          {canManagePropertyCatalogs && (
            <div className="grid grid-cols-1 gap-4 @[480px]:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="property-commission-split">Divisão de comissão (%)</Label>
                <Input
                  id="property-commission-split"
                  inputMode="decimal"
                  value={formData.commission_split_percent}
                  onChange={(event) => set("commission_split_percent", event.target.value)}
                  placeholder="Ex.: 50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-third-party-authorized-until">Autorização válida até</Label>
                <Input
                  id="property-third-party-authorized-until"
                  type="date"
                  value={formData.third_party_authorized_until}
                  onChange={(event) => set("third_party_authorized_until", event.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
