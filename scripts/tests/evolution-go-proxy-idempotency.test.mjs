import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const edgePath = path.join(root, "supabase", "functions", "evolution-go-proxy", "index.ts");
const goProviderPath = path.join(root, "apps", "api", "internal", "whatsapp", "evolution_go.go");
const goHelpersPath = path.join(root, "apps", "api", "internal", "whatsapp", "helpers.go");

function extractDeclarations(source, names) {
  const sourceFile = ts.createSourceFile(
    "evolution-go-proxy.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && names.has(statement.name.text)) {
      declarations.set(statement.name.text, statement.getText(sourceFile));
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name && names.has(statement.name.text)) {
      declarations.set(statement.name.text, statement.getText(sourceFile));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.has(declaration.name.text)) {
          declarations.set(declaration.name.text, statement.getText(sourceFile));
        }
      }
    }
  }

  for (const name of names) {
    assert.ok(declarations.has(name), `missing source declaration ${name}`);
  }
  return [...names].map((name) => declarations.get(name)).join("\n");
}

async function loadSendBodyContract() {
  const source = await readFile(edgePath, "utf8");
  const names = new Set([
    "PROVIDER_MESSAGE_ID_RE",
    "InvalidEvolutionPayloadError",
    "firstPresent",
    "withoutEmpty",
    "normalizeMentionedJids",
    "providerMessageId",
    "sendCommonBody",
    "sendTextBody",
    "sendMediaBody",
  ]);
  const declarations = extractDeclarations(source, names);
  const compiled = ts.transpileModule(
    `${declarations}\nglobalThis.__contract = { providerMessageId, sendTextBody, sendMediaBody };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({});
  vm.runInContext(compiled, context);
  return { source, ...context.__contract };
}

test("text and media bodies preserve only the canonical deterministic provider id", async () => {
  const { sendTextBody, sendMediaBody } = await loadSendBodyContract();
  const id = "0123456789ABCDEF0123456789ABCDEF";

  const textBody = sendTextBody(
    { id, messageId: "ignored-alias", number: "5511999999999", text: "Teste", arbitrary: "blocked" },
    true,
  );
  assert.equal(textBody.id, id);
  assert.deepEqual(Object.keys(textBody).sort(), ["id", "number", "text"]);
  assert.equal(
    sendMediaBody(
      { messageId: id, number: "5511999999999", type: "image", media: "https://example.test/image.png" },
      true,
    ).id,
    id,
  );
  assert.equal(
    sendMediaBody(
      { clientMessageId: id, number: "5511999999999", media: "base64", type: "audio" },
      true,
      "audio",
    ).id,
    id,
  );
});

test("invalid supplied ids fail closed and unprivileged or absent ids remain omitted", async () => {
  const { providerMessageId, sendTextBody, sendMediaBody } = await loadSendBodyContract();
  const invalidIds = [
    "0123456789abcdef0123456789abcdef",
    "0123456789ABCDEF0123456789ABCDE",
    "0123456789ABCDEF0123456789ABCDEFG",
    "0123456789ABCDEF0123456789ABCDE!",
    " 0123456789ABCDEF0123456789ABCDEF ",
    123,
    {},
  ];

  for (const id of invalidIds) {
    assert.throws(
      () => providerMessageId({ id }, true),
      /32 uppercase hexadecimal characters/,
      `expected ${JSON.stringify(id)} to be rejected`,
    );
    assert.throws(() => sendTextBody({ id, text: "Teste" }, true));
    assert.throws(() => sendMediaBody({ id, type: "image", media: "https://example.test/image.png" }, true));
  }

  const id = "0123456789ABCDEF0123456789ABCDEF";
  assert.throws(
    () => providerMessageId({ id: "invalid", messageId: id }, true),
    /32 uppercase hexadecimal characters/,
  );
  const unprivileged = sendTextBody({ id, number: "5511999999999", text: "Teste" }, false);
  assert.equal(Object.hasOwn(unprivileged, "id"), false);

  const legacy = sendTextBody({ number: "5511999999999", text: "Teste" }, true);
  assert.equal(Object.hasOwn(legacy, "id"), false);
});

test("the Edge validation stays aligned with the canonical Go provider contract", async () => {
  const [edge, goProvider, goHelpers] = await Promise.all([
    readFile(edgePath, "utf8"),
    readFile(goProviderPath, "utf8"),
    readFile(goHelpersPath, "utf8"),
  ]);

  assert.match(goHelpers, /sha256\.Sum256\(\[\]byte\(strings\.TrimSpace\(clientMessageID\)\)\)/);
  assert.match(goHelpers, /strings\.ToUpper\(hex\.EncodeToString\(hash\[:16\]\)\)/);
  assert.match(
    goProvider,
    /"id":\s+firstPresentAny\(body\["id"\], body\["messageId"\], body\["clientMessageId"\]\)/,
  );
  assert.match(edge, /const PROVIDER_MESSAGE_ID_RE = \/\^\[0-9A-F\]\{32\}\$\//);
  assert.match(edge, /id:\s*providerMessageId\(body, allowProviderMessageId\)/);
  assert.match(edge, /case "send\.text":[\s\S]*sendTextBody\(body, allowProviderMessageId\)/);
  assert.match(edge, /case "send\.media":[\s\S]*sendMediaBody\(body, allowProviderMessageId\)/);
  assert.match(edge, /case "send\.audio":[\s\S]*sendMediaBody\(body, allowProviderMessageId, "audio"\)/);
  assert.match(edge, /const allowProviderMessageId = auth\.serviceRole === true && !!session\?\.id/);
  assert.match(edge, /error instanceof InvalidEvolutionPayloadError \? 400 : 500/);
});
