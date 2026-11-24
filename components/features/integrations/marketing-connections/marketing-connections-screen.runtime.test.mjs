import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as marketingErrors from "../../../../lib/analytics/marketing-connection-error.ts";

const require = createRequire(import.meta.url);
const file = new URL("./MarketingConnectionsScreen.tsx", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
  fileName: "MarketingConnectionsScreen.tsx",
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
});

function renderConnection(status, lastError) {
  const connection = {
    id: "pilot",
    status,
    last_error: lastError,
    missing_scopes: [],
    assets: [{ id: "ad-1", external_id: "1", name: "Conta autorizada", type: "ad_account", is_selected: true }],
  };
  const imports = {
    "@/components/shared/layout/AppLayout": { AppLayout: ({ children }) => children },
    "@/components/ui/button": {
      Button: ({ children, disabled }) => React.createElement("button", { disabled }, children),
    },
    "@/components/ui/checkbox": { Checkbox: () => null },
    "@/components/ui/skeleton": { Skeleton: () => null },
    "@/hooks/marketing": {
      useMarketingConnections: () => ({ data: { enabled: true, meta_configured: true, connections: [connection] } }),
      useStartMarketingMetaLogin: () => ({}),
      useSyncMarketingConnection: () => ({}),
      useUpdateMarketingConnectionAssets: () => ({}),
      useDisconnectMarketingConnection: () => ({}),
    },
    "@/hooks/use-user-permissions": { useUserPermissions: () => ({ hasPermission: () => true }) },
    "@/lib/analytics/marketing-connection-error": marketingErrors,
    "@/lib/utils": { cn: (...classes) => classes.join(" ") },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => imports[name] ?? require(name), loaded, loaded.exports,
  );
  return renderToStaticMarkup(React.createElement(loaded.exports.default));
}

test("uma sincronização limitada mantém a opção de sincronizar e deixa o login conectado", () => {
  const html = renderConnection("error", "act_1:meta_rate_limited");
  assert.match(html, /Conectada/);
  assert.match(html, /A Meta limitou as solicitações temporariamente/);
  assert.match(html, /<button><svg[^]*?Sincronizar 30 dias<\/button>/);
  assert.doesNotMatch(html, /Entrar de novo|meta_rate_limited/);
});

test("uma autorização expirada oferece nova entrada e desabilita a sincronização", () => {
  const html = renderConnection("expired", "act_1:meta_access_token_invalid");
  assert.match(html, /Login expirado/);
  assert.match(html, /<button>Entrar de novo<\/button>/);
  assert.match(html, /<button disabled=""><svg[^]*?Sincronizar 30 dias<\/button>/);
});
