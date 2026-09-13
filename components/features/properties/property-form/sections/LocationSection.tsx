"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2, Plus } from "lucide-react";
import { formatFixedBRLCurrency } from "@/lib/utils/formatting";
import { RequiredMark, togglePanelClass } from "../PropertyFormFields";
import { formatCep, formatCurrencyDisplay, onlyCepDigits, parseCurrencyInput } from "../property-form-model";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function LocationSection() {
  const {
    formData,
    set,
    canManagePropertyCatalogs,
    isEditing,
    cities,
    neighborhoods,
    condominiums,
    selectedCity,
    selectedNeighborhood,
    selectedCondominium,
    applyCity,
    applyNeighborhood,
    applyCondominium,
    lookupCep,
    isCepLoading,
    newCityName,
    setNewCityName,
    newCityUf,
    setNewCityUf,
    newNeighborhoodName,
    setNewNeighborhoodName,
    newCondominiumName,
    setNewCondominiumName,
    newCondominiumFee,
    setNewCondominiumFee,
    newCondominiumPhoto,
    setNewCondominiumPhoto,
    newCondominiumHasConcierge,
    setNewCondominiumHasConcierge,
    newCondominiumConciergeType,
    setNewCondominiumConciergeType,
    showAddCity,
    setShowAddCity,
    showAddNeighborhood,
    setShowAddNeighborhood,
    showAddCondominium,
    setShowAddCondominium,
    handleCreateCity,
    handleCreateNeighborhood,
    handleCreateCondominium,
    createCity,
    createNeighborhood,
    createCondominium
  } = usePropertyFormSections();
  const showManagerOnlyFields = !isEditing || canManagePropertyCatalogs;

  return (
  <TabsContent value="location">
    <Card data-tour="property-location-section" className="app-card">
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Localização do Imóvel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,.9fr)_minmax(240px,1fr)_140px]">
          <div className="space-y-2">
            <Label htmlFor="property-address-visibility">
              Endereço no site público <RequiredMark />
            </Label>
            <Select
              value={formData.public_address_visibility}
              onValueChange={(v) =>
                set("public_address_visibility", v)
              }
            >
              <SelectTrigger id="property-address-visibility">
                <SelectValue placeholder="Visibilidade do endereço" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completo">
                  Completo - rua, número, bairro, cidade, UF e CEP
                </SelectItem>
                <SelectItem value="parcial">
                  Parcial - bairro, cidade e UF
                </SelectItem>
                <SelectItem value="minimo">
                  Mínimo - cidade e UF
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-cep">CEP</Label>
            <div className="relative">
              <Input
                id="property-cep"
                aria-describedby={isCepLoading ? "property-cep-status" : undefined}
                value={formData.cep}
                onChange={(e) => {
                  const digits = onlyCepDigits(e.target.value);
                  const formatted = formatCep(digits);
                  set("cep", formatted);
                  void lookupCep(digits);
                }}
                onBlur={() => void lookupCep(formData.cep)}
                placeholder="00000-000"
                className="pr-9"
              />
              {isCepLoading && (
                <span
                  id="property-cep-status"
                  role="status"
                  aria-live="polite"
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="sr-only">Buscando CEP</span>
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-country">País</Label>
            <Input
              id="property-country"
              value={formData.pais}
              onChange={(e) => set("pais", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[84px_minmax(230px,1.2fr)_minmax(220px,1.1fr)_minmax(220px,1.15fr)]">
          <div className="space-y-2">
            <Label htmlFor="property-state">UF</Label>
            <Input
              id="property-state"
              maxLength={2}
              value={formData.uf}
              onChange={(e) =>
                set("uf", e.target.value.toUpperCase())
              }
              placeholder="SP"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-city-selector">Cidade</Label>
              {canManagePropertyCatalogs && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                  onClick={() => {
                    setNewCityName(formData.cidade);
                    setNewCityUf(formData.uf);
                    setShowAddCity((open) => !open);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" /> Nova
                </Button>
              )}
            </div>
            <div
              className={
                !formData.city_id
                  ? "grid grid-cols-[92px_minmax(0,1fr)] gap-2"
                  : "grid grid-cols-1 gap-2"
              }
            >
              <Select
                value={formData.city_id || "__manual__"}
                onValueChange={(value) => {
                  if (value === "__manual__") {
                    set("city_id", "");
                    return;
                  }
                  applyCity(
                    cities.find((city) => city.id === value) || null,
                  );
                }}
              >
                <SelectTrigger id="property-city-selector">
                  <span className="truncate">
                    {formData.city_id
                      ? `${selectedCity?.name || formData.cidade}${selectedCity?.uf ? ` (${selectedCity.uf})` : ""}`
                      : "Manual"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__manual__">Manual</SelectItem>
                  {cities.map((city) => (
                    <SelectItem key={city.id} value={city.id}>
                      {city.name}
                      {city.uf ? ` (${city.uf})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!formData.city_id && (
                <Input
                  id="property-city-manual"
                  aria-label="Cidade informada manualmente"
                  value={formData.cidade}
                  onChange={(e) => set("cidade", e.target.value)}
                  placeholder="Digite a cidade"
                />
              )}
            </div>
            {canManagePropertyCatalogs && showAddCity && (
              <div className="grid grid-cols-[minmax(0,1fr)_64px_auto] gap-2">
                <Input
                  id="property-new-city-name"
                  aria-label="Nome da nova cidade"
                  value={newCityName}
                  onChange={(e) => setNewCityName(e.target.value)}
                  placeholder="Nova cidade"
                  className="h-8 text-sm"
                />
                <Input
                  id="property-new-city-state"
                  aria-label="UF da nova cidade"
                  value={newCityUf}
                  onChange={(e) =>
                    setNewCityUf(e.target.value.toUpperCase())
                  }
                  placeholder="UF"
                  maxLength={2}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={handleCreateCity}
                  disabled={createCity.isPending}
                >
                  OK
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-neighborhood-selector">Bairro</Label>
              {canManagePropertyCatalogs && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                  onClick={() => {
                    setNewNeighborhoodName(formData.bairro);
                    setShowAddNeighborhood((open) => !open);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" /> Novo
                </Button>
              )}
            </div>
            <div
              className={
                !formData.neighborhood_id
                  ? "grid grid-cols-[92px_minmax(0,1fr)] gap-2"
                  : "grid grid-cols-1 gap-2"
              }
            >
              <Select
                value={formData.neighborhood_id || "__manual__"}
                onValueChange={(value) => {
                  if (value === "__manual__") {
                    set("neighborhood_id", "");
                    return;
                  }
                  applyNeighborhood(
                    neighborhoods.find(
                      (neighborhood) => neighborhood.id === value,
                    ) || null,
                  );
                }}
              >
                <SelectTrigger id="property-neighborhood-selector">
                  <span className="truncate">
                    {formData.neighborhood_id
                      ? selectedNeighborhood?.name || formData.bairro
                      : "Manual"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__manual__">Manual</SelectItem>
                  {neighborhoods.map((neighborhood) => (
                    <SelectItem
                      key={neighborhood.id}
                      value={neighborhood.id}
                    >
                      {neighborhood.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!formData.neighborhood_id && (
                <Input
                  id="property-neighborhood-manual"
                  aria-label="Bairro informado manualmente"
                  value={formData.bairro}
                  onChange={(e) => set("bairro", e.target.value)}
                  placeholder="Digite o bairro"
                />
              )}
            </div>
            {canManagePropertyCatalogs && showAddNeighborhood && (
              <div className="flex gap-2">
                <Input
                  id="property-new-neighborhood-name"
                  aria-label="Nome do novo bairro"
                  value={newNeighborhoodName}
                  onChange={(e) =>
                    setNewNeighborhoodName(e.target.value)
                  }
                  placeholder="Novo bairro"
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={handleCreateNeighborhood}
                  disabled={createNeighborhood.isPending}
                >
                  OK
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-condominium-selector">Condomínio</Label>
              {canManagePropertyCatalogs && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                  onClick={() => setShowAddCondominium((open) => !open)}
                >
                  <Plus className="mr-1 h-3 w-3" /> Novo
                </Button>
              )}
            </div>
            <Select
              value={formData.condominium_id || "__none__"}
              onValueChange={(value) => {
                if (value === "__none__") {
                  applyCondominium(null);
                  return;
                }
                applyCondominium(
                  condominiums.find(
                    (condominium) => condominium.id === value,
                  ) || null,
                );
              }}
            >
              <SelectTrigger id="property-condominium-selector">
                <span className="truncate">
                  {formData.condominium_id
                    ? selectedCondominium?.name || "Condomínio"
                    : "Sem condomínio"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  Sem condomínio
                </SelectItem>
                {condominiums.map((condominium) => (
                  <SelectItem
                    key={condominium.id}
                    value={condominium.id}
                  >
                    {[
                      condominium.name,
                      condominium.neighborhood?.name,
                      condominium.city?.name,
                    ]
                      .filter(Boolean)
                      .join(" - ")}
                    {condominium.default_condominium_fee
                      ? ` - ${formatFixedBRLCurrency(Number(condominium.default_condominium_fee))}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_112px_minmax(220px,.55fr)]">
          <div className="space-y-2">
            <Label htmlFor="property-street">Logradouro</Label>
            <Input
              id="property-street"
              value={formData.endereco}
              onChange={(e) => set("endereco", e.target.value)}
              placeholder="Rua, Avenida..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-number">Número</Label>
            <Input
              id="property-number"
              value={formData.numero}
              onChange={(e) => set("numero", e.target.value)}
              placeholder="123"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-complement">Complemento</Label>
            <Input
              id="property-complement"
              value={formData.complemento}
              onChange={(e) => set("complemento", e.target.value)}
              placeholder="Apto, bloco..."
            />
          </div>
        </div>
        {showManagerOnlyFields && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="property-block">Quadra</Label>
              <Input
                id="property-block"
                value={formData.quadra}
                onChange={(e) => set("quadra", e.target.value)}
                placeholder="Ex: QD 12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-lot">Lote</Label>
              <Input
                id="property-lot"
                value={formData.lote}
                onChange={(e) => set("lote", e.target.value)}
                placeholder="Ex: LT 08"
              />
            </div>
          </div>
        )}
        {canManagePropertyCatalogs && showAddCondominium && (
          <div className="app-card-soft grid grid-cols-1 gap-3 border-0 p-3 md:grid-cols-[1.35fr_.85fr]">
            <div className="space-y-2">
              <Label htmlFor="property-new-condominium-name">Nome do condomínio</Label>
              <Input
                id="property-new-condominium-name"
                value={newCondominiumName}
                onChange={(e) =>
                  setNewCondominiumName(e.target.value)
                }
                placeholder="Residencial..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-new-condominium-fee">Taxa padrão (R$)</Label>
              <Input
                id="property-new-condominium-fee"
                value={formatCurrencyDisplay(newCondominiumFee)}
                onChange={(e) =>
                  setNewCondominiumFee(
                    parseCurrencyInput(e.target.value),
                  )
                }
                placeholder="800"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="property-new-condominium-photo">Foto do condomínio (URL)</Label>
              <Input
                id="property-new-condominium-photo"
                value={newCondominiumPhoto}
                onChange={(e) =>
                  setNewCondominiumPhoto(e.target.value)
                }
                placeholder="https://..."
              />
            </div>
            <div className={togglePanelClass}>
              <Label htmlFor="property-new-condominium-concierge">Tem portaria</Label>
              <Switch
                id="property-new-condominium-concierge"
                checked={newCondominiumHasConcierge}
                onCheckedChange={setNewCondominiumHasConcierge}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="property-new-condominium-concierge-type">Tipo de portaria</Label>
              <Select
                value={newCondominiumConciergeType || undefined}
                onValueChange={setNewCondominiumConciergeType}
              >
                <SelectTrigger id="property-new-condominium-concierge-type">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24h</SelectItem>
                  <SelectItem value="comercial">
                    Horário comercial
                  </SelectItem>
                  <SelectItem value="remota">Remota</SelectItem>
                  <SelectItem value="sem_portaria">
                    Sem portaria
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end md:col-span-2">
              <Button
                type="button"
                onClick={handleCreateCondominium}
                disabled={createCondominium.isPending}
              >
                {createCondominium.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Cadastrar condomínio
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  </TabsContent>
  );
}
