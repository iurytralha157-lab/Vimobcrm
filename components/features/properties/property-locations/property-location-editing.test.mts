import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(directory, "..", "..", "..", "..");

function source(...segments: string[]) {
  return readFileSync(join(workspaceRoot, ...segments), "utf8");
}

test("localidades liga edição de cidade, bairro e condomínio aos hooks canônicos", () => {
  const screen = source(
    "components",
    "features",
    "properties",
    "PropertyLocationsScreen.tsx",
  );
  const panels = source(
    "components",
    "features",
    "properties",
    "property-locations",
    "LocationPanels.tsx",
  );
  const tables = source(
    "components",
    "features",
    "properties",
    "property-locations",
    "LocationTables.tsx",
  );
  const dialogs = source(
    "components",
    "features",
    "properties",
    "property-locations",
    "LocationFormDialogs.tsx",
  );

  for (const hook of [
    "useUpdateCity",
    "useUpdateNeighborhood",
    "useUpdateCondominium",
  ]) {
    assert.match(screen, new RegExp(`${hook}\\(\\)`));
  }
  for (const schema of [
    "propertyCityUpdateInputSchema",
    "propertyNeighborhoodUpdateInputSchema",
    "propertyCondominiumUpdateInputSchema",
  ]) {
    assert.match(screen, new RegExp(`${schema}\\.safeParse`));
  }

  assert.match(panels, /onEdit: \(city: PropertyCity\) => void/);
  assert.match(
    panels,
    /onEdit: \(neighborhood: PropertyNeighborhood\) => void/,
  );
  assert.match(
    panels,
    /onEdit: \(condominium: PropertyCondominium\) => void/,
  );
  assert.match(tables, /aria-label={`Editar cidade \${city\.name}`}/);
  assert.match(
    tables,
    /aria-label={`Editar bairro \${neighborhood\.name}`}/,
  );
  assert.match(
    tables,
    /aria-label={`Editar condomínio \${condominium\.name}`}/,
  );
  assert.match(
    tables,
    /isLegacyCatalogValue\(condominium\)[\s\S]*Somente leitura/,
  );
  assert.match(dialogs, /editing \? 'Editar cidade' : 'Nova cidade'/);
  assert.match(dialogs, /editing \? 'Editar bairro' : 'Novo bairro'/);
  assert.match(
    dialogs,
    /editing \? 'Editar condomínio' : 'Novo condomínio'/,
  );
  assert.match(dialogs, /editing \? 'Salvar alterações' : 'Cadastrar'/);
  assert.match(
    dialogs,
    /uf: value === EMPTY_SELECT_VALUE \? '' : value/,
  );
  assert.match(
    dialogs,
    /city_id: cityId,[\s\S]*neighborhood_id: neighborhoodId/,
  );
  assert.match(
    dialogs,
    /concierge_type: checked \? current\.concierge_type : ''/,
  );
});

test("histórico da ficha só habilita a consulta quando a aba está ativa", () => {
  const screen = source(
    "components",
    "features",
    "properties",
    "PropertyWorkspaceScreen.tsx",
  );
  const hookSource = source("hooks", "use-properties.ts");
  const historyHookStart = hookSource.indexOf(
    "export function usePropertyHistory",
  );
  const nextHookStart = hookSource.indexOf(
    "export function useCreateProperty",
    historyHookStart,
  );
  const historyHook = hookSource.slice(historyHookStart, nextHookStart);

  assert.ok(historyHookStart >= 0);
  assert.match(historyHook, /options: \{ enabled\?: boolean \} = \{\}/);
  assert.match(
    historyHook,
    /enabled: !!id && !!organizationId && options\.enabled !== false/,
  );
  assert.match(
    screen,
    /usePropertyHistory\(propertyId, \{\s*enabled: activeTab === "history",\s*\}\)/,
  );
  assert.match(screen, /<Tabs\s+value=\{activeTab\}/);
  assert.match(
    screen,
    /router\.replace\(`\/properties\/\$\{propertyId\}\?tab=\$\{nextTab\}`/,
  );
  assert.doesNotMatch(screen, /defaultValue=\{effectiveInitialTab\}/);
});

test("edições e exclusões do catálogo propagam a versão lida", () => {
  const screen = source(
    "components",
    "features",
    "properties",
    "PropertyLocationsScreen.tsx",
  );
  const tables = source(
    "components",
    "features",
    "properties",
    "property-locations",
    "LocationTables.tsx",
  );
  const locationAPI = source("lib", "api", "property-locations.ts");
  const ownerAPI = source("lib", "api", "property-owners.ts");
  const ownersPanel = source(
    "components",
    "features",
    "properties",
    "property-locations",
    "OwnersPanel.tsx",
  );

  assert.match(screen, /expected_updated_at: editingCity\.updated_at/);
  assert.match(screen, /expected_updated_at: editingNeighborhood\.updated_at/);
  assert.match(screen, /expected_updated_at: editingCondominium\.updated_at/);
  assert.match(screen, /expected_updated_at: editingOwner\.updated_at/);
  assert.match(screen, /useDeactivatePropertyOwner\(\)/);
  assert.match(
    screen,
    /deactivateOwner\.mutateAsync\(\{\s*id: deletionTarget\.id,\s*expected_updated_at: deletionTarget\.expected_updated_at/,
  );
  assert.match(ownersPanel, /onDeactivate: \(owner: PropertyOwner\) => void/);
  assert.equal(
    ownersPanel.match(/aria-disabled=\{propertyCount > 0\}/g)?.length,
    2,
    "desktop e mobile devem manter o bloqueio acessível",
  );
  assert.equal(
    ownersPanel.match(/if \(propertyCount === 0\) onDeactivate\(owner\)/g)?.length,
    2,
    "desktop e mobile devem impedir a ação quando há vínculos",
  );
  assert.match(ownersPanel, /owner-deactivate-reason-\$\{owner\.id\}/);
  assert.match(ownersPanel, /owner-deactivate-reason-mobile-\$\{owner\.id\}/);
  assert.equal(
    ownersPanel.match(/Desvincule os imóveis antes de desativar este\s+proprietário\./g)?.length,
    2,
  );
  assert.match(ownersPanel, /aria-label={`Desativar \$\{owner\.name\}`}/);
  const deletionHandlerStart = screen.indexOf(
    "const handleDeleteLocation = async () =>",
  );
  const deletionHandlerEnd = screen.indexOf(
    "const openOwnerDialog =",
    deletionHandlerStart,
  );
  assert.ok(deletionHandlerStart >= 0 && deletionHandlerEnd > deletionHandlerStart);
  const deletionHandler = screen.slice(deletionHandlerStart, deletionHandlerEnd);
  assert.match(
    deletionHandler,
    /catch \{[\s\S]*refreshes the catalog[\s\S]*setDeletionTarget\(null\)/,
  );
  const ownerHook = source("hooks", "use-property-owners.ts");
  assert.match(
    ownerHook,
    /onError: async \(error\) => \{\s*await queryClient\.invalidateQueries\(\{ queryKey: \['property-owners'\] \}\)/,
  );
  assert.match(tables, /expected_updated_at: city\.updated_at/);
  assert.match(tables, /expected_updated_at: neighborhood\.updated_at/);
  assert.match(tables, /expected_updated_at: condominium\.updated_at/);
  assert.match(locationAPI, /propertyCatalogDeleteInputSchema/);
  assert.match(ownerAPI, /propertyOwnerCatalogUpdateInputSchema/);
  assert.match(ownerAPI, /propertyCatalogDeleteInputSchema/);
});
