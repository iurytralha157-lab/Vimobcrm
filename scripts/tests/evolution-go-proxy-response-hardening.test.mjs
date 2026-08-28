import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const edgePath = path.join(
  root,
  "supabase",
  "functions",
  "evolution-go-proxy",
  "index.ts",
);

test("status and QR responses omit provider diagnostics and internal identifiers", async () => {
  const source = await readFile(edgePath, "utf8");
  const statusStart = source.indexOf('if (action === "instance.status")');
  const qrStart = source.indexOf('if (action === "instance.qr")', statusStart);
  const sendStart = source.indexOf("// Only the private worker", qrStart);

  assert.ok(statusStart >= 0);
  assert.ok(qrStart > statusStart);
  assert.ok(sendStart > qrStart);

  const statusBranch = source.slice(statusStart, qrStart);
  const qrBranch = source.slice(qrStart, sendStart);
  const qrResponse = qrBranch.slice(qrBranch.indexOf("return json({"));

  assert.match(statusBranch, /normalizedStatus/);
  assert.doesNotMatch(statusBranch, /rawResponse|diagnostics|endpointUsed/);
  assert.match(qrResponse, /data:\s*qrcode\s*\?\s*\{ qrcode \}\s*:\s*undefined/);
  assert.doesNotMatch(qrResponse, /instanceKey|sourceEndpoint|result\.data/);
});

test("provider failures and unexpected exceptions use bounded public errors", async () => {
  const source = await readFile(edgePath, "utf8");
  const semanticFailureStart = source.indexOf("const semanticFailure =");
  const handlerCatch = source.indexOf("} catch (error) {", semanticFailureStart);
  const responseBranch = source.slice(semanticFailureStart, handlerCatch);
  const catchBranch = source.slice(handlerCatch);

  assert.ok(semanticFailureStart >= 0);
  assert.ok(handlerCatch > semanticFailureStart);
  assert.match(responseBranch, /data:\s*ok\s*\?\s*responseData\s*:\s*undefined/);
  assert.match(responseBranch, /error:\s*ok\s*\?\s*undefined\s*:\s*"WhatsApp provider request failed"/);
  assert.doesNotMatch(responseBranch, /result\.rawText/);
  assert.doesNotMatch(responseBranch, /result\.data\?\.error|result\.data\?\.message/);
  assert.match(catchBranch, /error instanceof InvalidEvolutionPayloadError[\s\S]*\? error\.message[\s\S]*: "Internal worker error"/);
  assert.doesNotMatch(catchBranch, /error instanceof Error \? error\.message : String\(error\)/);
});
