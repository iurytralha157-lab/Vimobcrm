import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  canAssignProperties,
  canDeleteProperties,
  canEditPropertyDetails,
  canManageProperties,
  canUpdatePropertyAvailability,
  canViewPropertyOwnerContacts,
  isPropertyEditAccessReady,
} from "./properties";

const member = {
  userId: "user-1",
  organizationId: "org-1",
  memberRole: "user",
  permissions: ["property_view"],
};

test("property_view nunca exibe controles de alteracao", () => {
  assert.equal(canManageProperties(member), false);
  assert.equal(canAssignProperties(member), false);
  assert.equal(canDeleteProperties(member), false);
  assert.equal(
    canEditPropertyDetails({ ...member, ownerIds: ["user-1"] }),
    false,
  );
  assert.equal(canUpdatePropertyAvailability(member), false);
});

test("property_manage libera todas as operacoes do catalogo", () => {
  const manager = {
    ...member,
    permissions: ["property_view", "property_manage"],
  };

  assert.equal(canManageProperties(manager), true);
  assert.equal(canAssignProperties(manager), true);
  assert.equal(canDeleteProperties(manager), true);
  assert.equal(canEditPropertyDetails(manager), true);
  assert.equal(canUpdatePropertyAvailability(manager), true);
});

test("papel manager nao ignora uma permissao efetiva negada", () => {
  assert.equal(
    canManageProperties({ ...member, memberRole: "manager" }),
    false,
  );
});

const readWorkspaceFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n?/g, "\n");

test("navegacao segmentada de imoveis cobre as sete rotas e destaca a rota ativa", () => {
  const source = readWorkspaceFile(
    "components/features/properties/PropertySectionTabs.tsx",
  );

  for (const href of [
    "/properties",
    "/properties/launches",
    "/properties/rentals",
    "/properties/condominiums",
    "/properties/locations",
    "/properties/owners",
    "/properties/settings",
  ]) {
    assert.ok(source.includes(`href: "${href}"`), `rota ausente: ${href}`);
  }

  assert.ok(source.includes("data-responsive-tab-scroll"));
  assert.ok(
    source.includes("data-[state=active]:bg-[var(--app-surface-solid)]"),
  );
  assert.ok(source.includes("aria-current="));
  assert.ok(source.includes('hasPermission("property_manage")'));
  assert.ok(source.includes('hasPermission("settings_organization")'));
  assert.equal((source.match(/manageOnly: true/g) ?? []).length, 3);
  assert.ok(source.includes('permission: "settings_organization"'));
  assert.ok(source.includes("? canConfigureProperties"));
  assert.ok(source.includes('value: "settings"'));
});

test("politica de edicao libera todos ou somente responsaveis e gestores", () => {
  assert.equal(
    canEditPropertyDetails({
      ...member,
      propertyEditPolicy: "everyone",
      ownerIds: ["another-user"],
    }),
    true,
  );
  assert.equal(
    canEditPropertyDetails({
      ...member,
      propertyEditPolicy: "responsible_or_admin",
      ownerIds: ["user-1"],
    }),
    true,
  );
  assert.equal(
    canEditPropertyDetails({
      ...member,
      propertyEditPolicy: "responsible_or_admin",
      ownerIds: ["another-user"],
    }),
    false,
  );
  assert.equal(
    canEditPropertyDetails({
      ...member,
      permissions: [],
      propertyEditPolicy: "everyone",
    }),
    false,
  );
  assert.equal(
    canEditPropertyDetails({
      ...member,
      memberRole: "manager",
      permissions: [],
      propertyEditPolicy: "responsible_or_admin",
    }),
    true,
  );
});

test("edicao aguarda policy e contextos da organizacao ativa antes de autorizar", () => {
  const readyContext = {
    isEditing: true,
    propertyOrganizationId: "org-1",
    activeOrganizationId: "org-1",
    loadedOrganizationId: "org-1",
    tenantOrganizationId: "org-1",
    propertyEditPolicy: "everyone",
  };

  assert.equal(isPropertyEditAccessReady(readyContext), true);
  assert.equal(
    isPropertyEditAccessReady({ ...readyContext, propertyEditPolicy: null }),
    false,
  );
  assert.equal(
    isPropertyEditAccessReady({ ...readyContext, loadedOrganizationId: "org-antiga" }),
    false,
  );
  assert.equal(
    isPropertyEditAccessReady({ ...readyContext, tenantOrganizationId: null }),
    false,
  );
  assert.equal(
    isPropertyEditAccessReady({ ...readyContext, isEditing: false }),
    true,
  );
});

test("contatos do proprietario seguem privacidade sem reduzir acesso de gestores", () => {
  assert.equal(
    canViewPropertyOwnerContacts({
      ...member,
      propertyOwnerContactVisibility: "hidden",
    }),
    false,
  );
  assert.equal(
    canViewPropertyOwnerContacts({
      ...member,
      propertyOwnerContactVisibility: "visible",
    }),
    true,
  );
  assert.equal(
    canViewPropertyOwnerContacts({
      ...member,
      permissions: ["property_manage"],
      propertyOwnerContactVisibility: "hidden",
    }),
    true,
  );
});

test("tela de proprietarios usa a permissao efetiva para exibir contatos", () => {
  const source = readWorkspaceFile(
    "components/features/properties/PropertyLocationsScreen.tsx",
  );

  assert.ok(source.includes("canViewPropertyOwnerContacts({"));
  assert.ok(source.includes("permissions: tenantContext?.permissions"));
  assert.ok(
    source.includes(
      "propertyOwnerContactVisibility:\n      organization?.property_owner_contact_visibility",
    ),
  );
  assert.equal(source.includes("userOrganizations.find("), false);
});

test("catalogo e formulario aplicam policy e privacidade antes do PATCH", () => {
  const catalogSource = readWorkspaceFile(
    "components/features/properties/PropertiesScreen.tsx",
  );
  const formSource = readWorkspaceFile(
    "components/features/properties/PropertyFormScreen.tsx",
  );
  const ownerSectionSource = readWorkspaceFile(
    "components/features/properties/property-form/sections/OwnerSection.tsx",
  );
  const editRouteSource = readWorkspaceFile(
    "app/(protected)/properties/[id]/edit/page.tsx",
  );

  assert.ok(catalogSource.includes("propertyEditPolicy"));
  assert.ok(formSource.includes("organization?.property_edit_policy"));
  assert.ok(formSource.includes("canViewPropertyOwnerContacts"));
  assert.ok(formSource.includes("canEditOwnerDetails"));
  assert.ok(ownerSectionSource.includes("disabled={!canEditOwnerDetails}"));
  assert.ok(editRouteSource.includes("anyOf="));
  assert.ok(editRouteSource.includes('"property_view"'));
  assert.ok(editRouteSource.includes('"property_manage"'));
  assert.equal(editRouteSource.includes('permission="property_manage"'), false);
});

test("formulario decide acesso somente com policy ativa e nao grava localidades sinteticas", () => {
  const formSource = readWorkspaceFile(
    "components/features/properties/PropertyFormScreen.tsx",
  );

  assert.ok(formSource.includes("isPropertyEditAccessReady({"));
  assert.ok(formSource.includes("isPropertyAccessReady &&"));
  assert.ok(formSource.includes("if (isEditing && !isPropertyAccessReady)"));
  assert.ok(formSource.includes("cities: catalogCities"));
  assert.ok(formSource.includes("neighborhoods: catalogNeighborhoods"));
  assert.ok(
    formSource.includes(
      "city_id: catalogLocationIdForMutation(cities, formData.city_id)",
    ),
  );
  assert.ok(
    /neighborhood_id:\s*catalogLocationIdForMutation\(\s*neighborhoods,\s*formData\.neighborhood_id,?\s*\)/.test(
      formSource,
    ),
  );
});

test("consulta de CEP aplica latest-request-wins e cancela resposta obsoleta", () => {
  const formSource = readWorkspaceFile(
    "components/features/properties/PropertyFormScreen.tsx",
  );
  const locationSource = readWorkspaceFile(
    "components/features/properties/property-form/sections/LocationSection.tsx",
  );

  for (const marker of [
    "cepLookupAbortRef.current?.abort()",
    "const controller = new AbortController()",
    "signal: controller.signal",
    "requestSequence !== cepLookupSequenceRef.current",
  ]) {
    assert.ok(formSource.includes(marker), `guarda de CEP ausente: ${marker}`);
  }
  assert.ok(locationSource.includes("void lookupCep(digits);"));
  assert.equal(locationSource.includes("if (digits.length === 8)"), false);
});

test("editor liberado por policy nao recebe mutacoes exclusivas de property_manage", () => {
  const catalogSource = readWorkspaceFile(
    "components/features/properties/PropertiesScreen.tsx",
  );
  const formSource = readWorkspaceFile(
    "components/features/properties/PropertyFormScreen.tsx",
  );
  const contextSource = readWorkspaceFile(
    "components/features/properties/property-form/PropertyFormSectionsContext.tsx",
  );
  const ownerSource = readWorkspaceFile(
    "components/features/properties/property-form/sections/OwnerSection.tsx",
  );
  const locationSource = readWorkspaceFile(
    "components/features/properties/property-form/sections/LocationSection.tsx",
  );
  const extrasSource = readWorkspaceFile(
    "components/features/properties/property-form/sections/ExtrasSection.tsx",
  );
  const mediaSource = readWorkspaceFile(
    "components/features/properties/property-form/sections/MediaSection.tsx",
  );

  assert.ok(formSource.includes("canManageProperties(propertyAccessContext)"));
  assert.ok(formSource.includes("propertyOwnership?.can_edit === true"));
  assert.ok(catalogSource.includes("const canEditProperty = property.can_edit"));
  assert.ok(contextSource.includes("canManagePropertyCatalogs: boolean"));
  assert.ok(
    formSource.includes(
      "canManagePropertyCatalogs &&\n      !loadingFeatures",
    ),
  );
  assert.ok(
    formSource.includes(
      "canManagePropertyCatalogs &&\n      !loadingProximities",
    ),
  );
  assert.ok(
    formSource.includes(
      "if (!canManagePropertyCatalogs || !canEditOwnerDetails) return",
    ),
  );
  assert.ok(ownerSource.includes("{canManagePropertyCatalogs && ("));
  assert.ok(
    (locationSource.match(/canManagePropertyCatalogs &&/g) ?? []).length >= 6,
  );
  assert.equal(
    (extrasSource.match(/allowAdd=\{canManagePropertyCatalogs\}/g) ?? []).length,
    2,
  );
  assert.ok(formSource.includes("canManagePropertyCatalogs,"));
  assert.ok(formSource.includes("const showManagerOnlySections = !isEditing || canManagePropertyCatalogs"));
  assert.ok(formSource.includes("{showManagerOnlySections && <CommissionsSection />}"));
  assert.ok(formSource.includes("{showManagerOnlySections && <ConfidentialSection />}"));
  assert.ok(mediaSource.includes("const canEditPropertyMedia = !isEditing || canManagePropertyCatalogs"));
  assert.ok(mediaSource.includes("{canEditPropertyMedia && ("));
});

test("editor por policy nao recebe controles de campos descartados do PATCH", () => {
  const sources = {
    structure: readWorkspaceFile(
      "components/features/properties/property-form/sections/StructureSection.tsx",
    ),
    location: readWorkspaceFile(
      "components/features/properties/property-form/sections/LocationSection.tsx",
    ),
    characteristics: readWorkspaceFile(
      "components/features/properties/property-form/sections/CharacteristicsSection.tsx",
    ),
    values: readWorkspaceFile(
      "components/features/properties/property-form/sections/ValuesSection.tsx",
    ),
  };

  const assertManagerGuard = (source: string, marker: string) => {
    const fieldIndex = source.indexOf(marker);
    const guardIndex = source.lastIndexOf("showManagerOnlyFields && (", fieldIndex);
    assert.ok(fieldIndex >= 0, `campo ${marker} ausente do formulario`);
    assert.ok(
      guardIndex >= 0 && fieldIndex - guardIndex < 5_000,
      `campo ${marker} nao esta sob guarda gerencial`,
    );
  };

  assertManagerGuard(sources.structure, "formData.referencia_alternativa");
  for (const marker of ["formData.quadra", "formData.lote"]) {
    assertManagerGuard(sources.location, marker);
  }
  for (const marker of [
    "formData.situacao_imovel",
    "formData.ocupacao",
    "formData.autorizado_comercializacao",
    "formData.local_chaves",
    "formData.comentarios_internos",
  ]) {
    assertManagerGuard(sources.characteristics, marker);
  }
  for (const marker of [
    "formData.iptu_period",
    "formData.valor_venda_avaliado",
    "formData.valor_locacao_avaliado",
    "formData.rent_adjustment_index",
    "formData.financing_details",
    "formData.exchange_details",
  ]) {
    assertManagerGuard(sources.values, marker);
  }
  assert.ok(
    sources.values.includes("condominiumAccess.showExemptionControl"),
  );
  assert.ok(
    sources.values.includes("propertyTaxAccess.showExemptionControl"),
  );
  assert.ok(sources.values.includes("disabled={condominiumAccess.amountDisabled}"));
  assert.ok(sources.values.includes("disabled={propertyTaxAccess.amountDisabled}"));
  assert.ok(sources.values.includes("disabled={financingModeAccess.selectDisabled}"));
  assert.ok(sources.values.includes("financingModeAccess.showMcmvOption"));

  for (const safeMarker of [
    "formData.condominio",
    "formData.iptu",
    "formData.aceita_financiamento",
    "formData.aceita_permuta",
    "formData.zoneamento",
  ]) {
    assert.ok(
      Object.values(sources).some((source) => source.includes(safeMarker)),
      `campo base ${safeMarker} foi removido do formulario`,
    );
  }
});

test("ficha oferece edicao pela policy sem ampliar outras operacoes", () => {
  const workspaceSource = readWorkspaceFile(
    "components/features/properties/PropertyWorkspaceScreen.tsx",
  );

  assert.ok(workspaceSource.includes("isPropertyEditAccessReady({"));
  assert.ok(workspaceSource.includes("property.can_edit === true"));
  assert.equal(workspaceSource.includes("canEditPropertyDetails({"), false);
  assert.ok(workspaceSource.includes("{canEditProperty && ("));
  assert.ok(
    (workspaceSource.match(/response\.meta\.can_manage/g) ?? []).length >= 2,
    "acoes fora da edicao devem continuar restritas a property_manage",
  );
});

test("locacao reúne aluguel e temporada no catalogo completo com uma unica consulta", () => {
  const catalogSource = readWorkspaceFile(
    "components/features/properties/PropertiesScreen.tsx",
  );
  const rentalSource = readWorkspaceFile(
    "components/features/properties/PropertyRentalsScreen.tsx",
  );

  assert.ok(rentalSource.includes('<PropertiesScreen preset="rentals" />'));
  assert.equal(rentalSource.includes("useInfiniteProperties"), false);
  assert.equal(rentalSource.includes("Total para aluguel"), false);
  assert.equal(
    (catalogSource.match(/useInfiniteProperties\(/g) ?? []).length,
    1,
  );
  assert.ok(catalogSource.includes('preset === "rentals"'));
  assert.ok(catalogSource.includes('tipo_de_negocio: "rental_catalog"'));
  assert.ok(catalogSource.includes('<SelectItem value="rental_catalog">'));
  assert.ok(catalogSource.includes("Locação e temporada"));
  assert.ok(
    catalogSource.includes('<SelectItem value="Aluguel">Locação</SelectItem>'),
  );
  assert.ok(
    catalogSource.includes(
      '<SelectItem value="Temporada">Temporada</SelectItem>',
    ),
  );
  assert.ok(catalogSource.includes("activeSection={activeSection}"));
});

test("lancamentos reutilizam o catalogo de imoveis com modalidade predefinida", () => {
  const catalogSource = readWorkspaceFile(
    "components/features/properties/PropertiesScreen.tsx",
  );
  const launchesRouteSource = readWorkspaceFile(
    "app/(protected)/properties/launches/page.tsx",
  );

  assert.ok(launchesRouteSource.includes('<PropertiesScreen preset="launches" />'));
  assert.ok(catalogSource.includes('preset === "launches"'));
  assert.ok(catalogSource.includes('tipo_de_negocio: "Lançamento"'));
  assert.ok(catalogSource.includes('? "developments"'));
  assert.ok(catalogSource.includes('isLaunchCatalog ? "imóveis em lançamento"'));
});

test("configuracoes de imoveis vivem no dominio e o link antigo redireciona", () => {
  const propertySettingsSource = readWorkspaceFile(
    "components/features/properties/PropertySettingsScreen.tsx",
  );
  const propertySettingsRouteSource = readWorkspaceFile(
    "app/(protected)/properties/settings/page.tsx",
  );
  const propertyLayoutSource = readWorkspaceFile(
    "app/(protected)/properties/layout.tsx",
  );
  const permissionHookSource = readWorkspaceFile(
    "hooks/use-user-permissions.ts",
  );
  const settingsRouteSource = readWorkspaceFile(
    "app/(protected)/settings/page.tsx",
  );
  const generalSettingsSource = readWorkspaceFile(
    "components/features/settings/SettingsScreen.tsx",
  );
  const settingsAPISource = readWorkspaceFile("lib/api/settings.ts");
  const propertySettingsValidationSource = readWorkspaceFile(
    "lib/validation/settings.ts",
  );

  assert.ok(
    propertySettingsSource.includes(
      '<PropertySectionTabs activeSection="settings" />',
    ),
  );
  assert.ok(
    propertySettingsRouteSource.includes(
      'permission="settings_organization"',
    ),
  );
  assert.ok(propertyLayoutSource.includes('"settings_organization"'));
  assert.ok(permissionHookSource.includes("return permissions.includes(key)"));
  assert.ok(settingsRouteSource.includes('params?.tab === "properties"'));
  assert.ok(settingsRouteSource.includes('redirect(`/properties/settings'));
  assert.equal(generalSettingsSource.includes("PropertySettingsTab"), false);
  assert.ok(propertySettingsSource.includes("settingsAPI.updatePropertySettings"));
  assert.ok(
    propertySettingsSource.includes(
      "Todos podem editar apenas os imóveis que já têm permissão para visualizar.",
    ),
  );
  assert.equal(propertySettingsSource.includes("organizationPayload"), false);
  assert.equal(propertySettingsSource.includes("settingsAPI.updateOrganization"), false);
  assert.ok(settingsAPISource.includes('"/v1/settings/properties"'));
  assert.ok(settingsAPISource.includes("updatePropertySettingsInputSchema"));
  assert.ok(propertySettingsValidationSource.includes(".strict()"));
});

test("rotas diretas do dominio nao herdam acesso de configuracao", () => {
  for (const path of [
    "app/(protected)/properties/rentals/page.tsx",
    "app/(protected)/properties/[id]/page.tsx",
  ]) {
    const source = readWorkspaceFile(path);
    assert.ok(source.includes("PermissionBoundary"), `limite ausente: ${path}`);
    assert.ok(source.includes('"property_view"'), `view ausente: ${path}`);
    assert.ok(source.includes('"property_manage"'), `manage ausente: ${path}`);
    assert.equal(
      source.includes('"settings_organization"'),
      false,
      `settings nao deve liberar: ${path}`,
    );
  }
});

test("preco legado fora do modelo e saneado por migracao forward sem alterar a origem", () => {
  const foundationSource = readWorkspaceFile(
    "supabase/migrations/20260731110940_real_estate_foundation.sql",
  );
  const migrationSource = readWorkspaceFile(
    "supabase/migrations/20260831050325_harden_legacy_property_offer_prices.sql",
  );

  assert.ok(
    foundationSource.includes(
      "case when classified.preco >= 0 then classified.preco end",
    ),
  );
  assert.equal(
    foundationSource.includes("classified.preco < 100000000000000"),
    false,
  );
  assert.equal(foundationSource.includes("legacy_price_out_of_range"), false);
  assert.ok(migrationSource.includes("safe_legacy_property_offer_price"));
  assert.ok(
    migrationSource.includes("round(legacy_price, 2) <= 99999999999999.99"),
  );
  assert.ok(migrationSource.includes("legacy_sale_price_raw"));
  assert.ok(migrationSource.includes("legacy_rental_price_raw"));
  assert.ok(migrationSource.includes("pg_get_functiondef"));
  assert.ok(migrationSource.includes("backfill_real_estate_foundation()"));
  assert.ok(
    migrationSource.includes("sync_property_legacy_offers(public.properties)"),
  );
  assert.ok(migrationSource.includes("update public.property_offers as offer"));
  assert.equal(migrationSource.includes("update public.properties"), false);
  assert.ok(
    migrationSource.includes(
      "set_config('vimob.property_offer_compatibility_sync', 'on', true)",
    ),
  );
});

test("lancamentos e cadastros compartilham o shell e localidades preserva rota e query", () => {
  const developmentsSource = readWorkspaceFile(
    "components/features/properties/developments/PropertyDevelopmentsScreen.tsx",
  );
  const locationsSource = readWorkspaceFile(
    "components/features/properties/PropertyLocationsScreen.tsx",
  );
  const locationsNavigationSource = readWorkspaceFile(
    "components/features/properties/property-locations/LocationsNavigation.tsx",
  );
  const locationsModelSource = readWorkspaceFile(
    "components/features/properties/property-locations/model.ts",
  );
  const locationsRouteSource = readWorkspaceFile(
    "app/(protected)/properties/locations/page.tsx",
  );

  assert.ok(
    developmentsSource.includes(
      '<PropertySectionTabs activeSection="developments" />',
    ),
  );
  assert.ok(developmentsSource.includes("commercialStatus"));
  assert.ok(developmentsSource.includes("development_type: type"));
  assert.ok(
    locationsSource.includes(
      "<PropertySectionTabs activeSection={activePropertySection} />",
    ),
  );
  assert.ok(
    locationsNavigationSource.includes(
      'className="flex min-w-0 items-center gap-2"',
    ),
  );
  assert.ok(
    locationsModelSource.includes("new URLSearchParams(currentSearch)"),
  );
  assert.ok(locationsSource.includes("window.location.search"));
  assert.ok(locationsSource.includes("propertyLocationsHref("));
  assert.ok(locationsModelSource.includes("params.set('tab', 'neighborhoods')"));
  assert.ok(
    locationsModelSource.includes("pathname = '/properties/condominiums'"),
  );
  assert.ok(locationsModelSource.includes("pathname = '/properties/owners'"));
  assert.ok(locationsModelSource.includes("return query ?"));
  assert.ok(locationsRouteSource.includes("await searchParams"));
  assert.ok(locationsRouteSource.includes('requestedTab === "neighborhoods"'));
});

test("vinculo unidade ficha bloqueia estados terminais e rotula desvinculo no historico", () => {
  const actionSource = readWorkspaceFile(
    "components/features/properties/developments/DevelopmentUnitPropertyActionDialog.tsx",
  );
  const workspaceSource = readWorkspaceFile(
    "components/features/properties/developments/PropertyDevelopmentWorkspaceScreen.tsx",
  );
  const workspaceModelSource = readWorkspaceFile(
    "components/features/properties/developments/development-workspace/model.ts",
  );

  for (const status of [
    "reserved",
    "reservado",
    "sold",
    "vendido",
    "rented",
    "alugado",
    "locado",
    "archived",
    "arquivado",
  ]) {
    assert.ok(
      actionSource.includes(`case '${status}':`),
      `status sem bloqueio visual: ${status}`,
    );
  }
  assert.ok(
    actionSource.includes("getBlockedReason={getPropertyLinkBlockedReason}"),
  );
  assert.ok(workspaceSource.includes("<HistoryTab"));
  assert.ok(
    workspaceModelSource.includes("event.metadata?.operation === 'unlink_property'"),
  );
  assert.ok(workspaceModelSource.includes("Ficha de imóvel desvinculada"));
});

test("cards de imóveis usam selos sólidos para código, modalidade e status", () => {
  const cardSource = readWorkspaceFile(
    "components/features/properties/PropertyCard.tsx",
  );

  assert.ok(cardSource.includes("data-property-card-code"));
  assert.ok(cardSource.includes("data-property-card-deal-type"));
  assert.ok(cardSource.includes("data-property-card-status"));
  assert.ok(
    cardSource.includes(
      'className="rounded-br-[6px] bg-primary px-3 py-1.5',
    ),
  );
  assert.ok(
    cardSource.includes(
      'className="rounded-[6px] border-0 bg-primary px-2 py-1',
    ),
  );
  assert.ok(cardSource.includes('"bg-zinc-900 text-white'));
  assert.ok(cardSource.includes('"bg-sky-950 text-white'));
  assert.ok(cardSource.includes('"bg-amber-950 text-white'));
  assert.ok(cardSource.includes('"bg-black text-white'));
  assert.equal(cardSource.includes("bg-[var(--app-surface-solid)]/90"), false);
});
