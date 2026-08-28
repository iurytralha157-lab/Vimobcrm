import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const senderPath = path.join(
  root,
  "supabase",
  "functions",
  "message-sender",
  "index.ts",
);

async function loadAuditContract() {
  const source = await readFile(senderPath, "utf8");
  const sourceFile = ts.createSourceFile(
    "message-sender.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set([
    "normalizedAuditCount",
    "recordManualReconciliationAudit",
  ]);
  const declarations = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) && names.has(statement.name?.text || ""),
  );
  assert.equal(declarations.length, names.size, "missing audit contract");

  const compiled = ts.transpileModule(
    `${declarations.map((declaration) => declaration.getText(sourceFile)).join("\n")}
globalThis.__contract = { recordManualReconciliationAudit };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const logEvents = [];
  const context = vm.createContext({
    console: {
      error(...args) {
        logEvents.push(args);
      },
    },
    Math,
    Number,
  });
  vm.runInContext(compiled, context);
  return { source, logEvents, ...context.__contract };
}

function auditInput() {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    outboxId: "00000000-0000-4000-8000-000000000002",
    reason: "evolution-go-provider-outcome-unknown",
    provider: "evolution_go",
    attempts: 2,
    maxAttempts: 3,
    historyCommitted: false,
  };
}

test("manual reconciliation emits one tenant-scoped, metadata-only audit event", async () => {
  const { recordManualReconciliationAudit } = await loadAuditContract();
  let insertedTable;
  let insertedEvent;
  const supabase = {
    from(table) {
      insertedTable = table;
      return {
        async insert(event) {
          insertedEvent = event;
          return { error: null };
        },
      };
    },
  };

  const recorded = await recordManualReconciliationAudit(supabase, auditInput());
  assert.equal(recorded, true);
  assert.equal(insertedTable, "audit_logs");
  assert.deepEqual(
    JSON.parse(JSON.stringify(insertedEvent)),
    {
      organization_id: "00000000-0000-4000-8000-000000000001",
      action: "whatsapp.manual_reconciliation_required",
      entity_type: "outbox_message",
      entity_id: "00000000-0000-4000-8000-000000000002",
      source: "message-sender",
      metadata: {
        reason: "evolution-go-provider-outcome-unknown",
        provider: "evolution_go",
        attempts: 2,
        max_attempts: 3,
        history_committed: false,
      },
    },
  );

  const serialized = JSON.stringify(insertedEvent).toLowerCase();
  for (const forbidden of [
    "content",
    "phone",
    "remote_jid",
    "client_message_id",
    "provider_request_id",
    "secret",
    "token",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `audit leaked ${forbidden}`);
  }
});

test("audit insert errors are observed but never thrown into the delivery state machine", async () => {
  const { recordManualReconciliationAudit, logEvents } = await loadAuditContract();
  const supabase = {
    from() {
      return {
        async insert() {
          return { error: { code: "audit_unavailable", message: "private detail" } };
        },
      };
    },
  };

  const recorded = await recordManualReconciliationAudit(supabase, auditInput());
  assert.equal(recorded, false);
  assert.equal(logEvents.length, 1);
  assert.equal(JSON.stringify(logEvents).includes("private detail"), false);
});

test("audit is written only after the terminal outbox CAS is confirmed", async () => {
  const { source } = await loadAuditContract();
  const uncertainStart = source.indexOf(
    "if (providerAccepted || error instanceof ProviderOutcomeUnknownError)",
  );
  const retryStart = source.indexOf("const failedAttemptPlan", uncertainStart);
  const uncertain = source.slice(uncertainStart, retryStart);

  const terminalConfirmation = uncertain.indexOf("if (outcomeStateError || !outcomeRow)");
  const auditCall = uncertain.indexOf("await auditManualReconciliation({");
  assert.ok(terminalConfirmation >= 0);
  assert.ok(auditCall > terminalConfirmation);
  assert.match(uncertain, /summary\.failed \+= 1;[\s\S]*await auditManualReconciliation/);
  assert.match(source, /manual_reconciliation_audit_errors/);
});

test("the existing audit surface is tenant-readable and operationally consumed", async () => {
  const [repository, adminNavigation, auditFeed, userActivity] = await Promise.all([
    readFile(path.join(root, "apps", "api", "internal", "audit", "repository.go"), "utf8"),
    readFile(
      path.join(root, "components", "features", "admin", "admin-navigation.ts"),
      "utf8",
    ),
    readFile(path.join(root, "hooks", "use-audit-feed.ts"), "utf8"),
    readFile(path.join(root, "lib", "api", "user-activity.ts"), "utf8"),
  ]);

  assert.match(repository, /al\.organization_id = \$%d::uuid/);
  assert.match(repository, /from public\.audit_logs al/);
  assert.match(adminNavigation, /Auditoria/);
  assert.match(auditFeed, /connectAuditFeed/);
  assert.match(userActivity, /audit\.log\.created/);
});
