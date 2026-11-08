"use client";

import { KpiCard, KpiRow } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import type { PropertyCity, PropertyCondominium, PropertyNeighborhood } from "@/hooks/use-property-locations";
import type { PropertyOwner } from "@/hooks/use-property-owners";
import { formatWholePtBRCurrency } from "@/lib/utils/formatting";

import { getOwnerContact, getOwnerPropertyCount, isLegacyCatalogValue, type PropertyLocationsTab } from "./model";

/** Only what the catalog endpoints return. Owner figures cover the rows already loaded. */
export function LocationsKpis({
  tab,
  cities,
  neighborhoods,
  condominiums,
  owners,
  ownerTotalCount,
  canSeeOwnerContact,
}: {
  tab: PropertyLocationsTab;
  cities: PropertyCity[];
  neighborhoods: PropertyNeighborhood[];
  condominiums: PropertyCondominium[];
  owners: PropertyOwner[];
  ownerTotalCount: number;
  canSeeOwnerContact: boolean;
}) {
  if (tab === "condominiums") {
    const withFee = condominiums.filter((item) => item.default_condominium_fee);
    const average = withFee.length
      ? withFee.reduce((sum, item) => sum + Number(item.default_condominium_fee), 0) / withFee.length
      : null;
    const withConcierge = condominiums.filter((item) => item.has_concierge).length;
    const missing = condominiums.filter((item) => !isLegacyCatalogValue(item) && (!item.default_condominium_fee || item.has_concierge == null)).length;
    return (
      <KpiRow>
        <KpiCard label="Condomínios" value={formatCount(condominiums.length)} />
        <KpiCard label="Taxa média" value={average === null ? "—" : formatWholePtBRCurrency(average)} note="Dos que têm taxa informada" />
        <KpiCard label="Com portaria" value={formatCount(withConcierge)} />
        <KpiCard label="Cadastro incompleto" value={formatCount(missing)} note="Sem taxa ou portaria" />
      </KpiRow>
    );
  }
  if (tab === "owners") {
    const linked = owners.filter((owner) => getOwnerPropertyCount(owner) > 0).length;
    const several = owners.filter((owner) => getOwnerPropertyCount(owner) > 1).length;
    const noContact = owners.filter((owner) => !getOwnerContact(owner) && !owner.email).length;
    const scope = owners.length < ownerTotalCount ? `Entre os ${formatCount(owners.length)} carregados` : undefined;
    return (
      <KpiRow>
        <KpiCard label="Proprietários" value={formatCount(ownerTotalCount)} />
        <KpiCard label="Com imóvel vinculado" value={formatCount(linked)} note={scope} />
        <KpiCard label="Com mais de um imóvel" value={formatCount(several)} note={scope} />
        {canSeeOwnerContact
          ? <KpiCard label="Sem contato" value={formatCount(noContact)} note={scope ?? "Celular, telefone ou e-mail"} />
          : <KpiCard label="Contato" value="Oculto" note="Pela organização" />}
      </KpiRow>
    );
  }
  const legacy = [...cities, ...neighborhoods].filter(isLegacyCatalogValue).length;
  const withoutCity = neighborhoods.filter((item) => !isLegacyCatalogValue(item) && !item.city_id).length;
  return (
    <KpiRow>
      <KpiCard label="Cidades" value={formatCount(cities.length)} />
      <KpiCard label="Bairros" value={formatCount(neighborhoods.length)} />
      <KpiCard label="Vindos dos imóveis" value={formatCount(legacy)} note="Somente leitura" />
      <KpiCard label="Bairros sem cidade" value={formatCount(withoutCity)} note="Corrigir no cadastro" />
    </KpiRow>
  );
}
