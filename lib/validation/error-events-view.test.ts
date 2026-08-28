import assert from "node:assert/strict";
import test from "node:test";

import {
  clampErrorEventsPage,
  getErrorEventsPageCount,
  getErrorEventsPageRange,
  getSafeErrorEventUrl,
  groupErrorEvents,
  type GroupableErrorEvent,
} from "../admin/error-events-view";
import {
  apiErrorEventResponseSchema,
  errorEventFiltersSchema,
} from "./auxiliary";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function event(overrides: Partial<GroupableErrorEvent>): GroupableErrorEvent {
  return {
    id: FIRST_ID,
    fingerprint: "same-fingerprint",
    createdAt: "2026-08-16T10:00:00.000Z",
    ...overrides,
  };
}

test("agrupamento mantém uma ocorrência aberta acionável quando a mais nova já foi resolvida", () => {
  const olderOpen = event({ id: FIRST_ID });
  const newerResolved = event({
    id: SECOND_ID,
    createdAt: "2026-08-16T11:00:00.000Z",
    resolvedAt: "2026-08-16T11:05:00.000Z",
  });

  const [group] = groupErrorEvents([olderOpen, newerResolved]);

  assert.equal(group.count, 2);
  assert.equal(group.unresolvedCount, 1);
  assert.equal(group.latest.id, SECOND_ID);
  assert.equal(group.latestUnresolved?.id, FIRST_ID);
});

test("paginação limita página e intervalo aos dados disponíveis", () => {
  assert.equal(getErrorEventsPageCount(101, 50), 3);
  assert.equal(clampErrorEventsPage(9, 101, 50), 3);
  assert.deepEqual(
    getErrorEventsPageRange({
      page: 3,
      pageSize: 50,
      total: 101,
      visibleCount: 1,
    }),
    { from: 101, to: 101 },
  );
  assert.deepEqual(
    getErrorEventsPageRange({
      page: 1,
      pageSize: 50,
      total: 0,
      visibleCount: 0,
    }),
    { from: 0, to: 0 },
  );
});

test("link de ocorrência aceita somente HTTP ou HTTPS absoluto", () => {
  assert.equal(
    getSafeErrorEventUrl("https://crm.example.com/leads/123"),
    "https://crm.example.com/leads/123",
  );
  assert.equal(getSafeErrorEventUrl("javascript:alert(1)"), null);
  assert.equal(getSafeErrorEventUrl("data:text/html,unsafe"), null);
  assert.equal(getSafeErrorEventUrl("https://user:secret@example.com"), null);
  assert.equal(getSafeErrorEventUrl("/rota-interna"), null);
});

test("filtros de eventos respeitam os mesmos limites do backend", () => {
  assert.equal(
    errorEventFiltersSchema.safeParse({
      limit: 200,
      offset: 100_000,
      search: "a".repeat(120),
      fingerprint: "f".repeat(160),
    }).success,
    true,
  );
  assert.equal(errorEventFiltersSchema.safeParse({ limit: 201 }).success, false);
  assert.equal(errorEventFiltersSchema.safeParse({ offset: 100_001 }).success, false);
  assert.equal(
    errorEventFiltersSchema.safeParse({ search: "a".repeat(121) }).success,
    false,
  );
  assert.equal(
    errorEventFiltersSchema.safeParse({ fingerprint: "f".repeat(161) }).success,
    false,
  );
});

test("resposta valida todos os campos exibidos pela tela administrativa", () => {
  const validResponse = {
    data: {
      id: FIRST_ID,
      organizationId: SECOND_ID,
      source: "api",
      severity: "critical",
      message: "Falha operacional",
      httpStatus: 503,
      path: "/v1/leads",
      fingerprint: "fingerprint-1",
      url: "https://crm.example.com/leads",
      browserContext: {},
      metadata: {},
      createdAt: "2026-08-16T10:00:00.000Z",
    },
  };

  assert.equal(apiErrorEventResponseSchema.safeParse(validResponse).success, true);
  assert.equal(
    apiErrorEventResponseSchema.safeParse({
      data: { ...validResponse.data, httpStatus: 999 },
    }).success,
    false,
  );
  assert.equal(
    apiErrorEventResponseSchema.safeParse({
      data: { ...validResponse.data, organizationId: "outra-organizacao" },
    }).success,
    false,
  );
});
