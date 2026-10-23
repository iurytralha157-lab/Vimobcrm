"use client";

import { ImageUploader } from "@/components/features/properties/ImageUploader";
import { PropertyAssetManager } from "@/components/features/properties/detail/PropertyAssetManager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function MediaSection() {
  const {
    isSaving,
    formData,
    set,
    handleImagesChange,
    onPreparingPhotosChange,
    canContinuePhotos,
    isPreparingPhotos,
    property,
    isEditing,
    canManagePropertyCatalogs,
  } = usePropertyFormSections();
  const canEditPropertyMedia = !isEditing || canManagePropertyCatalogs;

  return (
  <TabsContent value="media" id="property-panel-media" aria-labelledby="property-tab-media" className="@container">
    <fieldset disabled={isSaving} className="min-w-0 border-0 p-0">
    <Card data-tour="property-media-section" className="app-card">
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Fotos e Mídia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEditPropertyMedia && (
          <>
            {property?.id ? (
              <PropertyAssetManager propertyId={property.id} disabled={isSaving} />
            ) : (
              <>
                <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[11px] font-light text-muted-foreground">
                  Selecione e organize as fotos agora. Os arquivos permanecem somente neste navegador e serão enviados ao armazenamento protegido junto com o cadastro.
                </div>
                <ImageUploader
                  disabled={isSaving || isPreparingPhotos}
                  onPreparingChange={onPreparingPhotosChange}
                  canContinue={canContinuePhotos}
                  images={formData.fotos}
                  mainImage={formData.imagem_principal}
                  onImagesChange={handleImagesChange}
                  hiddenSiteImages={formData.hidden_site_image_urls}
                  onHiddenSiteImagesChange={(images) =>
                    set("hidden_site_image_urls", images)
                  }
                />
              </>
            )}
            <Separator />
            <div className="grid grid-cols-1 @[480px]:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="property-video-url">Link do Vídeo (YouTube)</Label>
                <Input
                  id="property-video-url"
                  value={formData.video_imovel}
                  onChange={(e) => set("video_imovel", e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-tour-url">Tour Virtual (URL)</Label>
                <Input
                  id="property-tour-url"
                  value={formData.tour_virtual}
                  onChange={(e) => set("tour_virtual", e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="property-internal-description">Descrição interna do imóvel</Label>
          <Textarea
            id="property-internal-description"
            value={formData.descricao}
            onChange={(e) => set("descricao", e.target.value)}
            placeholder="Observações e descrição usadas dentro do CRM..."
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            Use este campo para registrar detalhes internos da equipe.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="property-public-description">Descrição pública no site</Label>
          <Textarea
            id="property-public-description"
            value={formData.descricao_site}
            onChange={(e) => set("descricao_site", e.target.value)}
            placeholder="Texto comercial que será exibido no site público..."
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            Use uma descrição mais comercial, sem informações
            confidenciais.
          </p>
        </div>
      </CardContent>
    </Card>
      </fieldset>
  </TabsContent>
  );
}
