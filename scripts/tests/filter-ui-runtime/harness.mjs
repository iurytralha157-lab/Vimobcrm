import assert from "node:assert/strict";
import { after, before } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { fixture } from "./fixture.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const repositoryPath = root.replaceAll("\\", "/");
let temporaryDirectory;
let browser;
export let page;
export const browserErrors = [];

// Actual React/Radix filter components; only data hooks use synthetic, inert values.

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "vimob-filter-ui-"));
  const loader = path.join(temporaryDirectory, "typescript-loader.cjs");
  const entry = path.join(temporaryDirectory, "fixture.tsx");
  const hooks = path.join(temporaryDirectory, "synthetic-hooks.ts");
  await writeFile(loader, `const ts = require(${JSON.stringify(path.join(root, "node_modules/typescript"))}); module.exports = function(source) { return ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText; };`);
  await writeFile(entry, fixture);
  await writeFile(hooks, `import { useState, useEffect } from "react";
    let organizationId = "10000000-0000-4000-8000-000000000001";
    const authListeners = new Set();
    window.setFixtureOrganization = id => { organizationId = id; for (const update of authListeners) update(id); };
    export const useUserPermissions = () => ({ hasPermission: () => true });
    export const useCreateTag = () => ({ isPending: false, mutateAsync: () => { throw new Error("Creation is forbidden in filter fixture"); } });
    export const useTeams = () => ({ data: [], isFetching: false, isSuccess: true }); export const useOrganizationUsers = useTeams;
    export function useAuth() { const [org, setOrg] = useState(organizationId); useEffect(() => { authListeners.add(setOrg); return () => authListeners.delete(setOrg); }, []); return { user: { id: "20000000-0000-4000-8000-000000000001" }, activeOrganization: { organizationId: org }, isSuperAdmin: true }; }
  `);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  const aliases = Object.fromEntries(["hooks/use-tags", "hooks/use-user-permissions", "hooks/use-teams", "hooks/use-users", "contexts/AuthContext"].map((name) => [`@/${name}$`, hooks]));
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry,
      output: { path: temporaryDirectory, filename: "fixture.js" },
      resolve: { extensions: [".tsx", ".ts", ".js"], alias: { ...aliases, "./AuthContext$": hooks, "@": root }, modules: [path.join(root, "node_modules"), "node_modules"] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
      optimization: { minimize: false },
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats?.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const cssSources = ["config/filter-ui.ts", "components/shared", "components/ui", "components/features/schedule/dashboard/AgendaDashboardFilters.tsx", "components/features/whatsapp/conversations/ConversationFilters.tsx", "scripts/tests/filter-ui-runtime/fixture.mjs"];
  const productCss = (await readFile(path.join(root, "app/globals.css"), "utf8")).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const css = await postcss([tailwind({ base: root })]).process(`${productCss}\n${cssSources.map((source) => `@source "${repositoryPath}/${source}";`).join("\n")}`, { from: path.join(root, "app/filter-fixture.css") });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 768, height: 600 }, hasTouch: true, timezoneId: "America/Sao_Paulo" });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/*", (route) => route.request().url() === "http://filter-fixture.local/" ? route.fulfill({ contentType: "text/html", body: `<style>${css.css}</style><div id="app"></div>` }) : route.abort());
  await page.goto("http://filter-fixture.local/");
  await page.addScriptTag({ content: await readFile(path.join(temporaryDirectory, "fixture.js"), "utf8") });
  await page.getByRole("button", { name: /Selecionar tags/ }).waitFor().catch((error) => {
    throw new AggregateError([error, ...browserErrors.map(message => new Error(message))], "Filter fixture failed to mount");
  });
});

after(async () => {
  await browser?.close();
  if (temporaryDirectory) {
    const resolved=path.resolve(temporaryDirectory);
    assert.equal(path.dirname(resolved),path.resolve(tmpdir()));
    assert.match(path.basename(resolved),/^vimob-filter-ui-/);
    await rm(resolved,{recursive:true,force:true});
  }
});

export async function showFixture(name) {
  await page.keyboard.press("Escape");
  await page.evaluate((fixtureName) => window.showFilterFixture(fixtureName), name);
  await page.waitForTimeout(150);
}

export async function clearContextFilters() {
  const revision = await page.evaluate(() => {
    const revision = window.fixtureFilters.filterApplicationRevision;
    window.fixtureFilters.clearFilters();
    return revision;
  });
  await page.waitForFunction(revision => window.fixtureFilters.filterApplicationRevision !== revision, revision);
}
