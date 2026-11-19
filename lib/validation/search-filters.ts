import { z } from "zod";


export const searchFilterColumnsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/),
  )
  .min(1)
  .max(100);
export const searchFilterMaxLengthSchema = z.number().int().min(1).max(10_000);
