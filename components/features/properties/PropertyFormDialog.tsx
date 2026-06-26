import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Loader2 } from 'lucide-react';
import { Property } from '@/hooks/use-properties';
import { ImageUploader } from './ImageUploader';
import { FeatureSelector } from './FeatureSelector';
import { useIsMobile } from '@/hooks/use-mobile';

interface FormData {
  title: string;
  tipo_de_imovel: string;
  tipo_de_negocio: string;
  status: string;
  destaque: boolean;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  quartos: string;
  suites: string;
  banheiros: string;
  vagas: string;
  area_util: string;
  area_total: string;
  mobilia: string;
  regra_pet: boolean;
  andar: string;
  ano_construcao: string;
  preco: string;
  condominio: string;
  iptu: string;
  seguro_incendio: string;
  taxa_de_servico: string;
  commission_percentage: string;
  descricao: string;
  imagem_principal: string;
  fotos: string[];
  video_imovel: string;
  detalhes_extras: string[];
  proximidades: string[];
}

interface PropertyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProperty: Property | null;
  formData: FormData;
  setFormData: React.Dispatch<React.SetStateAction<FormData>>;
  onSubmit: (e: React.FormEvent) => void;
  propertyTypes: string[];
  features: { id: string; name: string }[];
  proximities: { id: string; name: string }[];
  loadingFeatures: boolean;
  loadingProximities: boolean;
  onAddPropertyType: () => void;
  onAddFeature: (name: string) => Promise<void>;
  onAddProximity: (name: string) => Promise<void>;
  isCreating: boolean;
  isUpdating: boolean;
  isCreatingType: boolean;
  newTypeName: string;
  setNewTypeName: (name: string) => void;
  showAddType: boolean;
  setShowAddType: (show: boolean) => void;
  defaultFeatures: string[];
  defaultProximities: string[];
}

export function PropertyFormDialog({
  open,
  onOpenChange,
  editingProperty,
  formData,
  setFormData,
  onSubmit,
  propertyTypes,
  features,
  proximities,
  loadingFeatures,
  loadingProximities,
  onAddPropertyType,
  onAddFeature,
  onAddProximity,
  isCreating,
  isUpdating,
  isCreatingType,
  newTypeName,
  setNewTypeName,
  showAddType,
  setShowAddType,
  defaultFeatures,
  defaultProximities,
}: PropertyFormDialogProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('overview');

  const isFormValid =
    formData.title.trim() !== '' &&
    formData.preco.trim() !== '' &&
    formData.quartos.trim() !== '' &&
    formData.imagem_principal.trim() !== '' &&
    formData.fotos.length > 0;

  // Funções de formatação de moeda
  const formatCurrencyDisplay = (value: string): string => {
    if (!value) return '';
    const numbers = value.replace(/\D/g, '');
    if (!numbers) return '';
    const formatted = Number(numbers).toLocaleString('pt-BR');
    return formatted;
  };

  const parseCurrencyInput = (value: string): string => {
    return value.replace(/\D/g, '');
  };

  const handleImagesChange = (images: string[], mainImage: string) => {
    setFormData({
      ...formData,
      fotos: images,
      imagem_principal: mainImage
    });
  };

  const formContent = (
    <form onSubmit={onSubmit} className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className={`grid w-full mb-4 ${isMobile ? 'grid-cols-4 gap-1' : 'grid-cols-7'}`}>
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Geral</TabsTrigger>
          <TabsTrigger value="location" className="text-xs sm:text-sm">Local</TabsTrigger>
          <TabsTrigger value="details" className="text-xs sm:text-sm">Detalhes</TabsTrigger>
          <TabsTrigger value="extras" className="text-xs sm:text-sm">Extras</TabsTrigger>
          {!isMobile && (
            <>
              <TabsTrigger value="values" className="text-xs sm:text-sm">Valores</TabsTrigger>
              <TabsTrigger value="description" className="text-xs sm:text-sm">Descrição</TabsTrigger>
              <TabsTrigger value="media" className="text-xs sm:text-sm">Mídia</TabsTrigger>
            </>
          )}
        </TabsList>

        {isMobile && (
          <TabsList className="grid grid-cols-3 w-full mb-4 gap-1">
            <TabsTrigger value="values" className="text-xs">Valores</TabsTrigger>
            <TabsTrigger value="description" className="text-xs">Descrição</TabsTrigger>
            <TabsTrigger value="media" className="text-xs">Mídia</TabsTrigger>
          </TabsList>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 m-0">
            {editingProperty && (
              <div className="space-y-2">
                <Label>Código</Label>
                <Input value={editingProperty.code} readOnly className="bg-white/[0.045] font-mono" />
              </div>
            )}
            <div className="space-y-2">
              <Label>Título do Imóvel</Label>
              <Input
                placeholder="Ex: Apartamento 3 quartos..."
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Tipo de Imóvel</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setShowAddType(!showAddType)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Adicionar
                  </Button>
                </div>
                {showAddType && (
                  <div className="flex gap-2 mb-2">
                    <Input
                      placeholder="Novo tipo..."
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      onClick={onAddPropertyType}
                      disabled={isCreatingType}
                    >
                      OK
                    </Button>
                  </div>
                )}
                <Select
                  value={formData.tipo_de_imovel}
                  onValueChange={(v) => setFormData({ ...formData, tipo_de_imovel: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {propertyTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Negócio</Label>
                <Select
                  value={formData.tipo_de_negocio}
                  onValueChange={(v) => setFormData({ ...formData, tipo_de_negocio: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Venda">Venda</SelectItem>
                    <SelectItem value="Aluguel">Aluguel</SelectItem>
                    <SelectItem value="Temporada">Temporada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData({ ...formData, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                    <SelectItem value="vendido">Vendido</SelectItem>
                    <SelectItem value="alugado">Alugado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <Label>Imóvel em Destaque</Label>
                <Switch
                  checked={formData.destaque}
                  onCheckedChange={(checked) => setFormData({ ...formData, destaque: checked })}
                />
              </div>
            </div>
          </TabsContent>

          {/* Location Tab */}
          <TabsContent value="location" className="space-y-4 m-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Endereço</Label>
                <Input
                  placeholder="Rua, Avenida..."
                  value={formData.endereco}
                  onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Número</Label>
                <Input
                  placeholder="123"
                  value={formData.numero}
                  onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Complemento</Label>
              <Input
                placeholder="Apto 101, Bloco A..."
                value={formData.complemento}
                onChange={(e) => setFormData({ ...formData, complemento: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bairro</Label>
                <Input
                  placeholder="Jardins"
                  value={formData.bairro}
                  onChange={(e) => setFormData({ ...formData, bairro: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input
                  placeholder="São Paulo"
                  value={formData.cidade}
                  onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CEP</Label>
                <Input
                  placeholder="00000-000"
                  value={formData.cep}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 8);
                    const formatted = value.length > 5 ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
                    setFormData({ ...formData, cep: formatted });
                  }}
                  onBlur={async () => {
                    const cep = formData.cep.replace(/\D/g, '');
                    if (cep.length === 8) {
                      try {
                        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                        const data = await res.json();
                        if (!data.erro) {
                          setFormData({
                            ...formData,
                            endereco: data.logradouro || formData.endereco,
                            bairro: data.bairro || formData.bairro,
                            cidade: data.localidade || formData.cidade,
                            uf: data.uf || formData.uf,
                          });
                        }
                      } catch {
                        // noop
                      }
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">Digite o CEP para preencher automaticamente</p>
              </div>
              <div className="space-y-2">
                <Label>Estado (UF)</Label>
                <Input
                  placeholder="SP"
                  maxLength={2}
                  value={formData.uf}
                  onChange={(e) => setFormData({ ...formData, uf: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-4 m-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Quartos</Label>
                <Select
                  value={formData.quartos || undefined}
                  onValueChange={(v) => setFormData({ ...formData, quartos: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[0,1,2,3,4,5,6,7,8,9,10].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n === 10 ? '10+' : String(n)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Suítes</Label>
                <Input
                  type="number"
                  placeholder="1"
                  value={formData.suites}
                  onChange={(e) => setFormData({ ...formData, suites: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Banheiros</Label>
                <Input
                  type="number"
                  placeholder="2"
                  value={formData.banheiros}
                  onChange={(e) => setFormData({ ...formData, banheiros: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Vagas</Label>
                <Input
                  type="number"
                  placeholder="2"
                  value={formData.vagas}
                  onChange={(e) => setFormData({ ...formData, vagas: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Área Útil (m²)</Label>
                <Input
                  type="number"
                  placeholder="120"
                  value={formData.area_util}
                  onChange={(e) => setFormData({ ...formData, area_util: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Área Total (m²)</Label>
                <Input
                  type="number"
                  placeholder="150"
                  value={formData.area_total}
                  onChange={(e) => setFormData({ ...formData, area_total: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Andar</Label>
                <Input
                  type="number"
                  placeholder="5"
                  value={formData.andar}
                  onChange={(e) => setFormData({ ...formData, andar: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Ano de Construção</Label>
                <Input
                  type="number"
                  placeholder="2020"
                  value={formData.ano_construcao}
                  onChange={(e) => setFormData({ ...formData, ano_construcao: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mobília</Label>
            <Select
              value={formData.mobilia || undefined}
              onValueChange={(v) => setFormData({ ...formData, mobilia: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mobiliado">Mobiliado</SelectItem>
                  <SelectItem value="Semi-mobiliado">Semi-mobiliado</SelectItem>
                  <SelectItem value="Sem mobília">Sem mobília</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <Label>Aceita Pet</Label>
              <Switch
                checked={formData.regra_pet}
                onCheckedChange={(checked) => setFormData({ ...formData, regra_pet: checked })}
              />
            </div>
          </TabsContent>

          {/* Extras Tab */}
          <TabsContent value="extras" className="space-y-6 m-0">
            <FeatureSelector
              title="Detalhes Extras do Imóvel"
              options={features.length > 0 ? features.map(f => f.name) : defaultFeatures}
              selected={formData.detalhes_extras}
              onChange={(selected) => setFormData(prev => ({ ...prev, detalhes_extras: selected }))}
              allowAdd
              onAddNew={onAddFeature}
              isLoading={loadingFeatures}
            />

            <Separator />

            <FeatureSelector
              title="Proximidades"
              options={proximities.length > 0 ? proximities.map(p => p.name) : defaultProximities}
              selected={formData.proximidades}
              onChange={(selected) => setFormData(prev => ({ ...prev, proximidades: selected }))}
              allowAdd
              onAddNew={onAddProximity}
              isLoading={loadingProximities}
            />
          </TabsContent>

          {/* Values Tab */}
          <TabsContent value="values" className="space-y-4 m-0">
            <div className="space-y-2">
              <Label>Preço (R$)</Label>
              <Input
                placeholder="500.000"
                value={formatCurrencyDisplay(formData.preco)}
                onChange={(e) => setFormData({ ...formData, preco: parseCurrencyInput(e.target.value) })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Condomínio (R$)</Label>
                <Input
                  placeholder="800"
                  value={formatCurrencyDisplay(formData.condominio)}
                  onChange={(e) => setFormData({ ...formData, condominio: parseCurrencyInput(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>IPTU (R$)</Label>
                <Input
                  placeholder="200"
                  value={formatCurrencyDisplay(formData.iptu)}
                  onChange={(e) => setFormData({ ...formData, iptu: parseCurrencyInput(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Seguro Incêndio (R$)</Label>
                <Input
                  placeholder="50"
                  value={formatCurrencyDisplay(formData.seguro_incendio)}
                  onChange={(e) => setFormData({ ...formData, seguro_incendio: parseCurrencyInput(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Taxa de Serviço (R$)</Label>
                <Input
                  placeholder="100"
                  value={formatCurrencyDisplay(formData.taxa_de_servico)}
                  onChange={(e) => setFormData({ ...formData, taxa_de_servico: parseCurrencyInput(e.target.value) })}
                />
              </div>
            </div>

            {/* Commission Percentage Field */}
            <div className="p-4 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30">
              <div className="space-y-2">
                <Label className="text-orange-700 dark:text-orange-300">Comissão da Imobiliária (%)</Label>
                <p className="text-xs text-orange-600 dark:text-orange-400">
                  Percentual que a construtora/proprietário paga para a imobiliária
                </p>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="5"
                  value={formData.commission_percentage}
                  onChange={(e) => setFormData({ ...formData, commission_percentage: e.target.value })}
                  className="border-orange-200 dark:border-orange-700 focus:border-orange-400"
                />
              </div>
            </div>
          </TabsContent>

          {/* Description Tab */}
          <TabsContent value="description" className="space-y-4 m-0">
            <div className="space-y-2">
              <Label>Descrição do Imóvel</Label>
              <Textarea
                placeholder="Descreva o imóvel com detalhes..."
                value={formData.descricao}
                onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                rows={isMobile ? 8 : 12}
                className={isMobile ? 'min-h-[200px]' : 'min-h-[300px]'}
              />
            </div>
          </TabsContent>

          {/* Media Tab */}
          <TabsContent value="media" className="space-y-4 m-0">
            <ImageUploader
              images={formData.fotos}
              mainImage={formData.imagem_principal}
              onImagesChange={handleImagesChange}
              organizationId={editingProperty?.organization_id}
              propertyId={editingProperty?.id}
            />
            <div className="space-y-2">
              <Label>Vídeo do Imóvel (URL)</Label>
              <Input
                placeholder="https://youtube.com/watch?v=..."
                value={formData.video_imovel}
                onChange={(e) => setFormData({ ...formData, video_imovel: e.target.value })}
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <div className="flex gap-2 pt-4 border-t mt-4">
        <Button type="button" variant="outline" className="w-[40%] rounded-xl" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          type="submit"
          className="w-[60%] rounded-xl"
          disabled={isCreating || isUpdating || !isFormValid}
        >
          {(isCreating || isUpdating) && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          {editingProperty ? 'Salvar' : 'Cadastrar'}
        </Button>
      </div>
    </form>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editingProperty ? 'Editar Imóvel' : 'Cadastrar Imóvel'}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {formContent}
        </div>
      </SheetContent>
    </Sheet>
  );
}
