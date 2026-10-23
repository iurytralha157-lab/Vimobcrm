import { z } from "zod";
import {
  apiEnvelopeSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from "./common";

export const scheduleEventTypeSchema = z.enum([
  "call",
  "email",
  "meeting",
  "task",
  "message",
  "visit",
]);
export const scheduleVisibilitySchema = z.enum([
  "default",
  "public",
  "private",
]);
export const scheduleRecurrenceSchema = z.enum([
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
export const scheduleStatusSchema = z.enum([
  "scheduled",
  "completed",
  "cancelled",
  "canceled",
  "no_show",
]);
export const scheduleOutcomeSchema = z.enum([
  "contacted",
  "activity_completed",
  "qualified",
  "proposal",
  "visit_completed",
  "meeting_completed",
  "follow_up",
  "no_show",
  "rescheduled",
  "cancelled",
  "other",
]);
export const scheduleClockInputSchema = z
  .string()
  .trim()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Horario invalido");

const eventDateSchema = z
  .string()
  .trim()
  .datetime({ offset: true, message: "Data invalida" });
const reminderMinutesInputSchema = nonNegativeIntegerSchema.max(120);

export const scheduleListQuerySchema = z
  .object({
    eventId: uuidSchema.optional(),
    userId: uuidSchema.optional(),
    leadId: uuidSchema.optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (!query.eventId && !query.leadId && (!query.startDate || !query.endDate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Selecione o periodo da agenda" });
    }
    if (query.startDate && query.endDate) {
      const duration = query.endDate.getTime() - query.startDate.getTime();
      if (duration < 0 || duration > 366 * 86_400_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "Periodo da agenda invalido ou maior que 366 dias" });
      }
    }
  });

export const createScheduleEventInputSchema = z
  .object({
    client_request_id: uuidSchema.optional(),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(2_000).optional(),
    event_type: scheduleEventTypeSchema.default("task"),
    start_time: eventDateSchema,
    end_time: eventDateSchema,
    is_all_day: z.boolean().optional(),
    user_id: uuidSchema.optional(),
    lead_id: uuidSchema.optional(),
    property_id: uuidSchema.nullish(),
    team_id: uuidSchema.nullish(),
    location: z.string().trim().max(500).optional(),
    visibility: scheduleVisibilitySchema.default("default"),
    recurrence_rule: scheduleRecurrenceSchema.optional(),
    reminder_minutes: reminderMinutesInputSchema.nullish(),
    assignee_ids: z.array(uuidSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (input) => Date.parse(input.end_time) > Date.parse(input.start_time),
    { path: ["end_time"], message: "Fim deve ser posterior ao inicio" },
  );

export const updateScheduleEventInputSchema = z
  .object({
    expected_updated_at: eventDateSchema.optional(),
    title: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    event_type: scheduleEventTypeSchema.optional(),
    start_time: eventDateSchema.optional(),
    end_time: eventDateSchema.optional(),
    is_all_day: z.boolean().nullable().optional(),
    user_id: uuidSchema.optional(),
    lead_id: uuidSchema.nullish(),
    property_id: uuidSchema.nullish(),
    team_id: uuidSchema.nullish(),
    location: z.string().trim().max(500).nullable().optional(),
    status: scheduleStatusSchema.optional(),
    visibility: scheduleVisibilitySchema.optional(),
    reminder_minutes: reminderMinutesInputSchema.nullish(),
    assignee_ids: z.array(uuidSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (input) => Object.entries(input).some(([key, value]) => key !== "expected_updated_at" && value !== undefined),
    "Informe ao menos uma alteracao",
  )
  .refine(
    (input) =>
      !input.start_time ||
      !input.end_time ||
      Date.parse(input.end_time) > Date.parse(input.start_time),
    { path: ["end_time"], message: "Fim deve ser posterior ao inicio" },
  );

export const completeScheduleEventInputSchema = z
  .object({
    expected_updated_at: eventDateSchema.optional(),
    status: scheduleStatusSchema,
    outcome: scheduleOutcomeSchema.nullish(),
    outcome_notes: z.string().trim().max(2_000).nullish(),
    performed_by: uuidSchema.nullish(),
  })
  .strict();
export const rescheduleScheduleEventInputSchema = z
  .object({
    expected_updated_at: eventDateSchema.optional(),
    start_time: eventDateSchema,
    end_time: eventDateSchema,
    is_all_day: z.boolean().optional(),
    reminder_minutes: reminderMinutesInputSchema.nullish(),
    outcome_notes: z.string().trim().max(2_000).nullish(),
  })
  .strict()
  .refine(
    (input) => Date.parse(input.end_time) > Date.parse(input.start_time),
    { path: ["end_time"], message: "Fim deve ser posterior ao inicio" },
  );
export const scheduleCommentInputSchema = z
  .object({
    client_request_id: uuidSchema.optional(),
    content: z.string().trim().min(1).max(2_000),
  })
  .strict();
export const scheduleAssigneeInputSchema = z
  .object({ user_id: uuidSchema })
  .strict();

const scheduleUserRefSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    avatar_url: z.string().nullable().optional(),
  })
  .passthrough();

export const apiScheduleEventSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    user_id: uuidSchema.nullable(),
    lead_id: uuidSchema.nullable(),
    property_id: uuidSchema.nullable(),
    created_by: uuidSchema.nullable().optional(),
    team_id: uuidSchema.nullable().optional(),
    lead_source_snapshot: z.string().nullable().optional(),
    title: z.string(),
    description: z.string().nullable(),
    event_type: z.string().nullable(),
    start_time: timestampSchema,
    end_time: timestampSchema,
    is_all_day: z.boolean().nullable(),
    location: z.string().nullable(),
    status: z.string().nullable(),
    visibility: scheduleVisibilitySchema.nullable().optional(),
    reminder_minutes: nonNegativeIntegerSchema.nullable(),
    recurrence_parent_id: uuidSchema.nullable().optional(),
    recurrence_rule: z.string().nullable().optional(),
    recurrence_until: timestampSchema.nullable().optional(),
    recurrence_count: nonNegativeIntegerSchema.nullable().optional(),
    google_event_id: z.string().nullable(),
    completed_by: uuidSchema.nullable(),
    completed_at: timestampSchema.nullable(),
    outcome: scheduleOutcomeSchema.nullable().optional(),
    outcome_notes: z.string().nullable().optional(),
    performed_by: uuidSchema.nullable().optional(),
    performed_by_user: scheduleUserRefSchema.nullable().optional(),
    rescheduled_from_event_id: uuidSchema.nullable().optional(),
    rescheduled_to_event_id: uuidSchema.nullable().optional(),
    outcome_recorded_at: timestampSchema.nullable().optional(),
    created_at: timestampSchema.nullable(),
    updated_at: timestampSchema.nullable(),
    user: scheduleUserRefSchema.nullable().optional(),
    assignee_user_ids: z.array(uuidSchema).optional(),
    is_masked: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((event, ctx) => {
    if (!event.is_masked && event.user_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["user_id"],
        message: "Responsavel obrigatorio para evento visivel",
      });
    }
  });

export const apiScheduleCommentSchema = z
  .object({
    id: uuidSchema,
    event_id: uuidSchema,
    user_id: uuidSchema,
    organization_id: uuidSchema,
    content: z.string(),
    created_at: timestampSchema,
    user: scheduleUserRefSchema.optional(),
  })
  .passthrough();

export const apiScheduleAssigneeSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    avatar_url: z.string().nullable(),
  })
  .passthrough();

export const apiScheduleEventListResponseSchema = apiEnvelopeSchema(
  z.array(apiScheduleEventSchema),
).extend({
  pagination: z.object({
    limit: z.number().int().min(1).max(500),
    offset: nonNegativeIntegerSchema,
    has_more: z.boolean(),
  }).optional(),
});
export const apiScheduleEventResponseSchema = apiEnvelopeSchema(
  apiScheduleEventSchema,
);
export const apiScheduleRescheduleResponseSchema = apiEnvelopeSchema(
  z
    .object({
      previous_event: apiScheduleEventSchema,
      new_event: apiScheduleEventSchema,
    })
    .strict(),
);
export const apiScheduleCommentListResponseSchema = apiEnvelopeSchema(
  z.array(apiScheduleCommentSchema),
);
export const apiScheduleCommentResponseSchema = apiEnvelopeSchema(
  apiScheduleCommentSchema,
);
export const apiScheduleAssigneeListResponseSchema = apiEnvelopeSchema(
  z.array(apiScheduleAssigneeSchema),
);
export const apiScheduleCapabilitiesResponseSchema = apiEnvelopeSchema(
  z
    .object({
      isTeamLeader: z.boolean(),
      timeZone: z.string().trim().min(1).max(120).refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
          return true;
        } catch {
          return false;
        }
      }, "Fuso horario da organizacao invalido"),
    })
    .passthrough(),
);
