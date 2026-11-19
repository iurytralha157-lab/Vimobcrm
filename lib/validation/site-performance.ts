import { z } from "zod";
import { timestampSchema } from "@/lib/validation/common";

export const pageSpeedStrategySchema = z.enum(["desktop", "mobile"]);
export const pageSpeedResponseSchema = z
  .object({
    lighthouseResult: z
      .object({
        fetchTime: timestampSchema,
        categories: z
          .object({
            performance: z
              .object({ score: z.number().min(0).max(1).nullable() })
              .passthrough(),
          })
          .passthrough(),
        audits: z
          .record(
            z.string(), z
              .object({
                numericValue: z.number().finite().optional(),
                displayValue: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
