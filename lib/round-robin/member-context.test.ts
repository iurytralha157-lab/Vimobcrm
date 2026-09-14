import assert from "node:assert/strict";
import test from "node:test";

import {
  hydrateQueueMembers,
  queueIgnoresAvailability,
  resolveDirectUserTeamContext,
} from "./member-context";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_A = "22222222-2222-4222-8222-222222222222";
const TEAM_B = "33333333-3333-4333-8333-333333333333";

test("hidrata membro direto antes da equipe e preserva contexto, peso e ordem", () => {
  const members = hydrateQueueMembers(
    [
      {
        id: "44444444-4444-4444-8444-444444444444",
        user_id: USER_ID,
        team_id: TEAM_A,
        weight: 27,
        user: { name: "Corretora A" },
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        team_id: TEAM_B,
        weight: 9,
      },
    ],
    [
      { id: TEAM_A, name: "Equipe A", members: [{ user_id: USER_ID }] },
      { id: TEAM_B, name: "Equipe B", members: [] },
    ],
  );

  assert.deepEqual(members, [
    {
      id: "44444444-4444-4444-8444-444444444444",
      type: "user",
      entityId: USER_ID,
      teamId: TEAM_A,
      weight: 27,
      name: "Corretora A",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      type: "team",
      entityId: TEAM_B,
      weight: 9,
      name: "Equipe B",
    },
  ]);
});

test("mantem usuario direto sem equipe por padrao", () => {
  assert.deepEqual(resolveDirectUserTeamContext([TEAM_A], undefined), {
    status: "resolved",
  });
});

test("permite usuario direto mesmo quando pertence a varias equipes", () => {
  assert.deepEqual(
    resolveDirectUserTeamContext([TEAM_A, TEAM_B], undefined),
    { status: "resolved" },
  );
  assert.deepEqual(
    resolveDirectUserTeamContext([TEAM_A, TEAM_B], TEAM_B),
    { status: "resolved", teamId: TEAM_B },
  );
});

test("permite usuario direto que nao pertence a equipe", () => {
  assert.deepEqual(resolveDirectUserTeamContext([], undefined), {
    status: "resolved",
  });
});

test("le o bypass legado com a mesma semantica do backend", () => {
  assert.equal(queueIgnoresAvailability(true), true);
  assert.equal(queueIgnoresAvailability(" yes "), true);
  assert.equal(queueIgnoresAvailability("false"), false);
  assert.equal(queueIgnoresAvailability(undefined), false);
});

test("rejeita contexto de equipe que nao pertence ao usuario", () => {
  assert.deepEqual(
    resolveDirectUserTeamContext([TEAM_A], TEAM_B),
    { status: "unavailable" },
  );
});
