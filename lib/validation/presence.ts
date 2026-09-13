import { z } from "zod";

import { nonNegativeIntegerSchema, uuidSchema } from "./common";
import { dynamicRecordSchema } from "./final-domains";

const presenceTimestampSchema = z.string().trim().datetime({ offset: true });

export const userActivitySessionStatusSchema = z.enum([
  "online",
  "idle",
  "offline",
]);
export const organizationPresenceStatusSchema =
  userActivitySessionStatusSchema;

export const userActivitySessionMutationInputSchema = z
  .object({
    organizationId: uuidSchema,
    userId: uuidSchema,
    sessionId: z.string().trim().min(8).max(160),
    status: userActivitySessionStatusSchema.optional(),
    currentPath: z.string().trim().max(4_000).nullish(),
    currentPageTitle: z.string().trim().max(500).nullish(),
    userAgent: z.string().max(2_000).nullish(),
    metadata: dynamicRecordSchema.optional(),
  })
  .strict();

export const organizationPresenceUserSchema = z
  .object({
    user_id: uuidSchema,
    name: z.string().trim().min(1).max(180),
    avatar_url: z.string().trim().min(1).max(2_048).nullable(),
    member_role: z.string().trim().min(1).max(80),
    is_team_leader: z.boolean(),
    presence_status: organizationPresenceStatusSchema,
    // Keep additive API rollouts backward-compatible: an older API may omit
    // this field briefly while the frontend has already been updated.
    idle_since_at: presenceTimestampSchema.nullable().default(null),
    last_seen_at: presenceTimestampSchema.nullable(),
  });

export const organizationPresenceCountsSchema = z
  .object({
    total: nonNegativeIntegerSchema,
    online: nonNegativeIntegerSchema,
    idle: nonNegativeIntegerSchema,
    offline: nonNegativeIntegerSchema,
  });

export const organizationPresenceDataSchema = z
  .object({
    users: z.array(organizationPresenceUserSchema),
    counts: organizationPresenceCountsSchema,
    generated_at: presenceTimestampSchema,
  });

export const apiOrganizationPresenceResponseSchema = z
  .object({
    data: organizationPresenceDataSchema,
  });

export const organizationPresenceListInputSchema = z
  .object({
    organizationId: uuidSchema,
  })
  .strict();

export type OrganizationPresenceStatus = z.infer<
  typeof organizationPresenceStatusSchema
>;
export type OrganizationPresenceUser = z.infer<
  typeof organizationPresenceUserSchema
>;
export type OrganizationPresenceCounts = z.infer<
  typeof organizationPresenceCountsSchema
>;
export type OrganizationPresenceData = z.infer<
  typeof organizationPresenceDataSchema
>;
export type OrganizationPresenceResponse = z.infer<
  typeof apiOrganizationPresenceResponseSchema
>;
export type OrganizationPresenceListInput = z.infer<
  typeof organizationPresenceListInputSchema
>;
