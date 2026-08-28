"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { settingsAPI, type UpdateOrganizationInput } from "@/lib/api/settings";
import { Building2, Eye, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";

type PropertyEditPolicy = "everyone" | "responsible_or_admin";
type OwnerVisibility = "visible" | "hidden";
type CurrentOrganization = NonNullable<ReturnType<typeof useAuth>["organization"]>;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return "Não foi possível salvar as configurações de imóveis.";
};

function organizationPayload(
  organization: CurrentOrganization,
  editPolicy: PropertyEditPolicy,
  ownerVisibility: OwnerVisibility,
): UpdateOrganizationInput {
  // The current backend contract treats this endpoint as a full organization update:
  // omitting nullable fields clears them, so preserve the loaded organization snapshot.
  return {
    name: organization.name,
    cnpj: organization.cnpj || null,
    creci: organization.creci || null,
    inscricao_estadual: organization.inscricao_estadual || null,
    razao_social: organization.razao_social || null,
    nome_fantasia: organization.nome_fantasia || null,
    cep: organization.cep || null,
    endereco: organization.endereco || null,
    numero: organization.numero || null,
    complemento: organization.complemento || null,
    bairro: organization.bairro || null,
    cidade: organization.cidade || null,
    uf: organization.uf || null,
    telefone: organization.telefone || null,
    whatsapp: organization.whatsapp || null,
    email: organization.email || null,
    website: organization.website || null,
    default_commission_percentage: organization.default_commission_percentage ?? null,
    property_edit_policy: editPolicy,
    property_owner_contact_visibility: ownerVisibility,
  };
}

export function PropertySettingsTab() {
  const { organization, refreshProfile } = useAuth();

  if (!organization) {
    return (
      <div className="max-w-4xl rounded-[8px] bg-card p-5 text-sm text-muted-foreground">
        Carregando configurações de imóveis...
      </div>
    );
  }

  return (
    <PropertySettingsForm
      key={`${organization.id}-${organization.property_edit_policy}-${organization.property_owner_contact_visibility}`}
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
  refreshProfile: () => Promise<void>;
}) {
  const [editPolicy, setEditPolicy] = useState<PropertyEditPolicy>(
    organization.property_edit_policy === "everyone" ? "everyone" : "responsible_or_admin",
  );
  const [ownerVisibility, setOwnerVisibility] = useState<OwnerVisibility>(
    organization.property_owner_contact_visibility === "hidden" ? "hidden" : "visible",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsAPI.updateOrganization(organizationPayload(organization, editPolicy, ownerVisibility), organization.id);
      await refreshProfile();
      toast.success("Configurações de imóveis salvas.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-4">
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
                label="Responsaveis e administradores"
                description="Somente captador/responsavel, gestores e admins podem editar."
                selected={editPolicy === "responsible_or_admin"}
                onSelect={() => setEditPolicy("responsible_or_admin")}
              />
              <PolicyOption
                value="everyone"
                label="Todos os usuários"
                description="Qualquer usuário ativo da organização pode editar imóveis."
                selected={editPolicy === "everyone"}
                onSelect={() => setEditPolicy("everyone")}
              />
            </div>
          </div>

          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" strokeWidth={1.6} />
              <div>
                <h3 className="text-sm font-medium">Visualizacao do proprietario</h3>
                <p className="text-xs text-muted-foreground">Proteja telefone e contato do proprietario.</p>
              </div>
            </div>
            <div className="space-y-2">
              <PolicyOption
                value="visible"
                label="Mostrar contato"
                description="Corretores podem ver nome, telefone e e-mail do proprietario."
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
          <Button onClick={handleSave} disabled={saving || !organization?.id}>
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
