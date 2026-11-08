"use client";

import { useState } from "react";
import { Panel } from "@/components/features/marketing/marketing-ui";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { PropertySectionTabs } from "@/components/features/properties/PropertySectionTabs";
import { useAuth } from "@/contexts/AuthContext";
import { settingsAPI } from "@/lib/api/settings";
import { getErrorMessageOrFallback as getErrorMessage } from "@/lib/api/vimob-error";
import {
  isPropertySettingsConflict,
  PROPERTY_SETTINGS_CONFLICT_MESSAGE,
} from "@/lib/property-settings-concurrency";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PROPERTY_PRIMARY_BUTTON_CLASS, PROPERTY_SECONDARY_BUTTON_CLASS } from "./property-ui";
import { SettingChoice } from "./settings/SettingChoice";
import { PortfolioSettingsPanel } from "./settings/PortfolioSettingsPanel";
import { PROPERTY_SETTINGS_GROUPS, type PropertySettingsGroupId } from "./settings/portfolio-settings-schema";
import { usePortfolioSettingsForm } from "./settings/use-portfolio-settings-form";

type PropertyEditPolicy = "everyone" | "responsible_or_admin";
type OwnerVisibility = "visible" | "hidden";
type CurrentOrganization = NonNullable<ReturnType<typeof useAuth>["organization"]>;

export default function PropertySettingsScreen() {
  return (
    <AppLayout title="Configurações de imóveis">
      <div className="animate-in space-y-3">
        <PropertySectionTabs activeSection="settings" />
        <PropertySettingsContent />
      </div>
    </AppLayout>
  );
}

function PropertySettingsContent() {
  const {
    activeOrganization,
    organization,
    refreshOrganizations,
    refreshProfile,
  } = useAuth();

  if (activeOrganization.status === "resolving") {
    return (
      <div className="rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light text-[var(--app-text-secondary)]">
        Carregando configurações de imóveis...
      </div>
    );
  }

  if (
    activeOrganization.status === "missing"
    || !organization
    || activeOrganization.organizationId !== organization.id
  ) {
    const loadFailed =
      activeOrganization.status === "missing"
      && activeOrganization.reason === "organization-load-failed";
    return (
      <div className="space-y-3 rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light">
        <p className="text-[var(--app-text-secondary)]">
          {loadFailed
            ? "Não foi possível carregar as configurações desta organização."
            : "Nenhuma organização ativa está disponível para estas configurações."}
        </p>
        <Button type="button" variant="outline" onClick={() => void refreshOrganizations()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <PropertySettingsForm
      key={`${organization.id}-${organization.updated_at}`}
      organization={organization}
      refreshProfile={refreshProfile}
    />
  );
}

function PropertySettingsForm({
  organization,
  refreshProfile,
}: {
  organization: CurrentOrganization;
  refreshProfile: () => Promise<boolean>;
}) {
  const initialEditPolicy: PropertyEditPolicy =
    organization.property_edit_policy === "everyone"
      ? "everyone"
      : "responsible_or_admin";
  const initialOwnerVisibility: OwnerVisibility =
    organization.property_owner_contact_visibility === "hidden"
      ? "hidden"
      : "visible";
  const [editPolicy, setEditPolicy] = useState<PropertyEditPolicy>(
    initialEditPolicy,
  );
  const [ownerVisibility, setOwnerVisibility] = useState<OwnerVisibility>(
    initialOwnerVisibility,
  );
  const [savedEditPolicy, setSavedEditPolicy] =
    useState<PropertyEditPolicy>(initialEditPolicy);
  const [savedOwnerVisibility, setSavedOwnerVisibility] =
    useState<OwnerVisibility>(initialOwnerVisibility);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(
    organization.updated_at,
  );
  const [hasConcurrencyConflict, setHasConcurrencyConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingConflict, setRefreshingConflict] = useState(false);
  const [activeGroup, setActiveGroup] = useState<PropertySettingsGroupId>("general");
  const portfolio = usePortfolioSettingsForm();
  const hasChanges =
    editPolicy !== savedEditPolicy
    || ownerVisibility !== savedOwnerVisibility;

  const handleSaveAll = async () => {
    const portfolioSaved = await portfolio.save();
    if (hasChanges) {
      await handleSave();
    } else if (portfolioSaved && portfolio.hasChanges) {
      toast.success("Preferências da carteira salvas.");
    }
  };

  const handleSave = async () => {
    if (!hasChanges || hasConcurrencyConflict) return;

    setSaving(true);
    try {
      const result = await settingsAPI.updatePropertySettings(
        {
          expected_updated_at: expectedUpdatedAt,
          ...(editPolicy !== savedEditPolicy
            ? { property_edit_policy: editPolicy }
            : {}),
          ...(ownerVisibility !== savedOwnerVisibility
            ? { property_owner_contact_visibility: ownerVisibility }
            : {}),
        },
        organization.id,
      );
      setExpectedUpdatedAt(result.updated_at);
      setSavedEditPolicy(editPolicy);
      setSavedOwnerVisibility(ownerVisibility);
      const refreshed = await refreshProfile();
      if (refreshed) {
        toast.success("Configurações de imóveis salvas.");
      } else {
        toast.warning(
          "Configurações salvas, mas não foi possível atualizar a tela. Tente recarregar.",
        );
      }
    } catch (error) {
      if (isPropertySettingsConflict(error)) {
        setHasConcurrencyConflict(true);
        toast.error(PROPERTY_SETTINGS_CONFLICT_MESSAGE);
        return;
      }
      toast.error(getErrorMessage(error, "Não foi possível salvar as configurações de imóveis."));
    } finally {
      setSaving(false);
    }
  };

  const handleReloadAfterConflict = async () => {
    if (
      !window.confirm(
        "Recarregar substituirá suas escolhas locais pelas configurações mais recentes. Deseja continuar?",
      )
    ) {
      return;
    }

    setRefreshingConflict(true);
    try {
      const refreshed = await refreshProfile();
      if (!refreshed) {
        toast.error(
          "Não foi possível recarregar as configurações. Suas escolhas continuam na tela.",
        );
        return;
      }
      setHasConcurrencyConflict(false);
      toast.success("Configurações mais recentes carregadas. Revise antes de salvar.");
    } finally {
      setRefreshingConflict(false);
    }
  };

  const group = PROPERTY_SETTINGS_GROUPS.find((item) => item.id === activeGroup) ?? PROPERTY_SETTINGS_GROUPS[0];

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[216px_minmax(0,1fr)]">
      <nav aria-label="Grupos de configurações" className="min-w-0 self-start rounded-[12px] bg-[var(--app-surface-solid)] p-2">
        <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col [&::-webkit-scrollbar]:hidden">
          {PROPERTY_SETTINGS_GROUPS.map((item) => (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                aria-current={item.id === activeGroup ? "page" : undefined}
                onClick={() => setActiveGroup(item.id)}
                className={cn(
                  "h-9 w-full rounded-[8px] px-3 text-left text-[13px] font-light transition-colors",
                  item.id === activeGroup
                    ? "bg-primary/10 text-primary"
                    : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-3">
        {hasConcurrencyConflict && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex flex-col gap-3 rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p>Estas configurações foram alteradas em outra sessão.</p>
                <p className="text-[var(--app-text-secondary)]">
                  Suas escolhas continuam neste formulário. Recarregue a versão
                  atual antes de tentar salvar novamente.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              className={PROPERTY_SECONDARY_BUTTON_CLASS}
              onClick={() => void handleReloadAfterConflict()}
              disabled={refreshingConflict}
            >
              {refreshingConflict && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Recarregar configurações
            </Button>
          </div>
        )}
        {portfolio.conflict && (
          <div role="alert" className="flex flex-col gap-3 rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p>As preferências da carteira foram alteradas por outra pessoa. Recarregar substitui o que você mudou nesta tela.</p>
            </div>
            <Button type="button" variant="ghost" className={PROPERTY_SECONDARY_BUTTON_CLASS} onClick={() => void portfolio.reload()}>
              Recarregar preferências
            </Button>
          </div>
        )}

        {activeGroup === "general" && (
          <Panel title="Regras da carteira">
            <SettingChoice
              label="Quem pode editar"
              description="Controle quem pode alterar dados dos imóveis."
              options={[
                {
                  value: "responsible_or_admin",
                  label: "Responsáveis e administradores",
                  description: "Somente captador/responsável, gestores e admins podem editar.",
                },
                {
                  value: "everyone",
                  label: "Todos os usuários",
                  description: "Todos podem editar apenas os imóveis que já têm permissão para visualizar.",
                },
              ]}
              selected={editPolicy}
              onSelect={(value) => setEditPolicy(value as PropertyEditPolicy)}
            />
          </Panel>
        )}
        {activeGroup === "owners" && (
          <Panel title="Contato do proprietário">
            <SettingChoice
              label="Quem vê o contato"
              description="Proteja telefone e contato do proprietário."
              options={[
                {
                  value: "visible",
                  label: "Mostrar contato",
                  description: "Corretores podem ver nome, telefone e e-mail do proprietário.",
                },
                {
                  value: "hidden",
                  label: "Ocultar contato",
                  description: "Corretores veem o nome, mas telefone e e-mail ficam ocultos.",
                },
              ]}
              selected={ownerVisibility}
              onSelect={(value) => setOwnerVisibility(value as OwnerVisibility)}
            />
          </Panel>
        )}

        {portfolio.loading ? (
          <div className="rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light text-[var(--app-text-secondary)]">
            Carregando preferências da carteira...
          </div>
        ) : portfolio.loadFailed || !portfolio.values ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-[12px] bg-[var(--app-surface-solid)] p-4 text-[13px] font-light">
            Não foi possível carregar as preferências da carteira.
            <Button type="button" variant="ghost" className={PROPERTY_SECONDARY_BUTTON_CLASS} onClick={portfolio.retry}>Tentar novamente</Button>
          </div>
        ) : (
          <PortfolioSettingsPanel
            group={group}
            values={portfolio.values}
            disabled={portfolio.saving || portfolio.conflict}
            onChange={portfolio.setValue}
          />
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => void handleSaveAll()}
            className={PROPERTY_PRIMARY_BUTTON_CLASS}
            disabled={
              saving
              || portfolio.saving
              || refreshingConflict
              || hasConcurrencyConflict
              || portfolio.conflict
              || (!hasChanges && !portfolio.hasChanges)
            }
          >
            {saving || portfolio.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            Salvar configurações
          </Button>
        </div>
      </div>
    </div>
  );
}
