import { z } from "zod";

export const whatsappCallStateSchema = z.enum([
  "incoming",
  "outgoing",
  "ringing",
  "active",
  "end_pending",
  "reject_pending",
  "outcome_unknown",
  "rejected",
  "ended",
  "failed",
]);

export const whatsappCallSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  session_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  lead_id: z.string().uuid().nullable(),
  operator_user_id: z.string().uuid().nullable(),
  provider_call_id: z.string().min(1),
  remote_jid: z.string().min(1),
  direction: z.enum(["incoming", "outgoing"]),
  state: whatsappCallStateSchema,
  offered_at: z.string().nullable(),
  answered_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  recording_status: z.string(),
  created_at: z.string(),
});

export const whatsappCallResponseSchema = z.object({ data: whatsappCallSchema });
export const whatsappCallListResponseSchema = z.object({ data: z.array(whatsappCallSchema) });
export const whatsappContactSaveResponseSchema = z.object({
  data: z.object({ saved: z.literal(true) }),
});
export const whatsappCallMediaTicketSchema = z.object({
  url: z.string().url().refine((url) => url.startsWith("wss://"), "Conexão segura obrigatória"),
  expires_at: z.string(),
});

export const whatsappCallRecordingResponseSchema = z.object({
  data: z.object({
    incoming_url: z.string().url().nullable(),
    outgoing_url: z.string().url().nullable(),
    expires_at: z.string(),
  }),
});

export const whatsappContactNameSchema = z.string().trim().min(2).max(120);

export type WhatsAppCall = z.infer<typeof whatsappCallSchema>;
