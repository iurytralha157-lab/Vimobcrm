"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/contexts/AuthContext";
import { settingsAPI, type UpdateOrganizationInput } from "@/lib/api/settings";
import { Building2, Eye, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";

type PropertyEditPolicy = "everyone" | "responsible_or_admin";
type OwnerVisibility = "visible" | "hidden";
type CurrentOrganization = NonNullable<ReturnType<typeof useAuth>["organization"]>;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return "Nao foi possivel salvar as configuracoes de imoveis.";
};

function organizationPayload(
  organization: CurrentOrganization,
  editPolicy: PropertyEditPolicy,
  ownerVisibility: OwnerVisibility,
): UpdateOrganizationInput {
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
        Carregando configuracoes de imoveis...
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
      toast.success("Configuracoes de imoveis salvas.");
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
            <h2 className="text-base font-medium">Configuracoes de imoveis</h2>
            <p className="text-sm text-muted-foreground">Defina regras da carteira para esta organizacao.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <PencilLine className="h-4 w-4 text-primary" strokeWidth={1.6} />
              <div>
                <h3 className="text-sm font-medium">Edicao de imoveis</h3>
                <p className="text-xs text-muted-foreground">Controle quem pode alterar dados dos imoveis.</p>
              </div>
            </div>
            <RadioGroup value={editPolicy} onValueChange={(value) => setEditPolicy(value as PropertyEditPolicy)} className="space-y-2">
              <PolicyOption
                value="responsible_or_admin"
                label="Responsaveis e administradores"
                description="Somente captador/responsavel, gestores e admins podem editar."
              />
              <PolicyOption
                value="everyone"
                label="Todos os usuarios"
                description="Qualquer usuario ativo da organizacao pode editar imoveis."
              />
            </RadioGroup>
          </div>

          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" strokeWidth={1.6} />
              <div>
                <h3 className="text-sm font-medium">Visualizacao do proprietario</h3>
                <p className="text-xs text-muted-foreground">Proteja telefone e contato do proprietario.</p>
              </div>
            </div>
            <RadioGroup value={ownerVisibility} onValueChange={(value) => setOwnerVisibility(value as OwnerVisibility)} className="space-y-2">
              <PolicyOption
                value="visible"
                label="Mostrar contato"
                description="Corretores podem ver nome, telefone e e-mail do proprietario."
              />
              <PolicyOption
                value="hidden"
                label="Ocultar contato"
                description="Corretores veem o nome, mas telefone e e-mail ficam ocultos."
              />
            </RadioGroup>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={handleSave} disabled={saving || !organization?.id}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar configuracoes
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
}: {
  value: string;
  label: string;
  description: string;
}) {
  return (
    <Label
      htmlFor={`property-setting-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-[6px] bg-background/60 p-3 transition hover:bg-background"
    >
      <RadioGroupItem id={`property-setting-${value}`} value={value} className="mt-0.5" />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}
