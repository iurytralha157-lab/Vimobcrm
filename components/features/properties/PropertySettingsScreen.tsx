"use client";

import { useState } from "react";
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
import {
  AlertTriangle,
  Building2,
  Eye,
  Loader2,
  PencilLine,
} from "lucide-react";
import { toast } from "sonner";

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
      <div className="max-w-4xl rounded-[8px] bg-card p-5 text-sm text-muted-foreground">
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
      <div className="max-w-4xl space-y-3 rounded-[8px] bg-card p-5 text-sm">
        <p className="text-muted-foreground">
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
  const hasChanges =
    editPolicy !== savedEditPolicy
    || ownerVisibility !== savedOwnerVisibility;

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

  return (
    <div className="max-w-4xl space-y-4">
      {hasConcurrencyConflict && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col gap-3 rounded-[8px] bg-card p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                Estas configurações foram alteradas em outra sessão.
              </p>
              <p className="text-muted-foreground">
                Suas escolhas continuam neste formulário. Recarregue a versão
                atual antes de tentar salvar novamente.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleReloadAfterConflict()}
            disabled={refreshingConflict}
          >
            {refreshingConflict && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Recarregar configurações
          </Button>
        </div>
      )}
      <section className="rounded-[8px] bg-card p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" strokeWidth={1.6} />
          </div>
          <div>
            <h2 className="text-base font-medium">Configurações de imóveis</h2>
            <p className="text-sm text-muted-foreground">Defina regras da carteira para esta organização.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <PencilLine className="h-4 w-4 text-primary" strokeWidth={1.6} />
              <div>
                <h3 className="text-sm font-medium">Edição de imóveis</h3>
                <p className="text-xs text-muted-foreground">Controle quem pode alterar dados dos imóveis.</p>
              </div>
            </div>
            <div className="space-y-2">
              <PolicyOption
                value="responsible_or_admin"
                label="Responsáveis e administradores"
                description="Somente captador/responsável, gestores e admins podem editar."
                selected={editPolicy === "responsible_or_admin"}
                onSelect={() => setEditPolicy("responsible_or_admin")}
              />
              <PolicyOption
                value="everyone"
                label="Todos os usuários"
                description="Todos podem editar apenas os imóveis que já têm permissão para visualizar."
                selected={editPolicy === "everyone"}
                onSelect={() => setEditPolicy("everyone")}
              />
            </div>
          </div>

          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" strokeWidth={1.6} />
              <div>
                <h3 className="text-sm font-medium">Visualização do proprietário</h3>
                <p className="text-xs text-muted-foreground">Proteja telefone e contato do proprietário.</p>
              </div>
            </div>
            <div className="space-y-2">
              <PolicyOption
                value="visible"
                label="Mostrar contato"
                description="Corretores podem ver nome, telefone e e-mail do proprietário."
                selected={ownerVisibility === "visible"}
                onSelect={() => setOwnerVisibility("visible")}
              />
              <PolicyOption
                value="hidden"
                label="Ocultar contato"
                description="Corretores veem o nome, mas telefone e e-mail ficam ocultos."
                selected={ownerVisibility === "hidden"}
                onSelect={() => setOwnerVisibility("hidden")}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={
              saving
              || refreshingConflict
              || hasConcurrencyConflict
              || !hasChanges
            }
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar configurações
          </Button>
        </div>
      </section>
    </div>
  );
}

function PolicyOption({
  value,
  label,
  description,
  selected,
  onSelect,
}: {
  value: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-value={value}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-[6px] p-3 text-left transition ${
        selected
          ? "bg-primary/10 text-foreground"
          : "bg-background/60 text-foreground hover:bg-background"
      }`}
    >
      <span
        className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          selected ? "bg-primary" : "bg-muted-foreground/35"
        }`}
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
