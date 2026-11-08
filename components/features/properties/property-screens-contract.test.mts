import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

test("no black cards or fills anywhere in the property screens", () => {
  for (const file of sourceFiles(root)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /bg-black|bg-zinc-9\d\d|bg-sky-950|bg-amber-950/, file);
  }
});

test("the card never shows keys or condominium, and lazy-loads its photo", () => {
  const card = read("PropertyCard.tsx");
  assert.doesNotMatch(card, /Chaves|local_chaves|property\.condominio|Condomínio/);
  assert.match(card, /loading=\{prioritizeImage \? "eager" : "lazy"\}/);
  assert.match(card, /<ResponsibleAvatar/);
  assert.match(read("property-ui.tsx"), /TooltipContent/);
});

test("old ?tab=responsibles links open Comercial", () => {
  const page = readFileSync(new URL("../../../app/(protected)/properties/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /responsibles: 'commercial'/);
  assert.doesNotMatch(read("PropertyWorkspaceScreen.tsx"), /"responsibles"/);
});

test("the file shows no raw identifiers, and technical ids are collapsed for managers", () => {
  for (const path of ["detail/tabs/OverviewTab.tsx", "detail/tabs/TechnicalTab.tsx", "detail/tabs/CommercialTab.tsx", "detail/tabs/CommercialPeople.tsx", "detail/tabs/KeysTab.tsx", "detail/PropertyWorkspaceSummary.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /Metadados|\.organization_id|font-mono[^"]*">\{[^}]*\.id\}|holder_user_id|ID do/, path);
  }
  const history = read("detail/tabs/HistoryTab.tsx");
  assert.match(history, /\{canManage && <TechnicalIdentifiers/);
  assert.match(history, /<details/);
  assert.match(read("PropertyWorkspaceScreen.tsx"), /canManage=\{response\.meta\.can_manage\}/);
});

test("owner contacts stay behind the server projection and the role flag", () => {
  const people = read("detail/tabs/CommercialPeople.tsx");
  assert.match(people, /"cellphone" in owner/);
  assert.match(people, /hasField\(property, "owner_cellphone"\)/);
  assert.match(people, /hasField\(property, "partner_contact"\)/);
  assert.match(people, /meta\.can_view_owner_contacts/);
  assert.match(read("PropertyWorkspaceScreen.tsx"), /canViewOwnerContacts=\{response\.meta\.can_view_owner_contacts\}/);
});

test("key custody history hides when the API says the viewer cannot see it", () => {
  assert.match(read("detail/tabs/KeyMovementTimeline.tsx"), /can_view_key_custody === false\) return null/);
});

test("media uses human labels and keeps every asset operation behind one panel", () => {
  const manager = read("detail/PropertyAssetManager.tsx");
  const grid = read("detail/media/PropertyMediaGrid.tsx");
  for (const operation of ["useCreatePropertyAsset", "useDeletePropertyAsset", "useReorderPropertyAssets", "useSetPrimaryPropertyAsset", "useUpdatePropertyAsset", "PropertyAssetDeleteDialog", "PROPERTY_MEDIA_MAX_PHOTOS"]) {
    assert.ok(manager.includes(operation), operation);
  }
  assert.doesNotMatch(grid + read("detail/media/PropertyMediaSelection.tsx"), /file_name/);
  assert.match(grid, /loading="lazy"/);
});

test("portfolio settings mark what has no effect yet", () => {
  assert.match(read("settings/portfolio-settings-schema.ts"), /Salva a preferência\. Ainda não altera o sistema\./);
  assert.match(read("settings/PortfolioSettingsPanel.tsx"), /aside=\{PORTFOLIO_SETTINGS_PENDING_NOTICE\}/);
  assert.match(read("settings/SettingChoice.tsx"), /Já existe/);
  assert.match(read("PropertySettingsScreen.tsx"), /<SettingChoice/);
  assert.match(read("settings/use-portfolio-settings-form.ts"), /isPropertySettingsConflict\(error\)/);
});

test("new routes are guarded like the full catalog and sections are registered", () => {
  for (const [route, preset] of [["ready", "ready"], ["third-party", "third_party"]]) {
    const path = new URL(`../../../app/(protected)/properties/${route}/page.tsx`, import.meta.url);
    assert.ok(existsSync(path), route);
    const source = readFileSync(path, "utf8");
    assert.match(source, /anyOf=\{\["property_view", "property_manage"\]\}/);
    assert.ok(source.includes(`preset="${preset}"`));
  }
  const tabs = read("PropertySectionTabs.tsx");
  assert.ok(tabs.includes('href: "/properties/ready"'));
  assert.ok(tabs.includes('href: "/properties/third-party"'));
});
