"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { RequiredMark, togglePanelClass } from "../PropertyFormFields";
import { parseDecimalInput } from "../property-form-model";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function CharacteristicsSection() {
  const {
    formData,
    set,
    isLand,
    isEditing,
    canManagePropertyCatalogs,
  } = usePropertyFormSections();
  const showManagerOnlyFields = !isEditing || canManagePropertyCatalogs;

  return (
  <TabsContent value="characteristics">
    <div
      data-tour="property-characteristics-section"
      className="space-y-4"
    >
      {/* Detalhes do imóvel */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle className="text-[14px] font-normal">
            Detalhes do Imóvel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLand ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="property-bedrooms">
                  Quartos <RequiredMark />
                </Label>
                <Select
                  value={formData.quartos}
                  onValueChange={(v) => set("quartos", v)}
                >
                  <SelectTrigger id="property-bedrooms">
                    <SelectValue placeholder="Qtd" />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 10 ? "10+" : String(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-suites">Suítes</Label>
                <Input
                  id="property-suites"
                  type="number"
                  value={formData.suites}
                  onChange={(e) => set("suites", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-bathrooms">Banheiros</Label>
                <Input
                  id="property-bathrooms"
                  type="number"
                  value={formData.banheiros}
                  onChange={(e) => set("banheiros", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-parking-spaces">Vagas</Label>
                <Input
                  id="property-parking-spaces"
                  type="number"
                  value={formData.vagas}
                  onChange={(e) => set("vagas", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              Terreno e lote usam metragem total como dado principal.
              Quartos, suítes, banheiros e vagas deixam de ser
              obrigatórios.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="property-usable-area">Área Útil (m²)</Label>
              <Input
                id="property-usable-area"
                inputMode="decimal"
                value={formData.area_util}
                onChange={(e) =>
                  set("area_util", parseDecimalInput(e.target.value))
                }
                placeholder="120,5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-total-area">
                Área Total (m²){isLand && <RequiredMark />}
              </Label>
              <Input
                id="property-total-area"
                inputMode="decimal"
                value={formData.area_total}
                onChange={(e) =>
                  set("area_total", parseDecimalInput(e.target.value))
                }
                placeholder="150,5"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="property-floor">Andar</Label>
              <Input
                id="property-floor"
                type="number"
                value={formData.andar}
                onChange={(e) => set("andar", e.target.value)}
                placeholder="5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-construction-year">Ano de Construção</Label>
              <Input
                id="property-construction-year"
                type="number"
                value={formData.ano_construcao}
                onChange={(e) =>
                  set("ano_construcao", e.target.value)
                }
                placeholder="2020"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-renovation-year">Ano de Reforma</Label>
              <Input
                id="property-renovation-year"
                type="number"
                value={formData.ano_reforma}
                onChange={(e) => set("ano_reforma", e.target.value)}
                placeholder="2023"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="property-standard">Padrão</Label>
              <Select
                value={formData.padrao}
                onValueChange={(v) => set("padrao", v)}
              >
                <SelectTrigger id="property-standard">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popular">Popular</SelectItem>
                  <SelectItem value="medio">Médio</SelectItem>
                  <SelectItem value="alto">Alto</SelectItem>
                  <SelectItem value="luxo">Luxo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-location-position">Posição da Localização</Label>
              <Select
                value={formData.posicao_localizacao}
                onValueChange={(v) => set("posicao_localizacao", v)}
              >
                <SelectTrigger id="property-location-position">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frente">Frente</SelectItem>
                  <SelectItem value="fundos">Fundos</SelectItem>
                  <SelectItem value="lateral">Lateral</SelectItem>
                  <SelectItem value="esquina">Esquina</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {showManagerOnlyFields && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="property-condition">Situação do Imóvel</Label>
                <Select
                  value={formData.situacao_imovel}
                  onValueChange={(v) => set("situacao_imovel", v)}
                >
                  <SelectTrigger id="property-condition">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="usado">Usado</SelectItem>
                    <SelectItem value="em_construcao">
                      Em Construção
                    </SelectItem>
                    <SelectItem value="planta">Na Planta</SelectItem>
                    <SelectItem value="reformado">Reformado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="property-occupancy">Ocupação</Label>
                <Select
                  value={formData.ocupacao}
                  onValueChange={(v) => set("ocupacao", v)}
                >
                  <SelectTrigger id="property-occupancy">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desocupado">
                      Desocupado
                    </SelectItem>
                    <SelectItem value="ocupado_proprietario">
                      Ocupado pelo proprietário
                    </SelectItem>
                    <SelectItem value="ocupado_inquilino">
                      Ocupado por inquilino
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="property-furnishing">Mobília</Label>
            <Select
              value={formData.mobilia}
              onValueChange={(v) => set("mobilia", v)}
            >
              <SelectTrigger id="property-furnishing">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Mobiliado">Mobiliado</SelectItem>
                <SelectItem value="Semi-mobiliado">
                  Semi-mobiliado
                </SelectItem>
                <SelectItem value="Sem mobília">
                  Sem mobília
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={togglePanelClass}>
              <Label htmlFor="property-accepts-pets">Aceita Pet</Label>
              <Switch
                id="property-accepts-pets"
                checked={formData.regra_pet}
                onCheckedChange={(v) => set("regra_pet", v)}
              />
            </div>
            {showManagerOnlyFields && (
              <div className={togglePanelClass}>
                <Label htmlFor="property-commercialization-authorized">Autorizado para Comercialização</Label>
                <Switch
                  id="property-commercialization-authorized"
                  checked={formData.autorizado_comercializacao}
                  onCheckedChange={(v) =>
                    set("autorizado_comercializacao", v)
                  }
                />
              </div>
            )}
            <div className={togglePanelClass}>
              <Label htmlFor="property-exclusive">Exclusividade</Label>
              <Switch
                id="property-exclusive"
                checked={formData.exclusividade}
                onCheckedChange={(v) => set("exclusividade", v)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controle interno */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle className="text-[14px] font-normal">
            {showManagerOnlyFields ? "Controle interno" : "Zoneamento"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="property-zoning">Zoneamento</Label>
              <Input
                id="property-zoning"
                value={formData.zoneamento}
                onChange={(e) => set("zoneamento", e.target.value)}
                placeholder="ZR-1, ZC-2..."
              />
            </div>
            {showManagerOnlyFields && (
              <div className="space-y-2">
                <Label htmlFor="property-key-location">Local das Chaves</Label>
                <Input
                  id="property-key-location"
                  value={formData.local_chaves}
                  onChange={(e) => set("local_chaves", e.target.value)}
                  placeholder="Ex: Na portaria, no escritório..."
                />
              </div>
            )}
          </div>
          {showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-internal-comments">Comentários Internos</Label>
              <Textarea
                id="property-internal-comments"
                value={formData.comentarios_internos}
                onChange={(e) =>
                  set("comentarios_internos", e.target.value)
                }
                placeholder="Observações internas..."
                rows={3}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  </TabsContent>
  );
}
