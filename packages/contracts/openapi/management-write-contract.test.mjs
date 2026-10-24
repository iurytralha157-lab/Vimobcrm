import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

const document = yaml.load(readFileSync("packages/contracts/openapi/v1.yaml", "utf8"));
// OpenAPI 3.1 uses JSON Schema 2020-12. Compile local references with explicitly
// installed validators so allOf/additionalProperties and formats remain active.
const validator = new Ajv2020({ allErrors: true, logger: false, strictSchema: true });
addFormats(validator);
// Allow only the document envelope and OpenAPI annotation used by these refs;
// unknown JSON Schema keywords must still fail compilation.
validator.addVocabulary([
  "openapi", "info", "servers", "security", "paths", "components", "example",
]);
// int64 is an OpenAPI numeric format, rather than a built-in string format.
validator.addFormat("int64", { type: "number", validate: Number.isInteger });
validator.addSchema(document, "vimob");
const schema = (name) => validator.compile({ $ref: `vimob#/components/schemas/${name}` });
const ID = "11111111-1111-4111-8111-111111111111";
const REVISION = 12;
const UPDATED_AT = "2026-10-12T18:00:00.123456Z";

test("queue creation caps and legacy-edit escape agree with the server contract", () => {
  const members = Array.from({ length: 501 }, () => ({ type: "user", entityId: ID, weight: 1 }));
  const rules = Array.from({ length: 201 }, () => ({ id: ID, matchType: "source", matchValue: "site", priority: 0 }));
  assert.equal(schema("CreateRoundRobinRequest")({ name: "QA", members }), false);
  assert.equal(schema("CreateRoundRobinRequest")({ name: "QA", rules }), false);
  assert.equal(schema("UpdateRoundRobinRequest")({ expectedRevision: REVISION, name: "QA", members, rules }), true);
  const capacity = validator.compile(document.components.schemas.RoundRobin.properties.eligibleUserCount);
  assert.equal(capacity(2), true);
  assert.equal(capacity(-1), false);
  assert.equal(capacity(1.5), false);
});

test("team update reports a queue-sync conflict without broadening revision-conflict decoding", () => {
  const conflict = validator.compile({ $ref: 'vimob#/paths/~1v1~1teams~1{id}/patch/responses/409/content/application~1json/schema' });
  assert.equal(conflict({ error: { code: 'team_revision_conflict', message: 'Reload the team' } }), true);
  assert.equal(conflict({ error: { code: 'team_queue_sync_blocked', message: 'Reduce participants or review the team binding' } }), true);
  assert.equal(conflict({ error: { code: 'unrelated_error', message: 'Unexpected' } }), false);
});

test("all local OpenAPI references resolve, including the new management paths", () => {
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref?.startsWith("#/")) {
      const resolved = value.$ref.slice(2).split("/").reduce((node, key) => node?.[key], document);
      assert.notEqual(resolved, undefined, value.$ref);
    }
    Object.values(value).forEach(visit);
  }
  visit(document);
});

test("tag edits require the observed timestamp and deletion uses a timestamp If-Match", () => {
  const create = schema("CreateTagRequest");
  const update = schema("UpdateTagRequest");
  assert.equal(create({ name: "Quente", color: "#3b82f6" }), true);
  assert.equal(create({ name: "Quente", color: "#fff" }), false);
  assert.equal(update({ name: "Quente", color: "#3b82f6" }), false);
  assert.equal(update({ name: "Quente", color: "#3b82f6", expected_updated_at: UPDATED_AT }), true);
  assert.equal(update({ name: "Quente", color: "#3b82f6", expected_updated_at: "invalid" }), false);
  const operation = document.paths["/v1/tags/{id}"].delete;
  assert.ok(operation.parameters.some(({ $ref }) => $ref === "#/components/parameters/TagRevisionIfMatchHeader"));
  const header = document.components.parameters.TagRevisionIfMatchHeader;
  assert.equal(header.required, true);
  const validHeader = validator.compile(header.schema);
  assert.equal(validHeader(`"${UPDATED_AT}"`), true);
  assert.equal(validHeader("*"), false);
  assert.equal(validHeader(UPDATED_AT), false);
  assert.ok(operation.responses["409"]);
});

test("tag usage returns reviewed category counts and cannot expose configuration names", () => {
  const usage = schema("TagUsageResponse");
  const data = { updated_at: UPDATED_AT, lead_count: 3, usages: [{ kind: "distribution_rule", count: 2 }] };
  assert.equal(usage({ data }), true);
  assert.equal(usage({ data: { ...data, usages: [{ kind: "distribution_rule", count: 2, name: "Private queue" }] } }), false);
  assert.equal(usage({ data: { ...data, usages: [{ kind: "distribution_rule", count: -1 }] } }), false);
  assert.equal(document.paths["/v1/tags/{id}/usage"].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/TagUsageResponse");
  assert.ok(document.components.schemas.Tag.required.includes("updated_at"));
});

test("team and queue creation require a UUID attempt header and keep it out of JSON bodies", () => {
  const header = document.components.parameters.ManagementIdempotencyKeyHeader;
  const validHeader = validator.compile(header.schema);
  assert.equal(header.required, true);
  assert.equal(validHeader(ID), true);
  assert.equal(validHeader("request-1"), false);
  for (const path of ["/v1/teams", "/v1/round-robins"]) {
    const create = document.paths[path].post;
    assert.ok(create.parameters.some(({ $ref }) => $ref === "#/components/parameters/ManagementIdempotencyKeyHeader"), path);
    assert.ok(create.responses["409"], path);
  }
  assert.equal(schema("CreateTeamRequest")({ name: "Equipe", IdempotencyKey: ID }), false);
  assert.equal(schema("CreateRoundRobinRequest")({ name: "Fila", expectedRevision: REVISION }), false);
  assert.equal(schema("CreateRoundRobinRequest")({ name: "Fila" }), true);
});

test("availability mutations and snapshots bind schedules to the team revision", () => {
  const day = { team_member_id: ID, day_of_week: 0, is_all_day: true, is_active: true };
  const mutate = schema("MemberAvailabilityMutationRequest");
  assert.equal(mutate(day), false);
  assert.equal(mutate({ ...day, expected_revision: REVISION }), true);
  const week = { availability: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, is_all_day: true, is_active: true })) };
  assert.equal(schema("ReplaceMemberAvailabilityRequest")(week), false);
  assert.equal(schema("ReplaceMemberAvailabilityRequest")({ ...week, expected_revision: REVISION }), true);
  assert.equal(schema("MemberAvailabilitySnapshot")({ data: [], revision: REVISION }), true);
  assert.equal(schema("MemberAvailabilitySnapshot")({ data: [] }), false);
  assert.deepEqual(document.components.schemas.MemberAvailabilityListResponse.required, ["data"]);
  assert.equal(document.components.schemas.MemberAvailabilityResponse.properties.revision.$ref, "#/components/schemas/ManagementRevision");
  for (const method of ["get", "put"]) {
    assert.equal(document.paths["/v1/team-members/{id}/availability"][method].responses["200"].content["application/json"].schema.$ref, "#/components/schemas/MemberAvailabilitySnapshot");
  }
  const offset = document.paths["/v1/teams/{id}/history"].get.parameters.find((item) => item.name === "offset");
  assert.equal(offset.schema.default, 0);
  assert.equal(offset.schema.maximum, 1_000_000);
});

test("queue and child PATCH requests require a revision and at least one real change", () => {
  for (const [name, change] of [
    ["UpdateRoundRobinRequest", { name: "Fila" }],
    ["UpdateRoundRobinRuleRequest", { priority: 3 }],
    ["UpdateRoundRobinMemberRequest", { weight: 2 }],
  ]) {
    const valid = schema(name);
    assert.equal(valid(change), false, name);
    assert.equal(valid({ expectedRevision: REVISION }), false, name);
    assert.equal(valid({ expectedRevision: REVISION, ...change }), true, name);
    assert.equal(valid({ expectedRevision: Number.MAX_SAFE_INTEGER + 1, ...change }), false, name);
  }
  assert.equal(schema("CreateRoundRobinRuleRequest")({ expectedRevision: REVISION, matchType: "all", matchValue: "" }), true);
  assert.equal(schema("CreateRoundRobinMemberRequest")({ expectedRevision: REVISION, userId: ID }), true);
  assert.equal(schema("CreateRoundRobinMemberRequest")({ userId: ID }), false);
  assert.equal(document.components.schemas.RoundRobinRule.properties.queueRevision.$ref, "#/components/schemas/ManagementRevision");
  assert.equal(document.components.schemas.RoundRobinMember.properties.queueRevision.$ref, "#/components/schemas/ManagementRevision");
});

test("queue deletes use the parent aggregate If-Match for queues, rules and members", () => {
  const validHeader = validator.compile(document.components.parameters.ManagementRevisionIfMatchHeader.schema);
  assert.equal(validHeader('"12"'), true);
  for (const invalid of ["12", 'W/"12"', '"0"', "*"]) assert.equal(validHeader(invalid), false);
  for (const path of ["/v1/round-robins/{id}", "/v1/round-robin-rules/{id}", "/v1/round-robin-members/{id}"]) {
    const operation = document.paths[path].delete;
    assert.ok(operation.parameters.some(({ $ref }) => $ref === "#/components/parameters/ManagementRevisionIfMatchHeader"), path);
    assert.ok(operation.responses["409"], path);
    assert.ok(operation.responses["428"], path);
  }
});

test("queue inline children preserve identity and explicit condition priority", () => {
  const valid = schema("UpdateRoundRobinRequest");
  const request = { expectedRevision: REVISION, conditions: [{ id: "condition-1", type: "tag", values: [ID], priority: 23 }], rules: [{ id: ID, matchType: "all", matchValue: "" }], members: [{ id: ID, type: "user", entityId: ID }] };
  assert.equal(valid(request), true);
  assert.equal(valid({ ...request, conditions: [{ ...request.conditions[0], priority: -1 }] }), false);
  assert.equal(valid({ ...request, conditions: [{ ...request.conditions[0], priority: 2147483647 }] }), true);
  assert.equal(valid({ ...request, conditions: [{ ...request.conditions[0], priority: 2147483648 }] }), false);
  assert.equal(valid({ ...request, rules: [{ ...request.rules[0], priority: 2147483648 }] }), false);
  assert.equal(schema("UpdateRoundRobinRuleRequest")({ expectedRevision: REVISION, priority: 2147483647 }), true);
  assert.equal(schema("UpdateRoundRobinRuleRequest")({ expectedRevision: REVISION, priority: 2147483648 }), false);
});

test("queue rules transport 17 and 100 tags and preserve identified legacy snapshots", () => {
  const inline = schema("RoundRobinRuleInput");
  const create = schema("CreateRoundRobinRuleRequest");
  for (const count of [17, 100]) {
    const matchValue = Array.from({ length: count }, () => ID).join(",");
    assert.equal(inline({ matchType: "tag", matchValue }), true, `${count} tags in aggregate`);
    assert.equal(create({ expectedRevision: REVISION, matchType: "tag", matchValue }), true, `${count} tags on child route`);
  }
  const maximum = "x".repeat(18_099);
  assert.equal(inline({ matchType: "campaign_contains", matchValue: maximum }), true);
  assert.equal(create({ expectedRevision: REVISION, matchType: "campaign_contains", matchValue: maximum }), true);
  const legacy = `${maximum}x`;
  assert.equal(inline({ matchType: "campaign_contains", matchValue: legacy }), false);
  assert.equal(create({ expectedRevision: REVISION, matchType: "campaign_contains", matchValue: legacy }), false);
  // Identity lets the backend compare the matcher with the locked persisted row;
  // the schema alone cannot authorize that exception for an invented or changed ID.
  assert.equal(inline({ id: ID, matchType: "campaign_contains", matchValue: legacy }), true);
  assert.equal(schema("UpdateRoundRobinRuleRequest")({ expectedRevision: REVISION, matchValue: legacy }), true);
});

test("member creates preserve explicit inactivity and positions fit PostgreSQL int4", () => {
  const create = schema("CreateRoundRobinMemberRequest");
  const update = schema("UpdateRoundRobinMemberRequest");
  const base = { expectedRevision: REVISION, userId: ID, isActive: false };
  assert.equal(create(base), true);
  for (const position of [0, 2_147_483_647]) {
    assert.equal(create({ ...base, position }), true);
    assert.equal(update({ expectedRevision: REVISION, position }), true);
  }
  for (const position of [-1, 2_147_483_648, 0.5]) {
    assert.equal(create({ ...base, position }), false);
    assert.equal(update({ expectedRevision: REVISION, position }), false);
  }
});

test("queue history supports bounded offset pagination without changing its data envelope", () => {
  const history = document.paths["/v1/round-robins/{id}/history"].get;
  const offset = history.parameters.find((item) => item.name === "offset");
  const limit = history.parameters.find((item) => item.name === "limit");
  const validOffset = validator.compile(offset.schema);
  assert.equal(validOffset(0), true);
  assert.equal(validOffset(1_000_000), true);
  assert.equal(validOffset(-1), false);
  assert.equal(validOffset(1_000_001), false);
  assert.equal(offset.schema.default, 0);
  assert.equal(limit.schema.maximum, 100);
  assert.equal(history.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/DistributionQueueHistoryListResponse");
});
