"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput, RequiredMark, togglePanelClass } from "../PropertyFormFields";
import { RENT_ADJUSTMENT_INDEXES } from "../property-form-model";
import {
  getPropertyChargeFieldAccess,
  getPropertyFinancingModeAccess,
} from "../property-form-field-access";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function ValuesSection() {
  const {
    formData,
    set,
    isSale,
    isRental,
    supportsRentalContractTerms,
    supportsSaleTerms,
    primaryValuesGridClass,
    selectedCondominium,
    isEditing,
    canManagePropertyCatalogs,
  } = usePropertyFormSections();
  const showManagerOnlyFields = !isEditing || canManagePropertyCatalogs;
  const condominiumAccess = getPropertyChargeFieldAccess({
    isExempt: formData.condominio_isento,
    canManageMetadata: showManagerOnlyFields,
  });
  const propertyTaxAccess = getPropertyChargeFieldAccess({
    isExempt: formData.iptu_isento,
    canManageMetadata: showManagerOnlyFields,
  });
  const financingModeAccess = getPropertyFinancingModeAccess({
    financingMode: formData.financing_mode,
    canManageMetadata: showManagerOnlyFields,
  });

  return (
  <TabsContent value="values">
    <Card data-tour="property-values-section" className="app-card">
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Valores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={primaryValuesGridClass}>
          {isSale && (
            <div className="space-y-2">
              <Label htmlFor="property-sale-price">
                Preço de venda (R$) <RequiredMark />
              </Label>
              <CurrencyInput
                id="property-sale-price"
                value={formData.preco}
                onValueChange={(value) => set("preco", value)}
                className="text-[14px] font-normal"
              />
            </div>
          )}
          {isRental && (
            <div className="space-y-2">
              <Label htmlFor="property-rental-price">
                Valor de locação (R$) <RequiredMark />
              </Label>
              <CurrencyInput
                id="property-rental-price"
                value={formData.valor_locacao}
                onValueChange={(value) => set("valor_locacao", value)}
                className="text-[14px] font-normal"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="property-condominium-fee">Condomínio (R$)</Label>
            <div
              className={
                showManagerOnlyFields
                  ? "grid grid-cols-[minmax(0,1fr)_78px] gap-2"
                  : undefined
              }
            >
              <CurrencyInput
                id="property-condominium-fee"
                value={formData.condominio}
                onValueChange={(value) => set("condominio", value)}
                disabled={condominiumAccess.amountDisabled}
              />
              {condominiumAccess.showExemptionControl && (
                <label className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-1 text-xs text-muted-foreground">
                  <Switch
                    id="property-condominium-exempt"
                    aria-label="Condomínio isento"
                    checked={formData.condominio_isento}
                    onCheckedChange={(v) => set("condominio_isento", v)}
                  />
                  Isento
                </label>
              )}
            </div>
            {selectedCondominium?.default_condominium_fee && (
              <p className="text-xs text-muted-foreground">
                Preenchido pelo condomínio selecionado.
              </p>
            )}
            {condominiumAccess.showManagedExemptionNotice && (
              <p className="text-xs text-muted-foreground">
                Marcado como isento pela gestão.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-property-tax">IPTU (R$)</Label>
            <div
              className={
                showManagerOnlyFields
                  ? "grid grid-cols-[minmax(0,1fr)_78px] gap-2"
                  : undefined
              }
            >
              <CurrencyInput
                id="property-property-tax"
                value={formData.iptu}
                onValueChange={(value) => set("iptu", value)}
                disabled={propertyTaxAccess.amountDisabled}
              />
              {propertyTaxAccess.showExemptionControl && (
                <label className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-1 text-xs text-muted-foreground">
                  <Switch
                    id="property-property-tax-exempt"
                    aria-label="IPTU isento"
                    checked={formData.iptu_isento}
                    onCheckedChange={(v) => set("iptu_isento", v)}
                  />
                  Isento
                </label>
              )}
            </div>
            {propertyTaxAccess.showManagedExemptionNotice && (
              <p className="text-xs text-muted-foreground">
                Marcado como isento pela gestão.
              </p>
            )}
          </div>
          {showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-tax-period">Período do IPTU</Label>
              <Select
                value={formData.iptu_period || "mensal"}
                onValueChange={(v) => set("iptu_period", v)}
              >
                <SelectTrigger id="property-tax-period">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                  <SelectItem value="parcelado">Parcelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="property-rural-tax">ITR rural (R$)</Label>
            <CurrencyInput
              id="property-rural-tax"
              value={formData.valor_itr}
              onValueChange={(value) => set("valor_itr", value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-fire-insurance">Seguro incêndio (R$)</Label>
            <CurrencyInput
              id="property-fire-insurance"
              value={formData.seguro_incendio}
              onValueChange={(value) => set("seguro_incendio", value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="property-service-fee">Taxa de limpeza/serviço (R$)</Label>
            <CurrencyInput
              id="property-service-fee"
              value={formData.taxa_de_servico}
              onValueChange={(value) => set("taxa_de_servico", value)}
            />
          </div>
          {isSale && showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-appraised-sale-price">Valor venda avaliado (R$)</Label>
              <CurrencyInput
                id="property-appraised-sale-price"
                value={formData.valor_venda_avaliado}
                onValueChange={(value) =>
                  set("valor_venda_avaliado", value)
                }
              />
            </div>
          )}
          {isRental && showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-appraised-rental-price">Valor locação avaliado (R$)</Label>
              <CurrencyInput
                id="property-appraised-rental-price"
                value={formData.valor_locacao_avaliado}
                onValueChange={(value) =>
                  set("valor_locacao_avaliado", value)
                }
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {supportsRentalContractTerms && showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-rental-guarantee">Seguro fiança (R$)</Label>
              <CurrencyInput
                id="property-rental-guarantee"
                value={formData.valor_seguro_fianca}
                onValueChange={(value) =>
                  set("valor_seguro_fianca", value)
                }
              />
            </div>
          )}
          {supportsRentalContractTerms && showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-rent-adjustment-index">Índice de reajuste</Label>
              <Select
                value={formData.rent_adjustment_index || "none"}
                onValueChange={(v) =>
                  set("rent_adjustment_index", v === "none" ? "" : v)
                }
              >
                <SelectTrigger id="property-rent-adjustment-index">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não informado</SelectItem>
                  {RENT_ADJUSTMENT_INDEXES.map((index) => (
                    <SelectItem key={index} value={index}>
                      {index}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {supportsSaleTerms && (
          <div className="app-card-soft border-0 p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,.75fr)_minmax(180px,.55fr)_minmax(180px,.55fr)]">
              <div className="space-y-2">
                <Label htmlFor="property-financing-mode">Financiável</Label>
                <Select
                  value={
                    formData.financing_mode ||
                    (formData.aceita_financiamento ? "sim" : "nao")
                  }
                  onValueChange={(v) => {
                    set("financing_mode", v);
                    set("aceita_financiamento", v !== "nao");
                  }}
                  disabled={financingModeAccess.selectDisabled}
                >
                  <SelectTrigger id="property-financing-mode">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sim">Sim</SelectItem>
                    <SelectItem value="nao">Não</SelectItem>
                    {financingModeAccess.showMcmvOption && (
                      <SelectItem value="mcmv">
                        Minha Casa Minha Vida
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {financingModeAccess.showManagedModeNotice && (
                  <p className="text-xs text-muted-foreground">
                    Modalidade MCMV definida pela gestão.
                  </p>
                )}
              </div>
              <div className={togglePanelClass}>
                <Label htmlFor="property-used-fgts">Usou FGTS nos últimos 3 anos?</Label>
                <Switch
                  id="property-used-fgts"
                  checked={formData.usou_fgts}
                  onCheckedChange={(v) => set("usou_fgts", v)}
                />
              </div>
              <div className={togglePanelClass}>
                <Label htmlFor="property-accepts-exchange">Aceita permuta</Label>
                <Switch
                  id="property-accepts-exchange"
                  checked={formData.aceita_permuta}
                  onCheckedChange={(v) => set("aceita_permuta", v)}
                />
              </div>
            </div>

            {showManagerOnlyFields &&
              (formData.financing_mode !== "nao" ||
                formData.aceita_permuta) && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {formData.financing_mode !== "nao" && (
                  <div className="space-y-2">
                    <Label htmlFor="property-financing-details">Detalhes do financiamento</Label>
                    <Textarea
                      id="property-financing-details"
                      value={formData.financing_details}
                      onChange={(e) =>
                        set("financing_details", e.target.value)
                      }
                      placeholder="Ex: aceita carta de crédito, bancos preferenciais, MCMV, restrições..."
                      rows={3}
                    />
                  </div>
                )}
                {formData.aceita_permuta && (
                  <div className="space-y-2">
                    <Label htmlFor="property-exchange-details">Recebe como permuta</Label>
                    <Textarea
                      id="property-exchange-details"
                      value={formData.exchange_details}
                      onChange={(e) =>
                        set("exchange_details", e.target.value)
                      }
                      placeholder="Ex: aceita imóvel menor, veículo, lote, região de interesse..."
                      rows={3}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  </TabsContent>
  );
}
