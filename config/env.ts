import { z } from 'zod'

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('Invalid Supabase URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Missing Supabase Anon Key'),
  NEXT_PUBLIC_VIMOB_API_URL: z.string().url('Invalid Vimob API URL').optional().default('http://localhost:8080'),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
})

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_VIMOB_API_URL: process.env.NEXT_PUBLIC_VIMOB_API_URL,
  NODE_ENV: process.env.NODE_ENV,
})

export type Env = z.infer<typeof envSchema>
