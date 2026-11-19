import { z } from "zod";
import { timestampSchema, uuidSchema } from "@/lib/validation/common";
import { dynamicRecordSchema } from "@/lib/validation/final-domains";


export const realtimeEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    organizationId: uuidSchema,
    userId: uuidSchema.optional(),
    data: dynamicRecordSchema.optional(),
    createdAt: timestampSchema,
  })
  .passthrough();
