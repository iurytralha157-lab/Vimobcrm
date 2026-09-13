import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const readWorkspaceFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

test("lancamentos usam uma unica listagem e preservam workspaces gerenciais", () => {
  const pageSource = readWorkspaceFile(
    "app/(protected)/properties/developments/page.tsx",
  );
  const workspacePageSource = readWorkspaceFile(
    "app/(protected)/properties/developments/[id]/page.tsx",
  );
  const source = readWorkspaceFile(
    "components/features/properties/developments/PropertyDevelopmentsScreen.tsx",
  );
  const workspaceSource = readWorkspaceFile(
    "components/features/properties/developments/PropertyDevelopmentWorkspaceScreen.tsx",
  );
  const workspaceHeaderSource = readWorkspaceFile(
    "components/features/properties/developments/development-workspace/WorkspaceHeader.tsx",
  );
  const propertyWorkspaceSource = readWorkspaceFile(
    "components/features/properties/PropertyWorkspaceScreen.tsx",
  );
  const sectionTabsSource = readWorkspaceFile(
    "components/features/properties/PropertySectionTabs.tsx",
  );
  const navigationSource = readWorkspaceFile("config/navigation.ts");

  assert.ok(pageSource.includes('redirect(`/properties/launches'));
  assert.ok(!pageSource.includes("PropertyDevelopmentsScreen"));
  assert.ok(pageSource.includes("new URLSearchParams()"));
  assert.ok(pageSource.includes("next.append(key, item)"));
  assert.ok(workspacePageSource.includes('permission="property_manage"'));
  assert.ok(
    !workspacePageSource.includes('anyOf={["property_view", "property_manage"]}'),
  );
  assert.ok(source.includes("const canManage = response?.meta.can_manage ?? false"));
  assert.ok(source.includes("if (!canManage)"));
  assert.ok(source.includes("return <div key={development.id}"));
  assert.ok(source.includes("<Link href={`/properties/developments/${development.id}`}"));
  assert.ok(
    propertyWorkspaceSource.includes(
      "developmentLink && response.meta.can_manage",
    ),
  );
  assert.equal(
    (workspaceSource.match(/router\.push\('\/properties\/launches'\)/g) ?? [])
      .length,
    3,
  );
  assert.equal(workspaceSource.includes("router.push('/properties/developments')"), false);
  assert.ok(workspaceHeaderSource.includes("Lançamentos"));
  assert.equal(workspaceHeaderSource.includes("Empreendimentos"), false);
  assert.equal(
    sectionTabsSource.includes('href: "/properties/developments"'),
    false,
  );
  assert.equal(navigationSource.includes('path: "/properties/developments"'), false);
  assert.ok(sectionTabsSource.includes('href: "/properties/launches"'));
  assert.ok(navigationSource.includes('path: "/properties/launches"'));
});
