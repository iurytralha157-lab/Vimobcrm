"use client";

import { FeatureSelector } from "@/components/features/properties/FeatureSelector";
import { Card, CardContent } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { DEFAULT_FEATURES } from "@/hooks/use-property-features";
import { DEFAULT_PROXIMITIES } from "@/hooks/use-property-proximities";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function ExtrasSection() {
  const {
    formData,
    set,
    canManagePropertyCatalogs,
    features,
    proximities,
    createFeature,
    createProximity,
    loadingFeatures,
    loadingProximities
  } = usePropertyFormSections();

  return (
  <TabsContent value="extras">
    <div
      data-tour="property-extras-section"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
    >
      <Card className="app-card">
        <CardContent className="pt-6">
          <FeatureSelector
            title="Detalhes Extras do Imóvel"
            options={
              features.length > 0
                ? features.map((f) => f.name)
                : DEFAULT_FEATURES
            }
            selected={formData.detalhes_extras}
            onChange={(selected) => set("detalhes_extras", selected)}
            allowAdd={canManagePropertyCatalogs}
            onAddNew={canManagePropertyCatalogs ? async (name) => {
              await createFeature.mutateAsync(name);
            } : undefined}
            isLoading={loadingFeatures}
          />
        </CardContent>
      </Card>
      <Card className="app-card">
        <CardContent className="pt-6">
          <FeatureSelector
            title="Proximidades"
            options={
              proximities.length > 0
                ? proximities.map((p) => p.name)
                : DEFAULT_PROXIMITIES
            }
            selected={formData.proximidades}
            onChange={(selected) => set("proximidades", selected)}
            allowAdd={canManagePropertyCatalogs}
            onAddNew={canManagePropertyCatalogs ? async (name) => {
              await createProximity.mutateAsync(name);
            } : undefined}
            isLoading={loadingProximities}
          />
        </CardContent>
      </Card>
    </div>
  </TabsContent>
  );
}
