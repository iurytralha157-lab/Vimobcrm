import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { ImageUpload } from "@/components/ui/image-upload";

interface AboutStat {
  value: string;
  label: string;
}

interface AboutFeature {
  title: string;
  description: string;
  icon: string;
}

interface AboutFormFields {
  about_title: string;
  about_text: string;
  about_subtitle: string;
  about_stats: AboutStat[];
  about_checkmarks: string[];
  about_features: AboutFeature[];
  show_about_on_home: boolean;
}

interface AboutSite {
  about_image_url?: string | null;
}

interface AboutTabProps<TFormData extends AboutFormFields> {
  formData: TFormData;
  setFormData: (data: TFormData) => void;
  site: AboutSite | null | undefined;
  isAdmin: boolean;
  onImageChange?: (url: string | null) => void;
}

export function AboutTab<TFormData extends AboutFormFields>({ formData, setFormData, site, isAdmin, onImageChange }: AboutTabProps<TFormData>) {
  const updateStat = (index: number, field: keyof AboutStat, value: string) => {
    const newStats = [...formData.about_stats];
    newStats[index] = { ...newStats[index], [field]: value };
    setFormData({ ...formData, about_stats: newStats });
  };

  const addStat = () => {
    if (formData.about_stats.length >= 6) return;
    setFormData({ ...formData, about_stats: [...formData.about_stats, { value: '0', label: 'Novo' }] });
  };

  const removeStat = (index: number) => {
    setFormData({ ...formData, about_stats: formData.about_stats.filter((_, i) => i !== index) });
  };

  const updateCheckmark = (index: number, value: string) => {
    const newCheckmarks = [...formData.about_checkmarks];
    newCheckmarks[index] = value;
    setFormData({ ...formData, about_checkmarks: newCheckmarks });
  };

  const addCheckmark = () => {
    if (formData.about_checkmarks.length >= 6) return;
    setFormData({ ...formData, about_checkmarks: [...formData.about_checkmarks, 'Novo item'] });
  };

  const removeCheckmark = (index: number) => {
    setFormData({ ...formData, about_checkmarks: formData.about_checkmarks.filter((_, i) => i !== index) });
  };

  const updateFeature = (index: number, field: keyof AboutFeature, value: string) => {
    const newFeatures = [...formData.about_features];
    newFeatures[index] = { ...newFeatures[index], [field]: value };
    setFormData({ ...formData, about_features: newFeatures });
  };

  const addFeature = () => {
    if (formData.about_features.length >= 6) return;
    setFormData({ ...formData, about_features: [...formData.about_features, { title: 'Novo', description: 'Descrição', icon: 'building' }] });
  };

  const removeFeature = (index: number) => {
    setFormData({ ...formData, about_features: formData.about_features.filter((_, i) => i !== index) });
  };

  return (
    <Card className="app-card">
      <CardHeader>
        <CardTitle className="text-lg">Sobre</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-5 md:px-6">
        <div className="app-card-soft border-0 p-4">
          <h3 className="mb-4 text-sm font-medium">Conteúdo principal</h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título da página</Label>
                <Input
                  placeholder="Sobre a Nossa Imobiliária"
                  value={formData.about_title}
                  onChange={(e) => setFormData({ ...formData, about_title: e.target.value })}
                  disabled={!isAdmin}
                />
              </div>
              <div className="space-y-2">
                <Label>Subtítulo</Label>
                <Input
                  placeholder="Transformando sonhos em realidade desde o início"
                  value={formData.about_subtitle}
                  onChange={(e) => setFormData({ ...formData, about_subtitle: e.target.value })}
                  disabled={!isAdmin}
                />
              </div>
              <div className="space-y-2">
                <Label>Texto descritivo</Label>
                <Textarea
                  placeholder="Conte a história da sua imobiliária..."
                  value={formData.about_text}
                  onChange={(e) => setFormData({ ...formData, about_text: e.target.value })}
                  rows={6}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            <ImageUpload
              label="Imagem"
              description="PNG, JPG ou WEBP até 5MB"
              value={site?.about_image_url}
              onChange={(url) => onImageChange?.(url)}
              bucket="site-images"
              path="sites"
              assetType="about"
              aspectRatio="video"
              disabled={!isAdmin}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-[6px] bg-background p-3">
            <Label>Exibir seção Sobre na Home</Label>
            <Switch
              checked={formData.show_about_on_home}
              onCheckedChange={(checked) => setFormData({ ...formData, show_about_on_home: checked })}
              disabled={!isAdmin}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="app-card-soft border-0 p-4">
            <h3 className="mb-4 text-sm font-medium">Estatísticas</h3>
            <div className="space-y-3">
              {formData.about_stats.map((stat: AboutStat, index: number) => (
                <div key={index} className="flex items-center gap-3 rounded-[6px] bg-background p-3">
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    <Input
                      placeholder="500+"
                      value={stat.value}
                      onChange={(e) => updateStat(index, 'value', e.target.value)}
                      disabled={!isAdmin}
                    />
                    <Input
                      placeholder="Imóveis Vendidos"
                      value={stat.label}
                      onChange={(e) => updateStat(index, 'label', e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                  {isAdmin && formData.about_stats.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeStat(index)} className="shrink-0 text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {isAdmin && formData.about_stats.length < 6 && (
                <Button variant="outline" size="sm" onClick={addStat} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar estatística
                </Button>
              )}
            </div>
          </div>

          <div className="app-card-soft border-0 p-4">
            <h3 className="mb-4 text-sm font-medium">Destaques</h3>
            <div className="space-y-3">
              {formData.about_checkmarks.map((item: string, index: number) => (
                <div key={index} className="flex items-center gap-3 rounded-[6px] bg-background p-3">
                  <Input
                    value={item}
                    onChange={(e) => updateCheckmark(index, e.target.value)}
                    disabled={!isAdmin}
                    className="flex-1"
                  />
                  {isAdmin && formData.about_checkmarks.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeCheckmark(index)} className="shrink-0 text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {isAdmin && formData.about_checkmarks.length < 6 && (
                <Button variant="outline" size="sm" onClick={addCheckmark} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar destaque
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="app-card-soft border-0 p-4">
          <h3 className="mb-4 text-sm font-medium">Diferenciais</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {formData.about_features.map((feature: AboutFeature, index: number) => (
              <div key={index} className="space-y-3 rounded-[6px] bg-background p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Diferencial {index + 1}</span>
                  {isAdmin && formData.about_features.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeFeature(index)} className="h-8 w-8 text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <Input
                  placeholder="Título do diferencial"
                  value={feature.title}
                  onChange={(e) => updateFeature(index, 'title', e.target.value)}
                  disabled={!isAdmin}
                />
                <Textarea
                  placeholder="Descrição do diferencial"
                  value={feature.description}
                  onChange={(e) => updateFeature(index, 'description', e.target.value)}
                  rows={2}
                  disabled={!isAdmin}
                />
              </div>
            ))}
          </div>
          {isAdmin && formData.about_features.length < 6 && (
            <Button variant="outline" size="sm" onClick={addFeature} className="mt-4 w-full">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar diferencial
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
