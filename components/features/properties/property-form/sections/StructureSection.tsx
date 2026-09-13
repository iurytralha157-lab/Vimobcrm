"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { Lock, Plus } from "lucide-react";
import { RequiredMark } from "../PropertyFormFields";
import { isSupportedDealType } from "../property-form-model";
import { usePropertyFormSections } from "../PropertyFormSectionsContext";

export function StructureSection() {
  const {
    formData,
    set,
    displayedPurposeOptions,
    displayedDealOptions,
    statusOptions,
    propertyTypes,
    newPurposeName,
    setNewPurposeName,
    newTypeName,
    setNewTypeName,
    showAddPurpose,
    setShowAddPurpose,
    showAddType,
    setShowAddType,
    handleAddPurpose,
    handleAddPropertyType,
    handleDealTypeChange,
    createPropertyType,
    isEditing,
    canManagePropertyCatalogs,
  } = usePropertyFormSections();
  const showManagerOnlyFields = !isEditing || canManagePropertyCatalogs;

  return (
  <TabsContent value="structure">
    <Card data-tour="property-structure-section" className="app-card">
      <CardHeader>
        <CardTitle className="text-[14px] font-normal">
          Estrutura
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="property-title">
            Título do Imóvel <RequiredMark />
          </Label>
          <Input
            id="property-title"
            value={formData.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Ex: Apartamento 3 quartos..."
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-purpose">Finalidade</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                onClick={() => setShowAddPurpose(!showAddPurpose)}
              >
                <Plus className="h-3 w-3 mr-1" /> Nova
              </Button>
            </div>
            {showAddPurpose && (
              <div className="flex gap-2 mb-2">
                <Input
                  id="property-new-purpose"
                  aria-label="Nova finalidade"
                  placeholder="Nova finalidade..."
                  value={newPurposeName}
                  onChange={(e) => setNewPurposeName(e.target.value)}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={handleAddPurpose}
                >
                  OK
                </Button>
              </div>
            )}
            <Select
              value={formData.finalidade}
              onValueChange={(v) => set("finalidade", v)}
            >
              <SelectTrigger id="property-purpose">
                <span className="truncate">
                  {formData.finalidade || "Selecione"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {displayedPurposeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isEditing ? (
                <span
                  id="property-type-label"
                  className="text-sm font-medium leading-none"
                >
                  Tipo de Imóvel <RequiredMark />
                </span>
              ) : (
                <Label htmlFor="property-type">
                  Tipo de Imóvel <RequiredMark />
                </Label>
              )}
              {!isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                  onClick={() => setShowAddType(!showAddType)}
                >
                  <Plus className="h-3 w-3 mr-1" /> Novo
                </Button>
              )}
            </div>
            {!isEditing && showAddType && (
              <div className="flex gap-2 mb-2">
                <Input
                  id="property-new-type"
                  aria-label="Novo tipo de imóvel"
                  placeholder="Novo tipo..."
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  onClick={handleAddPropertyType}
                  disabled={createPropertyType.isPending}
                >
                  OK
                </Button>
              </div>
            )}
            {isEditing ? (
              <div
                aria-labelledby="property-type-label"
                className="flex min-h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-sm text-muted-foreground"
              >
                <Lock className="h-4 w-4 shrink-0" />
                <span className="truncate font-medium text-foreground">
                  {formData.tipo_de_imovel || "Tipo não informado"}
                </span>
              </div>
            ) : (
              <Select
                value={formData.tipo_de_imovel}
                onValueChange={(v) => set("tipo_de_imovel", v)}
              >
                <SelectTrigger id="property-type">
                  <span className="truncate">
                    {formData.tipo_de_imovel || "Selecione"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {propertyTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="property-deal-type">
                Modalidade <RequiredMark />
              </Label>
            </div>
            <Select
              value={formData.tipo_de_negocio}
              onValueChange={handleDealTypeChange}
            >
              <SelectTrigger id="property-deal-type">
                <span className="truncate">
                  {formData.tipo_de_negocio || "Selecione"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {displayedDealOptions.filter(isSupportedDealType).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="property-status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(v) => set("status", v)}
            >
              <SelectTrigger id="property-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showManagerOnlyFields && (
            <div className="space-y-2">
              <Label htmlFor="property-alternative-reference">
                Referência Alternativa
              </Label>
              <Input
                id="property-alternative-reference"
                value={formData.referencia_alternativa}
                onChange={(e) =>
                  set("referencia_alternativa", e.target.value)
                }
                placeholder="Código externo..."
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  </TabsContent>
  );
}
