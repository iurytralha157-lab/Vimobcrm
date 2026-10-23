import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";

import type { Team } from "@/lib/api/teams";
import {
  cacheTeamEditorSnapshot,
  loadConsistentTeamEditorSnapshot,
  observeTeamCache,
} from "./team-editor-snapshot";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_A = "22222222-2222-4222-8222-222222222222";
const MEMBER_B = "33333333-3333-4333-8333-333333333333";

function team(revision: number, memberIds: string[]): Team {
  return {
    id: TEAM_ID,
    name: "Equipe QA",
    organization_id: "44444444-4444-4444-8444-444444444444",
    created_at: "2026-10-09T12:00:00Z",
    revision,
    members: memberIds.map((id) => ({
      id,
      team_id: TEAM_ID,
      user_id: id,
      created_at: "2026-10-09T12:00:00Z",
    })),
  };
}

test("retries when the team revision changes between team and availability reads", async () => {
  const reads = [team(1, [MEMBER_A]), team(2, [MEMBER_A]), team(2, [MEMBER_B]), team(2, [MEMBER_B])];
  const requestedMembers: string[][] = [];
  const snapshot = await loadConsistentTeamEditorSnapshot(
    TEAM_ID,
    async () => {
      const next = reads.shift();
      assert.ok(next);
      return next;
    },
    async (ids) => {
      requestedMembers.push(ids);
      return [];
    },
  );

  assert.equal(snapshot.team.revision, 2);
  assert.deepEqual(snapshot.team.members?.map((member) => member.id), [MEMBER_B]);
  assert.deepEqual(requestedMembers, [[MEMBER_A], [MEMBER_B]]);
});

test("retries when visible members change without a revision bump", async () => {
  const reads = [team(5, [MEMBER_A]), team(5, [MEMBER_B]), team(5, [MEMBER_B]), team(5, [MEMBER_B])];
  const requestedMembers: string[][] = [];
  const snapshot = await loadConsistentTeamEditorSnapshot(
    TEAM_ID,
    async () => {
      const next = reads.shift();
      assert.ok(next);
      return next;
    },
    async (ids) => {
      requestedMembers.push(ids);
      return [];
    },
  );

  assert.deepEqual(snapshot.team.members?.map((member) => member.id), [MEMBER_B]);
  assert.deepEqual(requestedMembers, [[MEMBER_A], [MEMBER_B]]);
});

test("rejects a snapshot that changes on both attempts", async () => {
  const reads = [team(1, [MEMBER_A]), team(2, [MEMBER_A]), team(2, [MEMBER_B]), team(3, [MEMBER_B])];
  await assert.rejects(
    loadConsistentTeamEditorSnapshot(
      TEAM_ID,
      async () => {
        const next = reads.shift();
        assert.ok(next);
        return next;
      },
      async () => [],
    ),
    /A equipe mudou durante a recarga/,
  );
  assert.equal(reads.length, 0);
});

test("a delayed team GET cannot replace a newer editor snapshot in the cache", async () => {
  const queryClient = new QueryClient();
  const teamKey = ["team", "org-qa", TEAM_ID];
  let resolveOldGet!: (value: Team) => void;
  const oldGet = new Promise<Team>((resolve) => { resolveOldGet = resolve; });
  const pendingGet = queryClient.fetchQuery({
    queryKey: teamKey,
    queryFn: () => oldGet,
    retry: false,
  }).catch((error: unknown) => error);
  const observedCache = observeTeamCache(queryClient, "org-qa", TEAM_ID);

  await cacheTeamEditorSnapshot(queryClient, "org-qa", TEAM_ID, {
    team: team(2, [MEMBER_B]),
    availability: [],
  }, observedCache);
  resolveOldGet(team(1, [MEMBER_A]));
  await pendingGet;

  assert.equal(queryClient.getQueryData<Team>(teamKey)?.revision, 2);
  assert.deepEqual(queryClient.getQueryData<Team>(teamKey)?.members?.map((member) => member.id), [MEMBER_B]);
});

test("an older snapshot cannot replace a newer cached team", async () => {
  const queryClient = new QueryClient();
  const teamKey = ["team", "org-qa", TEAM_ID];
  queryClient.setQueryData(teamKey, team(3, [MEMBER_B]));
  const observedCache = observeTeamCache(queryClient, "org-qa", TEAM_ID);

  await assert.rejects(
    cacheTeamEditorSnapshot(queryClient, "org-qa", TEAM_ID, {
      team: team(2, [MEMBER_A]),
      availability: [],
    }, observedCache),
    /A equipe mudou durante a recarga/,
  );
  assert.equal(queryClient.getQueryData<Team>(teamKey)?.revision, 3);
});

test("a preexisting roster at the same revision is replaced by the confirmed snapshot", async () => {
  const queryClient = new QueryClient();
  const teamKey = ["team", "org-qa", TEAM_ID];
  queryClient.setQueryData(teamKey, team(5, [MEMBER_A]));
  const observedCache = observeTeamCache(queryClient, "org-qa", TEAM_ID);

  await cacheTeamEditorSnapshot(queryClient, "org-qa", TEAM_ID, {
    team: team(5, [MEMBER_B]),
    availability: [],
  }, observedCache);

  assert.deepEqual(queryClient.getQueryData<Team>(teamKey)?.members?.map((member) => member.id), [MEMBER_B]);
});

test("a roster published during loading is preserved when the snapshot has the same revision", async () => {
  const queryClient = new QueryClient();
  const teamKey = ["team", "org-qa", TEAM_ID];
  queryClient.setQueryData(teamKey, team(5, [MEMBER_A]));
  let resolveOldGet!: (value: Team) => void;
  const oldGet = new Promise<Team>((resolve) => { resolveOldGet = resolve; });
  const pendingGet = queryClient.fetchQuery({
    queryKey: teamKey,
    queryFn: () => oldGet,
    retry: false,
  }).catch((error: unknown) => error);
  const observedCache = observeTeamCache(queryClient, "org-qa", TEAM_ID);
  queryClient.setQueryData(teamKey, team(5, [MEMBER_B]));

  await assert.rejects(
    cacheTeamEditorSnapshot(queryClient, "org-qa", TEAM_ID, {
      team: team(5, [MEMBER_A]),
      availability: [],
    }, observedCache),
    /Os membros da equipe mudaram durante a recarga/,
  );
  resolveOldGet(team(5, [MEMBER_A]));
  await pendingGet;
  assert.deepEqual(queryClient.getQueryData<Team>(teamKey)?.members?.map((member) => member.id), [MEMBER_B]);
});
