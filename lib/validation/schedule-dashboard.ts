import { z } from "zod";

import { apiEnvelopeSchema, nonNegativeIntegerSchema } from "./common";
import { scheduleOutcomeSchema } from "./schedule";

const finiteNumberSchema = z.number().finite();

function matchesDashboardRate(
  numerator: number,
  denominator: number,
  rate: number,
) {
  const expected = denominator > 0 ? (numerator / denominator) * 100 : 0;
  return Math.abs(expected - rate) <= 0.011;
}

export const scheduleDashboardCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Data inválida");

export const scheduleDashboardDateBasisSchema = z.enum([
  "start_time",
  "created_at",
  "completed_at",
]);

export const scheduleDashboardEventTypeSchema = z.enum([
  "call",
  "email",
  "meeting",
  "task",
  "message",
  "visit",
]);

export const scheduleDashboardReportedEventTypeSchema = z.union([
  scheduleDashboardEventTypeSchema,
  z.literal("__unknown__"),
]);

export const scheduleDashboardStatusSchema = z.enum([
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "overdue",
  "upcoming",
]);

function optionalQueryText(maxLength: number) {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return !normalized || normalized.toLowerCase() === "all"
      ? undefined
      : normalized;
  }, z.string().min(1).max(maxLength).optional());
}

function optionalQueryUUID() {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return !normalized || normalized.toLowerCase() === "all"
      ? undefined
      : normalized;
  }, z.string().uuid().optional());
}

function optionalQueryEnum<T extends z.ZodEnum<[string, ...string[]]>>(
  schema: T,
) {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === "all" ? undefined : normalized;
  }, schema.optional());
}

function optionalDashboardStatus() {
  return z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "all") return undefined;
    return normalized === "canceled" ? "cancelled" : normalized;
  }, scheduleDashboardStatusSchema.optional());
}

const scheduleDashboardQueryShape = {
  dateFrom: scheduleDashboardCalendarDateSchema,
  dateTo: scheduleDashboardCalendarDateSchema,
  dateBasis: scheduleDashboardDateBasisSchema.default("start_time"),
  teamId: optionalQueryUUID(),
  userId: optionalQueryUUID(),
  source: optionalQueryText(160),
  eventType: optionalQueryEnum(scheduleDashboardEventTypeSchema),
  status: optionalDashboardStatus(),
};

function validateDashboardDateRange(
  query: { dateFrom: string; dateTo: string },
  context: z.RefinementCtx,
) {
  const start = new Date(`${query.dateFrom}T00:00:00.000Z`);
  const end = new Date(`${query.dateTo}T00:00:00.000Z`);

  if (end < start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateTo"],
      message: "A data final deve ser igual ou posterior à inicial",
    });
    return;
  }

  if (end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateTo"],
      message: "O período não pode ultrapassar 366 dias",
    });
  }
}

export const scheduleDashboardQuerySchema = z
  .object(scheduleDashboardQueryShape)
  .strict()
  .superRefine(validateDashboardDateRange);

export const scheduleDashboardEventsQuerySchema = z
  .object({
    ...scheduleDashboardQueryShape,
    limit: z.number().int().min(1).max(100).default(20),
    offset: nonNegativeIntegerSchema.default(0),
  })
  .strict()
  .superRefine(validateDashboardDateRange);

const scheduleDashboardPeriodSchema = z
  .object({
    date_from: scheduleDashboardCalendarDateSchema,
    date_to: scheduleDashboardCalendarDateSchema,
    date_basis: scheduleDashboardDateBasisSchema,
  })
  .passthrough();

const scheduleDashboardKpisSchema = z
  .object({
    total: nonNegativeIntegerSchema,
    eligible: nonNegativeIntegerSchema,
    appointment_eligible: nonNegativeIntegerSchema,
    visits: nonNegativeIntegerSchema,
    meetings: nonNegativeIntegerSchema,
    calls: nonNegativeIntegerSchema,
    open: nonNegativeIntegerSchema,
    completed: nonNegativeIntegerSchema,
    cancelled: nonNegativeIntegerSchema,
    no_show: nonNegativeIntegerSchema,
    overdue: nonNegativeIntegerSchema,
    upcoming: nonNegativeIntegerSchema,
    completion_rate: finiteNumberSchema.min(0).max(100),
    no_show_rate: finiteNumberSchema.min(0).max(100),
  })
  .passthrough()
  .superRefine((kpis, context) => {
    const checks: Array<[boolean, keyof typeof kpis, string]> = [
      [
        kpis.eligible <= kpis.total,
        "eligible",
        "Base elegível maior que o total",
      ],
      [
        kpis.appointment_eligible <= kpis.visits + kpis.meetings,
        "appointment_eligible",
        "Base elegível de visitas e reuniões maior que o volume correspondente",
      ],
      [
        kpis.completed <= kpis.eligible,
        "completed",
        "Realizados maiores que a base elegível",
      ],
      [
        kpis.no_show <= kpis.appointment_eligible,
        "no_show",
        "No-shows maiores que a base elegível",
      ],
      [
        kpis.overdue <= kpis.open,
        "overdue",
        "Atrasos maiores que os compromissos em aberto",
      ],
      [
        kpis.upcoming <= kpis.open,
        "upcoming",
        "Próximos maiores que os compromissos em aberto",
      ],
      [
        matchesDashboardRate(
          kpis.completed,
          kpis.eligible,
          kpis.completion_rate,
        ),
        "completion_rate",
        "Taxa de realização incompatível com a base elegível",
      ],
      [
        matchesDashboardRate(
          kpis.no_show,
          kpis.appointment_eligible,
          kpis.no_show_rate,
        ),
        "no_show_rate",
        "Taxa de no-show incompatível com a base elegível",
      ],
    ];

    checks.forEach(([valid, path, message]) => {
      if (valid) return;
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    });
  });

const scheduleDashboardDailyPointSchema = z
  .object({
    date: scheduleDashboardCalendarDateSchema,
    total: nonNegativeIntegerSchema,
    open: nonNegativeIntegerSchema,
    overdue: nonNegativeIntegerSchema,
    completed: nonNegativeIntegerSchema,
    cancelled: nonNegativeIntegerSchema,
    no_show: nonNegativeIntegerSchema,
  })
  .passthrough();

const scheduleDashboardHourlyPointSchema = z
  .object({
    hour: z.number().int().min(0).max(23),
    total: nonNegativeIntegerSchema,
    open: nonNegativeIntegerSchema,
    overdue: nonNegativeIntegerSchema,
    completed: nonNegativeIntegerSchema,
    cancelled: nonNegativeIntegerSchema,
    no_show: nonNegativeIntegerSchema,
  })
  .passthrough();

const scheduleDashboardBreakdownSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    count: nonNegativeIntegerSchema,
  })
  .passthrough();

const scheduleDashboardSourceSchema = scheduleDashboardBreakdownSchema
  .extend({
    key: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(160),
  })
  .passthrough();

const scheduleDashboardTopPerformerSchema = z
  .object({
    user_id: z.string().trim().uuid(),
    name: z.string().trim().min(1).max(255),
    avatar_url: z.string().nullable(),
    total: nonNegativeIntegerSchema,
  })
  .passthrough();

const scheduleDashboardWeeklyPointSchema = z
  .object({
    week_start: scheduleDashboardCalendarDateSchema,
    week_end: scheduleDashboardCalendarDateSchema,
    total: nonNegativeIntegerSchema,
    open: nonNegativeIntegerSchema,
    completed: nonNegativeIntegerSchema,
    cancelled: nonNegativeIntegerSchema,
    no_show: nonNegativeIntegerSchema,
    overdue: nonNegativeIntegerSchema,
  })
  .passthrough();

const nullableDashboardText = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0 ? null : value,
    z.string().trim().min(1).max(maxLength).nullable(),
  );

export const scheduleDashboardUpcomingEventSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(255),
    event_type: scheduleDashboardReportedEventTypeSchema,
    start_time: z.string().datetime({ offset: true }),
    end_time: z.string().datetime({ offset: true }),
    user_id: z.string().uuid(),
    user_name: z.string().trim().min(1).max(255),
    user_avatar_url: nullableDashboardText(2_048),
    lead_id: z.string().uuid().nullable(),
    lead_name: nullableDashboardText(255),
    property_id: z.string().uuid().nullable(),
    property_title: nullableDashboardText(255),
    property_code: nullableDashboardText(120),
  })
  .passthrough();

const scheduleDashboardEventStatusSchema = z.enum([
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "__unknown__",
]);

export const scheduleDashboardEventSchema = scheduleDashboardUpcomingEventSchema
  .extend({
    is_all_day: z.boolean(),
    status: scheduleDashboardEventStatusSchema,
    outcome: scheduleOutcomeSchema.nullable(),
    is_overdue: z.boolean(),
  })
  .passthrough();

export const scheduleDashboardEventsPageSchema = z
  .object({
    items: z.array(scheduleDashboardEventSchema),
    total: nonNegativeIntegerSchema,
    limit: z.number().int().min(1).max(100),
    offset: nonNegativeIntegerSchema,
    has_more: z.boolean(),
  })
  .passthrough()
  .superRefine((page, context) => {
    if (page.items.length > page.limit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Página contém mais agendamentos que o limite informado",
      });
    }

    if (page.has_more && page.items.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Página intermediária não pode estar vazia",
      });
    }

    const expectedHasMore = page.offset + page.items.length < page.total;
    if (page.has_more !== expectedHasMore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["has_more"],
        message: "Indicador de próxima página incompatível com o total",
      });
    }
  });

const scheduleDashboardOverdueOwnerSchema = z
  .object({
    user_id: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    avatar_url: nullableDashboardText(2_048),
    overdue: nonNegativeIntegerSchema,
  })
  .passthrough();

const scheduleDashboardPerformerRankingSchema = z
  .object({
    user_id: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    avatar_url: nullableDashboardText(2_048),
    total: nonNegativeIntegerSchema,
    eligible: nonNegativeIntegerSchema,
    appointments: nonNegativeIntegerSchema,
    appointment_eligible: nonNegativeIntegerSchema,
    open: nonNegativeIntegerSchema,
    completed: nonNegativeIntegerSchema,
    no_show: nonNegativeIntegerSchema,
    overdue: nonNegativeIntegerSchema,
    completion_rate: finiteNumberSchema.min(0).max(100),
    no_show_rate: finiteNumberSchema.min(0).max(100),
  })
  .passthrough()
  .superRefine((person, context) => {
    const checks: Array<[boolean, keyof typeof person, string]> = [
      [
        person.eligible <= person.total,
        "eligible",
        "Base elegível maior que o total",
      ],
      [
        person.appointment_eligible <= person.appointments,
        "appointment_eligible",
        "Base elegível de visitas e reuniões maior que o volume correspondente",
      ],
      [
        person.completed <= person.eligible,
        "completed",
        "Realizados maiores que a base elegível",
      ],
      [
        person.no_show <= person.appointment_eligible,
        "no_show",
        "No-shows maiores que a base elegível",
      ],
      [
        person.overdue <= person.open,
        "overdue",
        "Atrasos maiores que os compromissos em aberto",
      ],
      [
        matchesDashboardRate(
          person.completed,
          person.eligible,
          person.completion_rate,
        ),
        "completion_rate",
        "Taxa de realização incompatível com a base elegível",
      ],
      [
        matchesDashboardRate(
          person.no_show,
          person.appointment_eligible,
          person.no_show_rate,
        ),
        "no_show_rate",
        "Taxa de no-show incompatível com a base elegível",
      ],
    ];

    checks.forEach(([valid, path, message]) => {
      if (valid) return;
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    });
  });

export const scheduleDashboardDataSchema = z
  .object({
    report_timezone: z.string().trim().min(1).max(120),
    period: scheduleDashboardPeriodSchema,
    kpis: scheduleDashboardKpisSchema,
    hourly: z.array(scheduleDashboardHourlyPointSchema).max(24),
    daily: z.array(scheduleDashboardDailyPointSchema),
    weekly: z.array(scheduleDashboardWeeklyPointSchema),
    by_type: z.array(scheduleDashboardBreakdownSchema),
    by_source: z.array(scheduleDashboardSourceSchema),
    by_outcome: z.array(scheduleDashboardBreakdownSchema),
    top_performers: z.array(scheduleDashboardTopPerformerSchema),
    upcoming_events: z.array(scheduleDashboardUpcomingEventSchema).max(10),
    overdue_by_owner: z.array(scheduleDashboardOverdueOwnerSchema),
    performer_ranking: z.array(scheduleDashboardPerformerRankingSchema),
  })
  .passthrough()
  .superRefine((dashboard, context) => {
    const isSingleDay = dashboard.period.date_from === dashboard.period.date_to;
    if (isSingleDay && dashboard.hourly.length !== 24) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hourly"],
        message: "Recorte de um dia deve conter as 24 faixas horárias",
      });
    } else if (!isSingleDay && dashboard.hourly.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hourly"],
        message: "Recortes de vários dias não devem conter série horária",
      });
    }

    dashboard.hourly.forEach((point, index) => {
      if (point.hour === index) return;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hourly", index, "hour"],
        message: "Faixas horárias devem estar completas e ordenadas",
      });
    });
  });

export const apiScheduleDashboardResponseSchema = apiEnvelopeSchema(
  scheduleDashboardDataSchema,
);

export const apiScheduleDashboardEventsResponseSchema = apiEnvelopeSchema(
  scheduleDashboardEventsPageSchema,
);

export type ScheduleDashboardDateBasis = z.infer<
  typeof scheduleDashboardDateBasisSchema
>;
export type ScheduleDashboardEventType = z.infer<
  typeof scheduleDashboardEventTypeSchema
>;
export type ScheduleDashboardStatus = z.infer<
  typeof scheduleDashboardStatusSchema
>;
export type ScheduleDashboardQueryInput = z.input<
  typeof scheduleDashboardQuerySchema
>;
export type ScheduleDashboardQuery = z.output<
  typeof scheduleDashboardQuerySchema
>;
export type ScheduleDashboardEventsQueryInput = z.input<
  typeof scheduleDashboardEventsQuerySchema
>;
export type ScheduleDashboardEventsQuery = z.output<
  typeof scheduleDashboardEventsQuerySchema
>;
export type ScheduleDashboardData = z.infer<typeof scheduleDashboardDataSchema>;
export type ScheduleDashboardPeriod = ScheduleDashboardData["period"];
export type ScheduleDashboardKpis = ScheduleDashboardData["kpis"];
export type ScheduleDashboardHourlyPoint =
  ScheduleDashboardData["hourly"][number];
export type ScheduleDashboardDailyPoint =
  ScheduleDashboardData["daily"][number];
export type ScheduleDashboardBreakdown =
  ScheduleDashboardData["by_type"][number];
export type ScheduleDashboardSource =
  ScheduleDashboardData["by_source"][number];
export type ScheduleDashboardTopPerformer =
  ScheduleDashboardData["top_performers"][number];
export type ScheduleDashboardWeeklyPoint =
  ScheduleDashboardData["weekly"][number];
export type ScheduleDashboardUpcomingEvent =
  ScheduleDashboardData["upcoming_events"][number];
export type ScheduleDashboardEvent = z.infer<
  typeof scheduleDashboardEventSchema
>;
export type ScheduleDashboardEventsPage = z.infer<
  typeof scheduleDashboardEventsPageSchema
>;
export type ScheduleDashboardOverdueOwner =
  ScheduleDashboardData["overdue_by_owner"][number];
export type ScheduleDashboardPerformerRanking =
  ScheduleDashboardData["performer_ranking"][number];
