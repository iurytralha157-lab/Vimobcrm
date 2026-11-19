import { z } from "zod";
import { uuidSchema } from "@/lib/validation/common";


export const nullableString = z.string().nullable();
export const optionalNullableString = z.string().max(20_000).nullish();
export const optionalUUID = uuidSchema.nullish();
export const finiteNullableNumber = z.number().finite().nullable();

export const uuidListSchema = z.array(uuidSchema).min(1).max(1_000);
export const organizationIdSchema = uuidSchema;
export const entityIdSchema = uuidSchema;

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
