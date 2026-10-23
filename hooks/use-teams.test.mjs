import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import { getGlobalSignOutSessionId } from "../lib/auth/global-sign-out.ts";

function evaluate(relativePath, imports = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(compiled, { module: record, exports: record.exports, require(name) {
    if (!(name in imports)) throw new Error(`Unexpected real import: ${name}`);
    return imports[name];
  } });
  return record.exports;
}
const snapshotHelpers = evaluate("../lib/teams/team-editor-snapshot.ts");
const org = "11111111-1111-4111-8111-111111111111";
const teamId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const team = { id: teamId, organization_id: org, revision: 1, members: [{ id: memberId }] };

function harness(api) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const actor = { user: "synthetic-user", session: "session-a" };
  const capture = (signal) => ({ expectedUserId: actor.user, expectedSessionId: actor.session, signal });
  const hooks = evaluate("./use-teams.ts", {
    "@tanstack/react-query": { useQueryClient: () => queryClient, useMutation: (options) => options, useQuery: (options) => options, useInfiniteQuery: (options) => options },
    "@/lib/api/teams": { teamsAPI: api },
    sonner: { toast: { success() {} } },
    react: { useRef: (value) => ({ current: value }), useEffect: (callback) => { callback(); } },
    "@/contexts/AuthContext": { useAuth: () => ({ activeOrganization: { organizationId: org } }) },
    "@/lib/pipeline-reliability": { shouldRetryPipelineQuery: () => false },
    "@/lib/auth/global-sign-out": { getGlobalSignOutSessionId },
    "@/lib/teams/team-editor-snapshot": snapshotHelpers,
    "@/lib/api/management-request": { captureManagementRequestIntent: capture, assertManagementRequestIntent(intent) {
      if (intent.expectedUserId !== actor.user || intent.expectedSessionId !== actor.session) throw new Error("identity changed");
    } },
  });
  return { hooks, actor, capture, queryClient };
}

test("create and update forward the original gesture intent without adding it to the update body", async () => {
  const calls = [];
  const scope = harness({ createTeam: async (...args) => { calls.push(args); return team; }, updateTeam: async (...args) => { calls.push(args); return team; } });
  try {
    const intent = scope.capture(new AbortController().signal);
    const input = { name: "Equipe", members: [] };
    await scope.hooks.useCreateTeam().mutationFn({ input, organizationId: org, userId: scope.actor.user, idempotencyKey: "key", intent });
    assert.equal(calls[0][0], input);
    assert.equal(calls[0][4], intent);
    await scope.hooks.useUpdateTeam().mutationFn({ id: teamId, organizationId: org, expected_revision: 1, name: "Equipe", intent });
    assert.equal(calls[1][2], intent);
    assert.equal(calls[1][1], org);
    assert.equal(calls[1][0].expected_revision, 1);
    assert.equal("intent" in calls[1][0], false);
    assert.equal("organizationId" in calls[1][0], false);
  } finally { scope.queryClient.clear(); }
});

test("a management update preserves the narrow catalogs of both sessions while invalidating every team view", () => {
  const scope = harness({});
  const managementKeys = [["teams", org, { includeInactive: false }], ["teams", org, { includeInactive: true }]];
  const catalogKeys = ["session-a", "session-b"].map(sid => ["teams", org, "filter-catalog", "synthetic-user", sid, { includeInactive: false }]);
  const narrow = [{ id: teamId, name: "Equipe", organization_id: org, members: [{ user_id: "synthetic-user", is_leader: true }] }];
  const full = { ...team, name: "Atualizada", revision: 2, created_by: "private-actor", members: [{ id: memberId, user: { email: "synthetic@example.invalid" } }] };
  try {
    for (const key of managementKeys) scope.queryClient.setQueryData(key, [team]);
    for (const key of catalogKeys) scope.queryClient.setQueryData(key, narrow);
    scope.hooks.useUpdateTeam().onSuccess(full, { id: teamId, organizationId: org });
    for (const key of managementKeys) assert.deepEqual(scope.queryClient.getQueryData(key), [full]);
    for (const key of catalogKeys) assert.deepEqual(scope.queryClient.getQueryData(key), narrow);
    for (const key of [...managementKeys, ...catalogKeys]) assert.equal(scope.queryClient.getQueryState(key).isInvalidated, true);
  } finally { scope.queryClient.clear(); }
});

test("reload propagates its signal and publishes the confirmed consistent snapshot", async () => {
  const seenSignals = [];
  const availability = [{ id: "availability", team_member_id: memberId }];
  const scope = harness({ getTeam: async (_id, _org, signal) => { seenSignals.push(signal); return team; }, listMemberAvailability: async (options) => { seenSignals.push(options.signal); return availability; } });
  try {
    const controller = new AbortController();
    const result = await scope.hooks.useReloadTeamEditor()(teamId, scope.capture(controller.signal));
    assert.equal(result.team, team);
    assert.equal(result.availability, availability);
    assert.equal(seenSignals.length, 3);
    assert.ok(seenSignals.every((signal) => signal === controller.signal));
    assert.equal(scope.queryClient.getQueryData(["team-editor-snapshot", org, teamId]), result);
  } finally { scope.queryClient.clear(); }
});

test("session change or abort during reload cannot hydrate a snapshot or continue subsequent reads", async () => {
  for (const mode of ["session", "actor", "abort"]) {
    let resolveRead;
    let readCalls = 0;
    const pending = new Promise((resolve) => { resolveRead = resolve; });
    const scope = harness({ getTeam: async () => { readCalls += 1; return pending; }, listMemberAvailability: async () => { throw new Error("late availability read"); } });
    try {
      const controller = new AbortController();
      const request = scope.hooks.useReloadTeamEditor()(teamId, scope.capture(controller.signal));
      if (mode === "session") scope.actor.session = "session-b";
      if (mode === "actor") scope.actor.user = "other-user";
      if (mode === "abort") controller.abort();
      resolveRead(team);
      await assert.rejects(request, mode === "abort" ? (error) => error.name === "AbortError" : /identity changed/);
      assert.equal(readCalls, 1);
      assert.equal(scope.queryClient.getQueryData(["team", org, teamId]), undefined);
      assert.equal(scope.queryClient.getQueryData(["team-editor-snapshot", org, teamId]), undefined);
    } finally { scope.queryClient.clear(); }
  }
});

test("identity change while cancelling the scoped cache read cannot publish the completed snapshot", async () => {
  for (const mode of ["session", "actor", "abort"]) {
    let releaseCancellation;
    let reachedCancellation;
    const cancellation = new Promise((resolve) => { releaseCancellation = resolve; });
    const reached = new Promise((resolve) => { reachedCancellation = resolve; });
    const scope = harness({ getTeam: async () => team, listMemberAvailability: async () => [] });
    scope.queryClient.cancelQueries = async () => { reachedCancellation(); await cancellation; };
    try {
      const controller = new AbortController();
      const request = scope.hooks.useReloadTeamEditor()(teamId, scope.capture(controller.signal));
      await reached;
      if (mode === "session") scope.actor.session = "session-b";
      if (mode === "actor") scope.actor.user = "other-user";
      if (mode === "abort") controller.abort();
      releaseCancellation();
      await assert.rejects(request, mode === "abort" ? (error) => error.name === "AbortError" : /identity changed/);
      assert.equal(scope.queryClient.getQueryData(["team", org, teamId]), undefined);
      assert.equal(scope.queryClient.getQueryData(["team-members-availability", org, [memberId]]), undefined);
      assert.equal(scope.queryClient.getQueryData(["team-editor-snapshot", org, teamId]), undefined);
    } finally { scope.queryClient.clear(); }
  }
});
