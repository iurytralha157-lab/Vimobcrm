"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { PropertyOwnerCombobox } from "@/components/features/properties/PropertyOwnerCombobox";
import { RequiredMark, togglePanelClass } from "../PropertyFormFields";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function OwnerSection() {
  const {
    formData,
    set,
    user,
    profile,
    users,
    canManagePropertyCatalogs,
    canAssignProperty,
    canEditOwnerDetails,
    applyOwner,
    handleCreateOwner,
    createPropertyOwner
  } = usePropertyFormSections();
  const hasRegisteredOwner = Boolean(formData.owner_id);
  const canEditInlineOwnerDetails = canEditOwnerDetails && !hasRegisteredOwner;

  return (
  <TabsContent value="owner">
    <Card data-tour="property-owner-section" className="app-card">
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Responsável e Proprietário
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEditOwnerDetails && (
          <p
            id="property-owner-privacy-notice"
            role="status"
            className="rounded-[6px] bg-muted px-3 py-2 text-xs text-muted-foreground"
          >
            Os dados do proprietário estão protegidos pela configuração da organização e não serão alterados neste salvamento.
          </p>
        )}
        {canEditOwnerDetails && hasRegisteredOwner && (
          <p
            id="property-owner-catalog-notice"
            role="status"
            className="rounded-[6px] bg-muted px-3 py-2 text-xs text-muted-foreground"
          >
            Os dados abaixo vêm do cadastro do proprietário. Para alterá-los,
            use a área de{" "}
            <Link className="underline underline-offset-2" href="/properties/owners">
              Proprietários
            </Link>
            , ou escolha &quot;Digitar novo proprietário&quot; no seletor.
          </p>
        )}
        <div className="app-card-soft border-0 p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_184px] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="property-captor">
                Responsável pela captação <RequiredMark />
              </Label>
              <Select
                value={formData.cadastrado_por}
                onValueChange={(v) => set("cadastrado_por", v)}
                disabled={!canAssignProperty}
              >
                <SelectTrigger id="property-captor">
                  <SelectValue placeholder="Selecione o captador responsável" />
                </SelectTrigger>
                <SelectContent>
                  {user?.id && (
                    <SelectItem key={user.id} value={user.id}>
                      {profile?.name || user.email} (Você)
                    </SelectItem>
                  )}
                  {users
                    .filter((u) => u.id !== user?.id)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="property-owner-selector">
                Proprietário cadastrado
              </Label>
              <PropertyOwnerCombobox
                id="property-owner-selector"
                value={formData.owner_id}
                selectedLabel={formData.owner_name}
                onSelect={applyOwner}
                allowManual
                disabled={!canEditOwnerDetails}
              />
            </div>

            {canManagePropertyCatalogs && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleCreateOwner}
                disabled={
                  createPropertyOwner.isPending ||
                  !formData.owner_name.trim() ||
                  !canEditInlineOwnerDetails
                }
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface)] px-5 shadow-none hover:bg-primary hover:text-primary-foreground disabled:hover:bg-[var(--app-surface)] disabled:hover:text-muted-foreground lg:mb-2"
              >
                {createPropertyOwner.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <Plus className="mr-2 h-4 w-4" />
                Salvar proprietário
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Apenas administradores e o responsável pela captação
            poderão editar o imóvel depois.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-owner-name">
              Nome do Proprietário {canEditInlineOwnerDetails && <RequiredMark />}
            </Label>
            <Input
              id="property-owner-name"
              value={formData.owner_name}
              disabled={!canEditInlineOwnerDetails}
              aria-describedby={
                !canEditOwnerDetails
                  ? "property-owner-privacy-notice"
                  : hasRegisteredOwner
                    ? "property-owner-catalog-notice"
                    : undefined
              }
              onChange={(e) => {
                set("owner_id", "");
                set("owner_name", e.target.value);
              }}
              placeholder="Nome completo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-owner-email">E-mail</Label>
            <Input
              id="property-owner-email"
              type="email"
              value={formData.owner_email}
              disabled={!canEditInlineOwnerDetails}
              aria-describedby={
                !canEditOwnerDetails
                  ? "property-owner-privacy-notice"
                  : hasRegisteredOwner
                    ? "property-owner-catalog-notice"
                    : undefined
              }
              onChange={(e) => set("owner_email", e.target.value)}
              placeholder="email@exemplo.com"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="property-owner-phone-residential">Tel. Residencial</Label>
            <Input
              id="property-owner-phone-residential"
              value={formData.owner_phone_residential}
              disabled={!canEditInlineOwnerDetails}
              aria-describedby={
                !canEditOwnerDetails
                  ? "property-owner-privacy-notice"
                  : hasRegisteredOwner
                    ? "property-owner-catalog-notice"
                    : undefined
              }
              onChange={(e) =>
                set("owner_phone_residential", e.target.value)
              }
              placeholder="(00) 0000-0000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-owner-phone-commercial">Tel. Comercial</Label>
            <Input
              id="property-owner-phone-commercial"
              value={formData.owner_phone_commercial}
              disabled={!canEditInlineOwnerDetails}
              aria-describedby={
                !canEditOwnerDetails
                  ? "property-owner-privacy-notice"
                  : hasRegisteredOwner
                    ? "property-owner-catalog-notice"
                    : undefined
              }
              onChange={(e) =>
                set("owner_phone_commercial", e.target.value)
              }
              placeholder="(00) 0000-0000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-owner-cellphone">Celular</Label>
            <Input
              id="property-owner-cellphone"
              value={formData.owner_cellphone}
              disabled={!canEditInlineOwnerDetails}
              aria-describedby={
                !canEditOwnerDetails
                  ? "property-owner-privacy-notice"
                  : hasRegisteredOwner
                    ? "property-owner-catalog-notice"
                    : undefined
              }
              onChange={(e) => set("owner_cellphone", e.target.value)}
              placeholder="(00) 00000-0000"
            />
          </div>
        </div>
        {canEditInlineOwnerDetails && (
          <p className="text-xs text-muted-foreground">
            Informe pelo menos um contato do proprietário <RequiredMark />:
            celular, telefone ou e-mail.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.25fr] gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-owner-media-source">Mídia de Origem</Label>
            <Select
              value={formData.owner_media_source}
              onValueChange={(v) => set("owner_media_source", v)}
              disabled={!canEditInlineOwnerDetails}
            >
              <SelectTrigger id="property-owner-media-source">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="indicacao">Indicação</SelectItem>
                <SelectItem value="site">Site</SelectItem>
                <SelectItem value="redes_sociais">
                  Redes Sociais
                </SelectItem>
                <SelectItem value="placa">Placa</SelectItem>
                <SelectItem value="portais">
                  Portais Imobiliários
                </SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className={togglePanelClass}>
            <Label htmlFor="property-owner-notify-email">
              Enviar avisos por e-mail para o proprietário
            </Label>
            <Switch
              id="property-owner-notify-email"
              checked={formData.owner_notify_email}
              onCheckedChange={(v) => set("owner_notify_email", v)}
              disabled={!canEditInlineOwnerDetails}
              aria-describedby={
                !canEditOwnerDetails
                  ? "property-owner-privacy-notice"
                  : hasRegisteredOwner
                    ? "property-owner-catalog-notice"
                    : undefined
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  </TabsContent>
  );
}
