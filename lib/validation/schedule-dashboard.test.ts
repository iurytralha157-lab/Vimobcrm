import assert from "node:assert/strict";
import test from "node:test";

import {
  apiScheduleDashboardEventsResponseSchema,
  apiScheduleDashboardResponseSchema,
  scheduleDashboardEventsQuerySchema,
  scheduleDashboardQuerySchema,
} from "./schedule-dashboard";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const EVENT_ID = "00000000-0000-4000-8000-000000000002";
const LEAD_ID = "00000000-0000-4000-8000-000000000003";
const PROPERTY_ID = "00000000-0000-4000-8000-000000000004";

function createDashboardResponse() {
  return {
    data: {
      report_timezone: "America/Sao_Paulo",
      period: {
        date_from: "2026-09-01",
        date_to: "2026-09-30",
        date_basis: "start_time",
      },
      kpis: {
        total: 20,
        eligible: 17,
        appointment_eligible: 8,
        visits: 8,
        meetings: 4,
        calls: 3,
        open: 5,
        completed: 10,
        cancelled: 2,
        no_show: 3,
        overdue: 2,
        upcoming: 3,
        completion_rate: 58.82,
        no_show_rate: 37.5,
      },
      hourly: [] as Array<{
        hour: number;
        total: number;
        open: number;
        overdue: number;
        completed: number;
        cancelled: number;
        no_show: number;
      }>,
      daily: [
        {
          date: "2026-09-01",
          total: 2,
          open: 0,
          overdue: 0,
          completed: 1,
          cancelled: 0,
          no_show: 1,
        },
      ],
      weekly: [
        {
          week_start: "2026-09-01",
          week_end: "2026-09-07",
          total: 20,
          open: 5,
          completed: 10,
          cancelled: 2,
          no_show: 3,
          overdue: 2,
        },
      ],
      by_type: [{ key: "visit", count: 8 }],
      by_source: [{ key: "site", label: "Site", count: 7 }],
      by_outcome: [{ key: "visit_completed", count: 6 }],
      top_performers: [
        { user_id: USER_ID, name: "Ana", avatar_url: null, total: 10 },
      ],
      upcoming_events: [
        {
          id: EVENT_ID,
          title: "Visita ao imóvel",
          event_type: "visit",
          start_time: "2026-09-15T13:00:00Z",
          end_time: "2026-09-15T14:00:00Z",
          is_all_day: false,
          user_id: USER_ID,
          user_name: "Ana",
          user_avatar_url: null,
          lead_id: LEAD_ID,
          lead_name: "Cliente exemplo",
          property_id: PROPERTY_ID,
          property_title: "Apartamento Centro",
          property_code: "AP-104",
        },
      ],
      overdue_by_owner: [
        { user_id: USER_ID, name: "Ana", avatar_url: null, overdue: 2 },
      ],
      performer_ranking: [
        {
          user_id: USER_ID,
          name: "Ana",
          avatar_url: null,
          total: 12,
          eligible: 11,
          appointments: 8,
          appointment_eligible: 6,
          open: 1,
          completed: 10,
          no_show: 1,
          overdue: 0,
          completion_rate: 90.91,
          no_show_rate: 16.67,
        },
      ],
    },
  };
}

test("consulta da dashboard aceita filtros operacionais e limita o período", () => {
  const parsed = scheduleDashboardQuerySchema.parse({
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    dateBasis: "start_time",
    teamId: "all",
    userId: null,
    source: "  site  ",
    eventType: "VISIT",
    status: "OVERDUE",
  });

  assert.equal(parsed.dateBasis, "start_time");
  assert.equal(parsed.teamId, undefined);
  assert.equal(parsed.userId, undefined);
  assert.equal(parsed.source, "site");
  assert.equal(parsed.eventType, "visit");
  assert.equal(parsed.status, "overdue");
  assert.equal(
    scheduleDashboardQuerySchema.parse({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      status: "canceled",
    }).status,
    "cancelled",
  );
  assert.equal(
    scheduleDashboardQuerySchema.safeParse({
      dateFrom: "2025-01-01",
      dateTo: "2026-01-02",
    }).success,
    false,
  );
});

test("consulta paginada preserva filtros e aplica limites seguros", () => {
  const parsed = scheduleDashboardEventsQuerySchema.parse({
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    teamId: "all",
    userId: USER_ID,
    source: " site ",
    eventType: "VISIT",
    status: "CANCELED",
  });

  assert.equal(parsed.limit, 20);
  assert.equal(parsed.offset, 0);
  assert.equal(parsed.teamId, undefined);
  assert.equal(parsed.userId, USER_ID);
  assert.equal(parsed.source, "site");
  assert.equal(parsed.eventType, "visit");
  assert.equal(parsed.status, "cancelled");
  assert.equal(
    scheduleDashboardEventsQuerySchema.safeParse({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      limit: 101,
      offset: 0,
    }).success,
    false,
  );
});

test("contrato paginado retorna todos os dados operacionais do agendamento", () => {
  const parsed = apiScheduleDashboardEventsResponseSchema.parse({
    data: {
      items: [
        {
          id: EVENT_ID,
          title: "Visita ao imóvel",
          event_type: "visit",
          start_time: "2026-09-15T13:00:00Z",
          end_time: "2026-09-15T14:00:00Z",
          is_all_day: false,
          user_id: USER_ID,
          user_name: "Ana",
          user_avatar_url: null,
          lead_id: LEAD_ID,
          lead_name: "Cliente exemplo",
          property_id: PROPERTY_ID,
          property_title: "Apartamento Centro",
          property_code: "AP-104",
          status: "completed",
          outcome: "visit_completed",
          is_overdue: false,
        },
      ],
      total: 21,
      limit: 20,
      offset: 20,
      has_more: false,
    },
  }).data;

  assert.equal(parsed.items[0]?.status, "completed");
  assert.equal(parsed.items[0]?.outcome, "visit_completed");
  assert.equal(parsed.items[0]?.is_overdue, false);
  assert.equal(parsed.items[0]?.is_all_day, false);
  assert.equal(parsed.total, 21);
  assert.equal(parsed.has_more, false);
});

test("contrato de resposta preserva linhas legadas sem ampliar os filtros aceitos", () => {
  const legacyResponse = {
    data: {
      items: [
        {
          id: EVENT_ID,
          title: "Compromisso",
          event_type: "__unknown__",
          start_time: "2026-09-15T00:00:00Z",
          end_time: "2026-09-15T23:59:59.999Z",
          is_all_day: true,
          user_id: USER_ID,
          user_name: "Ana",
          user_avatar_url: null,
          lead_id: null,
          lead_name: null,
          property_id: null,
          property_title: null,
          property_code: null,
          status: "__unknown__",
          outcome: null,
          is_overdue: false,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      has_more: false,
    },
  };

  const parsed = apiScheduleDashboardEventsResponseSchema.parse(legacyResponse);
  assert.equal(parsed.data.items[0]?.event_type, "__unknown__");
  assert.equal(parsed.data.items[0]?.status, "__unknown__");
  assert.equal(parsed.data.items[0]?.is_all_day, true);

  assert.equal(
    scheduleDashboardEventsQuerySchema.safeParse({
      dateFrom: "2026-09-15",
      dateTo: "2026-09-15",
      eventType: "__unknown__",
    }).success,
    false,
  );
});

test("contrato horario exige 24 pontos ordenados apenas no recorte de um dia", () => {
  const singleDay = createDashboardResponse();
  singleDay.data.period.date_to = singleDay.data.period.date_from;
  singleDay.data.hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: hour === 10 ? 2 : 0,
    open: hour === 10 ? 1 : 0,
    overdue: 0,
    completed: hour === 10 ? 1 : 0,
    cancelled: 0,
    no_show: 0,
  }));

  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(singleDay).success,
    true,
  );

  singleDay.data.hourly[10]!.hour = 11;
  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(singleDay).success,
    false,
  );
});

test("contrato da dashboard preserva métricas reais e denominadores", () => {
  const parsed = apiScheduleDashboardResponseSchema.parse(
    createDashboardResponse(),
  ).data;

  assert.equal(parsed.kpis.open, 5);
  assert.equal(parsed.kpis.overdue, 2);
  assert.equal(parsed.kpis.upcoming, 3);
  assert.equal(parsed.kpis.no_show_rate, 37.5);
  assert.equal(parsed.kpis.eligible, 17);
  assert.equal(parsed.kpis.appointment_eligible, 8);
  assert.equal(parsed.performer_ranking[0]?.total, 12);
  assert.equal(parsed.performer_ranking[0]?.eligible, 11);
  assert.equal(parsed.upcoming_events[0]?.lead_name, "Cliente exemplo");
});

test("contrato rejeita campos operacionais ausentes ou inválidos", () => {
  const missingOpen = createDashboardResponse();
  const kpisWithoutOpen = { ...missingOpen.data.kpis } as Partial<
    typeof missingOpen.data.kpis
  >;
  delete kpisWithoutOpen.open;
  missingOpen.data.kpis = kpisWithoutOpen as typeof missingOpen.data.kpis;

  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(missingOpen).success,
    false,
  );

  const invalidRate = createDashboardResponse();
  invalidRate.data.kpis.no_show_rate = 101;
  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(invalidRate).success,
    false,
  );

  const mismatchedRate = createDashboardResponse();
  mismatchedRate.data.kpis.completion_rate = 50;
  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(mismatchedRate).success,
    false,
  );

  const invalidTimestamp = createDashboardResponse();
  invalidTimestamp.data.upcoming_events[0]!.start_time = "amanhã";
  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(invalidTimestamp).success,
    false,
  );

  const impossibleDenominator = createDashboardResponse();
  impossibleDenominator.data.kpis.eligible = 21;
  assert.equal(
    apiScheduleDashboardResponseSchema.safeParse(impossibleDenominator).success,
    false,
  );
});
