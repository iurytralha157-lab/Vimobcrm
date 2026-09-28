import { z } from 'zod'

const uuid = z.string().uuid()
const count = z.number().int().nonnegative()
const text = (max: number) => z.string().max(max)

export const dashboardVisitSchema = z.object({
  id: uuid,
  title: text(500),
  event_type: z.enum(['visit', 'meeting']),
  status: text(80),
  created_at: z.string().nullable(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  lead_id: uuid,
  lead_name: text(300),
  source: text(180),
  created_by_id: uuid.nullable(),
  created_by_name: text(300),
  created_by_avatar: text(2_048).nullable(),
  owner_id: uuid,
  owner_name: text(300),
  owner_avatar: text(2_048).nullable().optional(),
  is_upcoming: z.boolean(),
  is_overdue: z.boolean(),
}).passthrough()

export const dashboardVisitsSchema = z.object({
  reportTimezone: text(100),
  total: count,
  upcoming: count,
  overdue: count,
  visits: z.array(dashboardVisitSchema).max(100),
  visitsTruncated: z.boolean(),
  upcomingVisits: z.array(dashboardVisitSchema).max(20),
  overdueVisits: z.array(dashboardVisitSchema).max(20),
  creators: z.array(z.object({
    id: uuid.nullable(),
    name: text(300),
    avatarUrl: text(2_048).nullable(),
    count,
  })).max(50),
  sources: z.array(z.object({ source: text(180), count })).max(50),
}).passthrough().superRefine((report, context) => {
  if (report.upcoming > report.total || report.overdue > report.total || report.visits.length > report.total) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Os totais de visitas não correspondem ao período selecionado',
    })
  }
})

export const dashboardVisitsResponseSchema = z.object({ data: dashboardVisitsSchema }).passthrough()

export type DashboardVisit = z.infer<typeof dashboardVisitSchema>
export type DashboardVisits = z.infer<typeof dashboardVisitsSchema>
