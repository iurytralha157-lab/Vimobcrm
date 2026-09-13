import assert from "node:assert/strict";
import test from "node:test";

import {
  apiOrganizationPresenceResponseSchema,
  userActivitySessionMutationInputSchema,
} from "./presence";

const validResponse = {
  data: {
    users: [
      {
        user_id: "11111111-1111-4111-8111-111111111111",
        name: "Ana Souza",
        avatar_url: "https://cdn.example.test/users/ana.png",
        member_role: "admin",
        is_team_leader: false,
        presence_status: "online",
        idle_since_at: null,
        last_seen_at: "2026-09-02T15:30:00Z",
      },
    ],
    counts: {
      total: 1,
      online: 1,
      idle: 0,
      offline: 0,
    },
    generated_at: "2026-09-02T15:30:05Z",
  },
};

test("aceita o contrato exato da lista de presenca", () => {
  assert.equal(
    apiOrganizationPresenceResponseSchema.safeParse(validResponse).success,
    true,
  );
});

test("aceita o inicio da ausencia e rejeita timestamps invalidos", () => {
  const idleResponse = {
    ...validResponse,
    data: {
      ...validResponse.data,
      users: [
        {
          ...validResponse.data.users[0],
          presence_status: "idle",
          idle_since_at: "2026-09-02T15:20:00Z",
        },
      ],
    },
  };

  assert.equal(
    apiOrganizationPresenceResponseSchema.safeParse(idleResponse).success,
    true,
  );
  assert.equal(
    apiOrganizationPresenceResponseSchema.safeParse({
      ...idleResponse,
      data: {
        ...idleResponse.data,
        users: [
          {
            ...idleResponse.data.users[0],
            idle_since_at: "ontem",
          },
        ],
      },
    }).success,
    false,
  );
});

test("rejeita status e campos obrigatorios invalidos", () => {
  assert.equal(
    apiOrganizationPresenceResponseSchema.safeParse({
      ...validResponse,
      data: {
        ...validResponse.data,
        users: [
          {
            ...validResponse.data.users[0],
            presence_status: "away",
          },
        ],
      },
    }).success,
    false,
  );

  const userWithoutRole = {
    user_id: validResponse.data.users[0].user_id,
    name: validResponse.data.users[0].name,
    avatar_url: validResponse.data.users[0].avatar_url,
    is_team_leader: validResponse.data.users[0].is_team_leader,
    presence_status: validResponse.data.users[0].presence_status,
    idle_since_at: validResponse.data.users[0].idle_since_at,
    last_seen_at: validResponse.data.users[0].last_seen_at,
  };
  assert.equal(
    apiOrganizationPresenceResponseSchema.safeParse({
      ...validResponse,
      data: {
        ...validResponse.data,
        users: [userWithoutRole],
      },
    }).success,
    false,
  );

  const userWithoutLeaderFlag = {
    user_id: validResponse.data.users[0].user_id,
    name: validResponse.data.users[0].name,
    avatar_url: validResponse.data.users[0].avatar_url,
    member_role: validResponse.data.users[0].member_role,
    presence_status: validResponse.data.users[0].presence_status,
    idle_since_at: validResponse.data.users[0].idle_since_at,
    last_seen_at: validResponse.data.users[0].last_seen_at,
  };
  assert.equal(
    apiOrganizationPresenceResponseSchema.safeParse({
      ...validResponse,
      data: {
        ...validResponse.data,
        users: [userWithoutLeaderFlag],
      },
    }).success,
    false,
  );

});

test("normaliza resposta anterior sem idle_since_at", () => {
  const userWithoutIdleSince = {
    user_id: validResponse.data.users[0].user_id,
    name: validResponse.data.users[0].name,
    avatar_url: validResponse.data.users[0].avatar_url,
    member_role: validResponse.data.users[0].member_role,
    is_team_leader: validResponse.data.users[0].is_team_leader,
    presence_status: validResponse.data.users[0].presence_status,
    last_seen_at: validResponse.data.users[0].last_seen_at,
  };
  const parsedLegacyResponse = apiOrganizationPresenceResponseSchema.safeParse({
    ...validResponse,
    data: {
      ...validResponse.data,
      users: [userWithoutIdleSince],
    },
  });
  assert.equal(parsedLegacyResponse.success, true);
  assert.equal(
    parsedLegacyResponse.success
      ? parsedLegacyResponse.data.data.users[0].idle_since_at
      : undefined,
    null,
  );
});

test("descarta campos aditivos sem afrouxar os campos obrigatorios", () => {
  const parsed = apiOrganizationPresenceResponseSchema.parse({
    ...validResponse,
    data: {
      ...validResponse.data,
      users: [
        {
          ...validResponse.data.users[0],
          email: "ana@example.com",
          role: "admin",
        },
      ],
    },
  });

  assert.equal("email" in parsed.data.users[0], false);
  assert.equal("role" in parsed.data.users[0], false);
});

test("valida a mutacao minima e rejeita opcoes legadas do realtime", () => {
  const validMutation = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    sessionId: "session_12345678",
    status: "online",
  };

  assert.equal(
    userActivitySessionMutationInputSchema.safeParse(validMutation).success,
    true,
  );
  assert.equal(
    userActivitySessionMutationInputSchema.safeParse({
      ...validMutation,
      heartbeatMs: 60_000,
    }).success,
    false,
  );
});
