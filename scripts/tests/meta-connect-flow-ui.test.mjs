import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../../components/features/integrations/MetaIntegrationSettings.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../lib/api/integrations/meta.ts", import.meta.url),
  "utf8",
);

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Meta connect section ${start} is missing`);
  return source.slice(from, to);
}

test("the Page confirmation wizard opens only for a usable OAuth flow", () => {
  const callback = section("const handleOAuthStatusResult = useCallback", "useEffect(() => {",);
  assert.match(callback, /canUseMetaOAuthFlow\(flow, organizationId\)\s*&&\s*openOAuthWizard\(/);
  assert.match(callback, /showOAuthAuthorizationUnavailable\(\);[\s\S]*Autorize a conta novamente/);

  const connect = section("const connectAndLoadPage = async", "const handleSelectPage = async");
  const expiryCheck = connect.indexOf("Date.parse(oauthFlowExpiresAt) <= Date.now()");
  const post = connect.indexOf("connectPage.mutateAsync(");
  assert.ok(expiryCheck >= 0 && post > expiryCheck, "expired authorizations must be rejected before POST");
  assert.match(connect, /connectPage\.mutateAsync\(\{\s*pageId: page\.id,\s*flowId: selectedAccount\.flowId,\s*\}\)/);
});

test("a failed Page POST cannot claim success or open forms from an old connected row", () => {
  const connect = section("const connectAndLoadPage = async", "const handleSelectPage = async");
  const errorBranch = connect.indexOf("if (connectError) {");
  const successBranch = connect.indexOf("if (!integration) {", errorBranch);
  const errorBody = connect.slice(errorBranch, successBranch);
  assert.ok(errorBranch >= 0 && successBranch > errorBranch);
  assert.match(errorBody, /return;\s*}/);
  assert.doesNotMatch(errorBody, /retainPendingOAuthPages\(|loadFormsForIntegration\(/);
  assert.ok(connect.indexOf("retainPendingOAuthPages(") > successBranch);
  assert.ok(connect.indexOf("await loadFormsForIntegration(integration)") > successBranch);
});

test("Page confirmation has enough time for the backend's provider and Vault work", () => {
  const timeout = apiSource.match(/const META_OAUTH_CONNECT_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(timeout, "Meta Page POST needs its own explicit timeout");
  assert.ok(Number(timeout[1].replaceAll("_", "")) > 45_000, "Page POST must outlive the 45-second backend budget");
  assert.match(apiSource, /body\.action === 'connect_page' \? \{ timeoutMs: META_OAUTH_CONNECT_TIMEOUT_MS \}/);
});
