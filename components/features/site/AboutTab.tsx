import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-6">
      {/* Conteúdo Principal */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle>Conteúdo Principal</CardTitle>
          <CardDescription>Título, subtítulo, texto e imagem da página Sobre</CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6 pb-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Text fields */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título da Página</Label>
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
                <p className="text-xs text-muted-foreground">Aparece acima do texto descritivo</p>
              </div>
              <div className="space-y-2">
                <Label>Texto Descritivo</Label>
                <Textarea
                  placeholder="Conte a história da sua imobiliária..."
                  value={formData.about_text}
                  onChange={(e) => setFormData({ ...formData, about_text: e.target.value })}
                  rows={6}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            {/* Right: Image */}
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

          <div className="flex items-center justify-between pt-2 border-t border-white/[0.055]">
            <div className="space-y-0.5">
              <Label>Exibir seção Sobre na Home</Label>
              <p className="text-sm text-muted-foreground">
                Mostra o conteúdo da página Sobre também na página inicial
              </p>
            </div>
            <Switch
              checked={formData.show_about_on_home}
              onCheckedChange={(checked) => setFormData({ ...formData, show_about_on_home: checked })}
              disabled={!isAdmin}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Estatísticas */}
        <Card className="app-card">
          <CardHeader>
            <CardTitle>Estatísticas</CardTitle>
            <CardDescription>Números em destaque exibidos no topo da página Sobre</CardDescription>
          </CardHeader>
          <CardContent className="px-4 md:px-6 pb-5 space-y-4">
            {formData.about_stats.map((stat: AboutStat, index: number) => (
              <div key={index} className="flex items-center gap-3">
                <div className="flex-1 grid grid-cols-2 gap-3">
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
                  <Button variant="ghost" size="icon" onClick={() => removeStat(index)} className="text-destructive hover:text-destructive shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            {isAdmin && formData.about_stats.length < 6 && (
              <Button variant="outline" size="sm" onClick={addStat} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Estatística
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Checkmarks */}
        <Card className="app-card">
          <CardHeader>
            <CardTitle>Destaques</CardTitle>
            <CardDescription>Itens com check exibidos abaixo do texto descritivo</CardDescription>
          </CardHeader>
          <CardContent className="px-4 md:px-6 pb-5 space-y-4">
            {formData.about_checkmarks.map((item: string, index: number) => (
              <div key={index} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: 'hsl(var(--primary))' }}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(var(--primary))' }} />
                </div>
                <Input
                  value={item}
                  onChange={(e) => updateCheckmark(index, e.target.value)}
                  disabled={!isAdmin}
                  className="flex-1"
                />
                {isAdmin && formData.about_checkmarks.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => removeCheckmark(index)} className="text-destructive hover:text-destructive shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            {isAdmin && formData.about_checkmarks.length < 6 && (
              <Button variant="outline" size="sm" onClick={addCheckmark} className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Destaque
              </Button>
            )}
          </CardContent>
        </Card>
      </div>



      {/* Cards de Diferenciais */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle>Diferenciais</CardTitle>
          <CardDescription>Cards com ícones exibidos na seção &quot;Por que escolher&quot;</CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6 pb-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {formData.about_features.map((feature: AboutFeature, index: number) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Diferencial {index + 1}</span>
                  {isAdmin && formData.about_features.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeFeature(index)} className="text-destructive hover:text-destructive h-8 w-8">
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
            <Button variant="outline" size="sm" onClick={addFeature} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Diferencial
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
