import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(readFileSync("packages/contracts/openapi/v1.yaml", "utf8"));
const routes = readFileSync("apps/api/internal/app/routes.go", "utf8");

test("every invitation router operation is documented", () => {
  const operations = [...routes.matchAll(
    /mux\.Handle(?:Func)?\("(GET|POST|PATCH|DELETE) (\/v1\/(?:public\/)?invitations(?:\/[^\"]*)?)"/g,
  )];
  assert.equal(operations.length, 8);
  for (const [, method, path] of operations) {
    assert.ok(document.paths[path]?.[method.toLowerCase()], `${method} ${path} is missing from OpenAPI`);
  }
});

test("invitation management never exposes bearer credentials", () => {
  const invitation = document.components.schemas.OrganizationInvitation;
  assert.equal(invitation.additionalProperties, false);
  assert.equal(invitation.properties.token, undefined);
  assert.equal(invitation.properties.token_hash, undefined);
  assert.match(invitation.properties.email_status.description, /accepted or sent means the\s+provider accepted the request, delivered confirms delivery/);

  for (const operation of [
    document.paths["/v1/invitations"].get,
    document.paths["/v1/invitations"].post,
    document.paths["/v1/invitations/{id}"].patch,
    document.paths["/v1/invitations/{id}/resend"].post,
  ]) {
    assert.ok(operation.parameters.some((parameter) => parameter.$ref === "#/components/parameters/OrganizationIdHeader"));
  }
});

test("public invitation capabilities are uncached and describe fail-closed limits", () => {
  for (const operation of [
    document.paths["/v1/public/invitations/{token}"].get,
    document.paths["/v1/public/invitations/{token}/accept"].post,
  ]) {
    assert.deepEqual(operation.security, []);
    assert.ok(operation.responses["429"]);
    assert.ok(operation.responses["503"]);
    assert.equal(
      operation.responses["200"].headers["Cache-Control"].$ref,
      "#/components/headers/InvitationCapabilityCacheControl",
    );
  }
  assert.ok(document.paths["/v1/invitations/{token}/accept"].post.responses["403"]);
});
