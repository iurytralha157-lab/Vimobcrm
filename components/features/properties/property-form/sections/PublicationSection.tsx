"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Globe, Lock } from "lucide-react";
import { togglePanelClass } from "../PropertyFormFields";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function PublicationSection() {
  const {
    formData, set, isEditing, propertyId, router, canManagePropertyCatalogs
  } = usePropertyFormSections();

  return (
  <TabsContent value="publication">
    <Card
      data-tour="property-publication-section"
      className="app-card"
    >
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Publicação na Web
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            data-testid="property-publication-guidance"
            className="flex flex-col gap-3 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between lg:col-span-4"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                {formData.anunciar ? (
                  <Globe aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Lock aria-hidden="true" className="h-4 w-4" />
                )}
              </span>
              <div>
                <p className="text-sm font-medium">
                  Publicação centralizada na Ficha 360
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {isEditing
                    ? `Este imóvel está ${formData.anunciar ? "publicado" : "fora do site"}. Use a Central de Publicação para validar requisitos, conferir a prévia e alterar esse estado.`
                    : "O novo imóvel será salvo fora do site. Depois do cadastro, publique com segurança pela Central de Publicação da Ficha 360."}
                </p>
              </div>
            </div>
            {isEditing && propertyId && canManagePropertyCatalogs && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  router.push(
                    `/properties/${propertyId}?tab=publication`,
                  )
                }
              >
                <Globe aria-hidden="true" className="mr-2 h-4 w-4" />
                Abrir Central
              </Button>
            )}
          </div>
          <div className={togglePanelClass}>
            <Label htmlFor="property-highlight-switch">
              Imóvel em Destaque
            </Label>
            <Switch
              id="property-highlight-switch"
              checked={formData.destaque}
              onCheckedChange={(v) => set("destaque", v)}
            />
          </div>
          <div className={togglePanelClass}>
            <Label htmlFor="property-super-highlight-switch">
              Super Destaque
            </Label>
            <Switch
              id="property-super-highlight-switch"
              checked={formData.super_destaque}
              onCheckedChange={(v) => set("super_destaque", v)}
            />
          </div>
          <div className={togglePanelClass}>
            <Label htmlFor="property-sign-switch">
              Placa no Local
            </Label>
            <Switch
              id="property-sign-switch"
              checked={formData.placa_no_local}
              onCheckedChange={(v) => set("placa_no_local", v)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  </TabsContent>
  );
}
