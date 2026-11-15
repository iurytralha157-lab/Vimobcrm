import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const node = ({ children }) => React.createElement("div", null, children);
const core = { "react/jsx-runtime": require("react/jsx-runtime"), "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") } };

// Use the existing HistoryTab SSR harness pattern; only unrelated UI shells are stubbed.
function load(relative, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const evaluated = { exports: {} };
  vm.runInNewContext(compiled, { module: evaluated, exports: evaluated.exports, require: name => {
    const all = { ...core, ...dependencies };
    assert.ok(Object.hasOwn(all, name), `Unexpected dependency: ${name}`);
    return all[name];
  } });
  return evaluated.exports;
}
const display = load("../../property-display.ts");
const fields = load("../../property-ui.tsx", {
  "@/components/features/marketing/marketing-ui": { PANEL_SOFT: "" },
  "@/components/ui/avatar": { Avatar: node, AvatarFallback: node, AvatarImage: node },
  "@/components/ui/tooltip": { Tooltip: node, TooltipContent: node, TooltipProvider: node, TooltipTrigger: node },
});
const model = load("../property-workspace-model.ts", { "@/lib/property-media": { getSafePropertyImageSource: () => null } });
const { CommercialConditions } = load("./CommercialTab.tsx", {
  "lucide-react": { Pencil: node, Plus: node },
  "@/components/features/marketing/marketing-ui": { Panel: node },
  "@/components/ui/button": { Button: node },
  "@/lib/property-display-utils": { formatPropertyDate: () => { throw new Error("Unexpected date formatting"); } },
  "../../property-display": display,
  "../../property-ui": fields,
  "../property-workspace-model": model,
});
const render = property => renderToStaticMarkup(React.createElement(CommercialConditions, { property }));
const field = (html, label) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`))?.[1];

test("percentage sale and rental commissions keep their unit in the real field grid", () => {
  const html = render({ tipo_comissao: "percentual", comissao_venda: 6, comissao_locacao: 10.5, commission_percentage: 3 });
  assert.equal(field(html, "Comissão de venda"), "6%");
  assert.equal(field(html, "Comissão de locação"), "10.5%");
  assert.equal(field(html, "Comissão"), "3%", "the independent percentage field keeps its contract");
  assert.doesNotMatch(html, /R\$/);
});

test("fixed sale and rental commissions reuse property currency formatting", () => {
  const html = render({ tipo_comissao: "valor_fixo", comissao_venda: 1250.5, comissao_locacao: 300 });
  assert.equal(field(html, "Comissão de venda"), display.formatPropertyMoney(1250.5));
  assert.equal(field(html, "Comissão de locação"), display.formatPropertyMoney(300));
});

test("omitted, null and empty commission types match the form's percentage default", () => {
  for (const tipo_comissao of [undefined, null, ""]) {
    const html = render({ tipo_comissao, comissao_venda: 6, comissao_locacao: 1 });
    assert.equal(field(html, "Comissão de venda"), "6%");
    assert.equal(field(html, "Comissão de locação"), "1%");
  }
});

test("zero is an explicit commission in percentage and fixed modes", () => {
  for (const tipo_comissao of ["percentual", "valor_fixo"]) {
    const html = render({ tipo_comissao, comissao_venda: 0, comissao_locacao: 0 });
    const expected = tipo_comissao === "valor_fixo" ? display.formatPropertyMoney(0) : "0%";
    assert.equal(field(html, "Comissão de venda"), expected);
    assert.equal(field(html, "Comissão de locação"), expected);
  }
});

test("null and omitted commission values remain absent", () => {
  const html = render({ tipo_comissao: "percentual", comissao_venda: null });
  assert.equal(field(html, "Comissão de venda"), undefined);
  assert.equal(field(html, "Comissão de locação"), undefined);
  assert.doesNotMatch(html, /R\$|0%/);
});

test("a viewer-redacted property does not reveal a commission section", () => {
  assert.equal(render({}), "");
});
