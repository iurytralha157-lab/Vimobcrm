"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { SearchableFilterSelect } from "@/components/shared/SearchableFilterSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { PropertyFilters } from "@/hooks/use-properties";
import type { PropertyCity, PropertyCondominium, PropertyNeighborhood } from "@/hooks/use-property-locations";
import type { User } from "@/hooks/use-users";
import { cn } from "@/lib/utils";
import { getUserFilterLabel } from "@/lib/user-display";

import { PropertyOwnerCombobox } from "../PropertyOwnerCombobox";
import type { PropertyCatalogPreset } from "./property-catalog-presets";

export const ALL_FILTER_VALUE = "__all__";

const TRIGGER_CLASS = "border-0 bg-[var(--app-surface-soft)]";
const COUNT_OPTIONS = ["1", "2", "3", "4", "5"];

type FilterKey = keyof PropertyFilters;
type UpdateFilter = (field: FilterKey, value: string) => void;

function FilterSelect({
  value,
  placeholder,
  label,
  ariaLabel,
  onValueChange,
  children,
}: {
  value: string | undefined;
  placeholder: boolean;
  label: string;
  ariaLabel?: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select value={value || ALL_FILTER_VALUE} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className={TRIGGER_CLASS}>
        <span className={cn("truncate", placeholder && "text-muted-foreground")}>{label}</span>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function BooleanFilter({
  field,
  filters,
  updateFilter,
  placeholder,
  yes,
  no,
}: {
  field: FilterKey;
  filters: PropertyFilters;
  updateFilter: UpdateFilter;
  placeholder: string;
  yes: string;
  no: string;
}) {
  const value = filters[field] as string | undefined;
  return (
    <FilterSelect
      value={value}
      placeholder={!value}
      label={value === "true" ? yes : value === "false" ? no : placeholder}
      ariaLabel={placeholder}
      onValueChange={(next) => updateFilter(field, next)}
    >
      <SelectItem value={ALL_FILTER_VALUE}>Indiferente</SelectItem>
      <SelectItem value="true">{yes}</SelectItem>
      <SelectItem value="false">{no}</SelectItem>
    </FilterSelect>
  );
}

function MinimumFilter({
  field,
  label,
  filters,
  updateFilter,
}: {
  field: FilterKey;
  label: string;
  filters: PropertyFilters;
  updateFilter: UpdateFilter;
}) {
  const value = filters[field] as string | undefined;
  return (
    <FilterSelect
      value={value}
      placeholder={!value}
      label={value ? `${value}+` : label}
      ariaLabel={label}
      onValueChange={(next) => updateFilter(field, next)}
    >
      <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
      {COUNT_OPTIONS.map((count) => <SelectItem key={count} value={count}>{count}+</SelectItem>)}
    </FilterSelect>
  );
}

function RangeInputs({
  minField,
  maxField,
  minLabel,
  maxLabel,
  minPlaceholder,
  maxPlaceholder,
  filters,
  errors,
  updateFilter,
}: {
  minField: FilterKey;
  maxField: FilterKey;
  minLabel: string;
  maxLabel: string;
  minPlaceholder: string;
  maxPlaceholder: string;
  filters: PropertyFilters;
  errors: Partial<Record<string, string>>;
  updateFilter: UpdateFilter;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {([[minField, minLabel, minPlaceholder], [maxField, maxLabel, maxPlaceholder]] as const).map(([field, label, placeholder]) => (
        <Input
          key={field}
          value={(filters[field] as string | undefined) || ""}
          aria-label={label}
          aria-invalid={Boolean(errors[field])}
          aria-describedby={errors[field] ? "property-filter-errors" : undefined}
          onChange={(event) => updateFilter(field, event.target.value)}
          inputMode="numeric"
          placeholder={placeholder}
          className={TRIGGER_CLASS}
        />
      ))}
    </div>
  );
}

function modalityLabel(value: string | undefined) {
  if (value === "rental_catalog") return "Locação e temporada";
  if (value === "Lançamento") return "Lançamento";
  if (value === "Aluguel") return "Locação";
  if (value === "Venda e Aluguel") return "Venda e locação";
  return value || "Modalidade";
}

const STATUS_LABELS: Record<string, string> = {
  available: "Disponível",
  reserved: "Reservado",
  sold: "Vendido",
  rented: "Alugado",
  inactive: "Inativo",
};

export function PropertyFiltersPanel({
  preset,
  filters,
  activeFilterCount,
  numericFilterErrors,
  statusFilterValue,
  siteVisibilityValue,
  propertyTypes,
  cities,
  selectedCityId,
  neighborhoods,
  selectedNeighborhoodId,
  hasSelectedCity,
  condominiums,
  users,
  isMobile,
  updateFilter,
  updateCityFilter,
  updateNeighborhoodFilter,
  updateStatusFilter,
  updateSiteVisibilityFilter,
  clearFilters,
  onClose,
}: {
  preset: PropertyCatalogPreset;
  filters: PropertyFilters;
  activeFilterCount: number;
  numericFilterErrors: Partial<Record<string, string>>;
  statusFilterValue: string;
  siteVisibilityValue: string;
  propertyTypes: string[];
  cities: PropertyCity[];
  selectedCityId: string | null;
  neighborhoods: PropertyNeighborhood[];
  selectedNeighborhoodId: string | null;
  hasSelectedCity: boolean;
  condominiums: PropertyCondominium[];
  users: User[];
  isMobile: boolean;
  updateFilter: UpdateFilter;
  updateCityFilter: (value: string) => void;
  updateNeighborhoodFilter: (value: string) => void;
  updateStatusFilter: (value: string) => void;
  updateSiteVisibilityFilter: (value: string) => void;
  clearFilters: () => void;
  onClose: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedOwnerLabel, setSelectedOwnerLabel] = useState("");
  const shared = { filters, updateFilter };

  return (
    <aside
      data-tour="properties-filters-panel"
      aria-label="Filtros dos imóveis"
      className="properties-filter-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-0 shadow-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[14px] font-normal">
          <SlidersHorizontal className="h-4 w-4 text-[var(--app-text-secondary)]" aria-hidden="true" />
          Filtros
          {activeFilterCount > 0 && (
            <span className="rounded-[4px] bg-primary/10 px-1.5 py-0.5 text-[11px] font-light text-primary">{activeFilterCount}</span>
          )}
        </h2>
        {activeFilterCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setSelectedOwnerLabel(""); clearFilters(); }}
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            Limpar
          </Button>
        )}
      </div>

      <div className="app-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {Object.keys(numericFilterErrors).length > 0 && (
          <div id="property-filter-errors" role="alert" className="rounded-[6px] bg-destructive/10 p-2 text-[12px] text-destructive">
            {Object.values(numericFilterErrors).map((message) => <p key={message}>{message}</p>)}
            <p>Corrija os valores para atualizar os resultados.</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3">
          <div data-tour="properties-filter-modality">
            <FilterSelect
              value={filters.tipo_de_negocio}
              placeholder={!filters.tipo_de_negocio}
              label={modalityLabel(filters.tipo_de_negocio)}
              onValueChange={(value) => updateFilter("tipo_de_negocio", value)}
            >
              {preset === "rentals" ? (
                <>
                  <SelectItem value="rental_catalog">Locação e temporada</SelectItem>
                  <SelectItem value="Aluguel">Locação</SelectItem>
                  <SelectItem value="Temporada">Temporada</SelectItem>
                </>
              ) : preset === "launches" ? (
                <SelectItem value="Lançamento">Lançamento</SelectItem>
              ) : (
                <>
                  <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
                  <SelectItem value="Venda">Venda</SelectItem>
                  <SelectItem value="Aluguel">Locação</SelectItem>
                  <SelectItem value="Venda e Aluguel">Venda e locação</SelectItem>
                  <SelectItem value="Temporada">Temporada</SelectItem>
                  {preset !== "ready" && <SelectItem value="Lançamento">Lançamento</SelectItem>}
                </>
              )}
            </FilterSelect>
          </div>

          <div data-tour="properties-filter-availability">
            <FilterSelect
              value={statusFilterValue}
              placeholder={statusFilterValue === ALL_FILTER_VALUE}
              label={STATUS_LABELS[statusFilterValue] ?? "Status comercial"}
              ariaLabel="Filtrar por status comercial"
              onValueChange={updateStatusFilter}
            >
              <SelectItem value={ALL_FILTER_VALUE}>Todos os status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </FilterSelect>
          </div>

          <div data-tour="properties-filter-site-publication">
            <FilterSelect
              value={siteVisibilityValue}
              placeholder={siteVisibilityValue === ALL_FILTER_VALUE}
              label={siteVisibilityValue === "published" ? "No site" : siteVisibilityValue === "unpublished" ? "Fora do site" : "Publicação no site"}
              ariaLabel="Filtrar por publicação no site"
              onValueChange={updateSiteVisibilityFilter}
            >
              <SelectItem value={ALL_FILTER_VALUE}>Todos</SelectItem>
              <SelectItem value="published">No site</SelectItem>
              <SelectItem value="unpublished">Fora do site</SelectItem>
            </FilterSelect>
          </div>

          <div data-tour="properties-filter-type">
            <SearchableFilterSelect value={filters.tipo_de_imovel || null} onChange={(value) => updateFilter("tipo_de_imovel", value || ALL_FILTER_VALUE)} options={propertyTypes.map((type) => ({ value: type, label: type }))} allLabel="Todos os tipos" ariaLabel="Tipo de imóvel" />
          </div>

          <div data-tour="properties-filter-location" className="grid grid-cols-2 gap-2">
            <SearchableFilterSelect value={selectedCityId} onChange={(value) => updateCityFilter(value || ALL_FILTER_VALUE)} options={cities.map((city) => ({ value: city.id, label: `${city.name}${city.uf ? ` (${city.uf})` : ""}` }))} allLabel="Todas as cidades" ariaLabel="Cidade" />
            <SearchableFilterSelect value={selectedNeighborhoodId} onChange={(value) => updateNeighborhoodFilter(value || ALL_FILTER_VALUE)} options={neighborhoods.map((item) => ({ value: item.id, label: hasSelectedCity ? item.name : [item.name, item.city?.name, item.city?.uf].filter(Boolean).join(", ") }))} allLabel="Todos os bairros" ariaLabel="Bairro" />
          </div>

          <div data-tour="properties-filter-responsible">
            <SearchableFilterSelect value={filters.responsavel_id || null} onChange={(value) => updateFilter("responsavel_id", value || ALL_FILTER_VALUE)} options={users.map((user) => ({ value: user.id, label: getUserFilterLabel(user) }))} allLabel="Todos os responsáveis" ariaLabel="Responsável" />
          </div>

          <div data-tour="properties-filter-value">
            <RangeInputs {...shared} errors={numericFilterErrors} minField="valor_min" maxField="valor_max" minLabel="Valor mínimo" maxLabel="Valor máximo" minPlaceholder="Valor mín." maxPlaceholder="Valor máx." />
          </div>
        </div>

        <button
          data-tour="properties-filter-more"
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex h-10 w-full items-center justify-between rounded-md bg-[var(--app-surface-soft)] px-3 text-sm font-medium transition-colors hover:bg-[var(--app-surface-hover)]"
        >
          Mais filtros
          <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} aria-hidden="true" />
        </button>

        {advancedOpen && (
          <div data-tour="properties-filter-more-panel" className="space-y-3">
            <PropertyOwnerCombobox
              value={filters.owner_id}
              selectedLabel={selectedOwnerLabel || "Proprietário"}
              ariaLabel="Filtrar por proprietário"
              onSelect={(owner) => {
                setSelectedOwnerLabel(owner?.name || "");
                updateFilter("owner_id", owner?.id || ALL_FILTER_VALUE);
              }}
            />
            <SearchableFilterSelect value={filters.condominium_id || null} onChange={(value) => updateFilter("condominium_id", value || ALL_FILTER_VALUE)} options={condominiums.map((item) => ({ value: item.id, label: item.name }))} allLabel="Todos os condomínios" ariaLabel="Condomínio" />
            <FilterSelect value={filters.mobilia} placeholder={!filters.mobilia} label={filters.mobilia || "Mobília"} onValueChange={(value) => updateFilter("mobilia", value)}>
              <SelectItem value={ALL_FILTER_VALUE}>Todas</SelectItem>
              <SelectItem value="Mobiliado">Mobiliado</SelectItem>
              <SelectItem value="Semi-mobiliado">Semi-mobiliado</SelectItem>
              <SelectItem value="Sem mobília">Sem mobília</SelectItem>
            </FilterSelect>
            <div className="grid grid-cols-2 gap-2">
              <MinimumFilter {...shared} field="quartos_min" label="Quartos" />
              <MinimumFilter {...shared} field="suites_min" label="Suítes" />
              <MinimumFilter {...shared} field="banheiros_min" label="Banheiros" />
              <MinimumFilter {...shared} field="vagas_min" label="Vagas" />
            </div>
            <RangeInputs {...shared} errors={numericFilterErrors} minField="area_util_min" maxField="area_util_max" minLabel="Área útil mínima" maxLabel="Área útil máxima" minPlaceholder="Área útil mín." maxPlaceholder="Área útil máx." />
            <RangeInputs {...shared} errors={numericFilterErrors} minField="area_total_min" maxField="area_total_max" minLabel="Área total mínima" maxLabel="Área total máxima" minPlaceholder="Área total mín." maxPlaceholder="Área total máx." />
            <BooleanFilter {...shared} field="aceita_financiamento" placeholder="Financiamento" yes="Aceita financiamento" no="Não aceita financiamento" />
            <BooleanFilter {...shared} field="aceita_permuta" placeholder="Permuta" yes="Aceita permuta" no="Não aceita permuta" />
            <BooleanFilter {...shared} field="exclusividade" placeholder="Exclusividade" yes="Com exclusividade" no="Sem exclusividade" />
            <BooleanFilter {...shared} field="placa_no_local" placeholder="Placa no local" yes="Com placa" no="Sem placa" />
            <BooleanFilter {...shared} field="destaque" placeholder="Destaque" yes="Em destaque" no="Sem destaque" />
          </div>
        )}

        {isMobile && (
          <Button
            type="button"
            className="h-10 w-full rounded-[6px] bg-primary text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90"
            onClick={onClose}
          >
            Ver imóveis
          </Button>
        )}
      </div>
    </aside>
  );
}
