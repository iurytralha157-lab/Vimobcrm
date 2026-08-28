import { z } from "zod";

import { apiEnvelopeSchema, okResponseSchema, uuidSchema } from "./common";

export const HOME_PUBLICATION_CTA_HREFS = [
  "/dashboard",
  "/crm/pipelines",
  "/crm/contacts",
  "/crm/conversas",
  "/agenda",
  "/automations",
  "/automations?tab=automations",
  "/automations?tab=templates",
  "/automations?tab=history",
  "/properties",
  "/gamificacao",
  "/notifications",
  "/settings",
  "/suporte",
] as const;

export const homePublicationCardSizeSchema = z.enum([
  "wide",
  "half",
  "compact",
]);
export const homePublicationAccentSchema = z.enum([
  "orange",
  "violet",
  "blue",
  "emerald",
  "amber",
  "slate",
]);
export const homePublicationTargetTypeSchema = z.enum([
  "all",
  "organizations",
  "users",
  "roles",
]);
export const homePublicationTargetRoleSchema = z.enum(["admin", "user"]);
export const homePublicationCtaHrefSchema = z.enum(HOME_PUBLICATION_CTA_HREFS);

const publicationTitleSchema = z.string().trim().min(2).max(120);
const publicationBodySchema = z.string().trim().min(2).max(1_000);
const publicationCtaLabelSchema = z.string().trim().min(2).max(40);
const publicationDisplayOrderSchema = z.number().int().min(0).max(10_000);
const publicationTimestampSchema = z.string().trim().datetime({ offset: true });
const publicationImageUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "A imagem da publicação deve usar HTTP ou HTTPS.")
  .nullable();
const targetOrganizationIdsSchema = z
  .array(uuidSchema)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Não repita organizações no público-alvo.",
  });
const targetUserIdsSchema = z
  .array(uuidSchema)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Não repita usuários no público-alvo.",
  });
const targetRolesSchema = z
  .array(homePublicationTargetRoleSchema)
  .refine((roles) => new Set(roles).size === roles.length, {
    message: "Não repita perfis no público-alvo.",
  });

type SchedulablePublication = {
  startsAt?: string | null;
  endsAt?: string | null;
};

type TargetedPublication = {
  targetType?: z.infer<typeof homePublicationTargetTypeSchema>;
  targetOrganizationIds?: string[];
  targetUserIds?: string[];
  targetRoles?: z.infer<typeof homePublicationTargetRoleSchema>[];
};

function validatePublicationSchedule(
  value: SchedulablePublication,
  context: z.RefinementCtx,
) {
  if (
    value.startsAt &&
    value.endsAt &&
    new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "O encerramento deve acontecer depois do início.",
    });
  }
}

function addTargetIssue(
  context: z.RefinementCtx,
  path: keyof TargetedPublication,
  message: string,
) {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message,
  });
}

function validatePublicationTarget(
  value: TargetedPublication,
  context: z.RefinementCtx,
  requireCompleteTarget: boolean,
) {
  const { targetType } = value;
  if (!targetType) return;

  const organizationIds = value.targetOrganizationIds;
  const userIds = value.targetUserIds;
  const roles = value.targetRoles;

  if (targetType === "all") {
    if ((organizationIds?.length || 0) > 0) {
      addTargetIssue(
        context,
        "targetOrganizationIds",
        "O público geral não pode limitar organizações.",
      );
    }
    if ((userIds?.length || 0) > 0) {
      addTargetIssue(
        context,
        "targetUserIds",
        "O público geral não pode limitar usuários.",
      );
    }
    if ((roles?.length || 0) > 0) {
      addTargetIssue(
        context,
        "targetRoles",
        "O público geral não pode limitar perfis.",
      );
    }
    return;
  }

  if (targetType === "organizations") {
    if (
      (requireCompleteTarget || organizationIds !== undefined) &&
      !organizationIds?.length
    ) {
      addTargetIssue(
        context,
        "targetOrganizationIds",
        "Selecione ao menos uma organização.",
      );
    }
    if ((userIds?.length || 0) > 0 || (roles?.length || 0) > 0) {
      addTargetIssue(
        context,
        "targetType",
        "Use apenas organizações para este público-alvo.",
      );
    }
    return;
  }

  if (targetType === "users") {
    if ((requireCompleteTarget || userIds !== undefined) && !userIds?.length) {
      addTargetIssue(
        context,
        "targetUserIds",
        "Selecione ao menos um usuário.",
      );
    }
    if ((organizationIds?.length || 0) > 0 || (roles?.length || 0) > 0) {
      addTargetIssue(
        context,
        "targetType",
        "Use apenas usuários para este público-alvo.",
      );
    }
    return;
  }

  if ((requireCompleteTarget || roles !== undefined) && !roles?.length) {
    addTargetIssue(context, "targetRoles", "Selecione ao menos um perfil.");
  }
  if ((organizationIds?.length || 0) > 0 || (userIds?.length || 0) > 0) {
    addTargetIssue(
      context,
      "targetType",
      "Use apenas perfis para este público-alvo.",
    );
  }
}

const apiHomePublicationObjectSchema = z
  .object({
    id: uuidSchema,
    title: publicationTitleSchema,
    body: publicationBodySchema,
    ctaLabel: publicationCtaLabelSchema,
    ctaHref: homePublicationCtaHrefSchema,
    imageUrl: publicationImageUrlSchema,
    cardSize: homePublicationCardSizeSchema,
    accent: homePublicationAccentSchema,
    displayOrder: publicationDisplayOrderSchema,
    isActive: z.boolean(),
    startsAt: publicationTimestampSchema.nullable(),
    endsAt: publicationTimestampSchema.nullable(),
    targetType: homePublicationTargetTypeSchema,
    targetOrganizationIds: targetOrganizationIdsSchema,
    targetUserIds: targetUserIdsSchema,
    targetRoles: targetRolesSchema,
    createdAt: publicationTimestampSchema,
    updatedAt: publicationTimestampSchema,
  })
  .passthrough();

export const apiHomePublicationSchema =
  apiHomePublicationObjectSchema.superRefine((value, context) => {
    validatePublicationSchedule(value, context);
    validatePublicationTarget(value, context, true);
  });

export const apiHomePublicationCardSchema = z
  .object({
    id: uuidSchema,
    title: publicationTitleSchema,
    body: publicationBodySchema,
    ctaLabel: publicationCtaLabelSchema,
    ctaHref: homePublicationCtaHrefSchema,
    imageUrl: publicationImageUrlSchema,
    cardSize: homePublicationCardSizeSchema,
    accent: homePublicationAccentSchema,
    displayOrder: publicationDisplayOrderSchema,
  })
  .strict();

const homePublicationMutationObjectSchema = z
  .object({
    title: publicationTitleSchema,
    body: publicationBodySchema,
    ctaLabel: publicationCtaLabelSchema,
    ctaHref: homePublicationCtaHrefSchema,
    cardSize: homePublicationCardSizeSchema.default("half"),
    accent: homePublicationAccentSchema.default("orange"),
    displayOrder: publicationDisplayOrderSchema.default(0),
    isActive: z.boolean().default(true),
    startsAt: publicationTimestampSchema.nullable().default(null),
    endsAt: publicationTimestampSchema.nullable().default(null),
    targetType: homePublicationTargetTypeSchema.default("all"),
    targetOrganizationIds: targetOrganizationIdsSchema.default([]),
    targetUserIds: targetUserIdsSchema.default([]),
    targetRoles: targetRolesSchema.default([]),
  })
  .strict();

export const createHomePublicationInputSchema =
  homePublicationMutationObjectSchema.superRefine((value, context) => {
    validatePublicationSchedule(value, context);
    validatePublicationTarget(value, context, true);
  });

export const updateHomePublicationInputSchema =
  homePublicationMutationObjectSchema
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "Informe ao menos uma alteração.",
    })
    .superRefine((value, context) => {
      validatePublicationSchedule(value, context);
      validatePublicationTarget(value, context, false);
    });

export const homeAssistantInputSchema = z
  .object({
    question: z.string().trim().min(2).max(500),
  })
  .strict();

export const homeFocusKindSchema = z.enum(["attention", "task"]);
export const homeFocusToneSchema = z.enum(["critical", "warning", "neutral"]);
export const homeNoticeSourceSchema = z.enum(["billing", "announcement"]);
export const homeNoticeSeveritySchema = z.enum([
  "critical",
  "warning",
  "announcement",
]);
export const homeFocusPolicyTypeSchema = z.enum([
  "unassigned",
  "first_contact",
  "first_effective_contact",
  "stage_inactivity",
  "stage_age",
  "cadence_task",
]);

export const apiHomeFocusItemSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: homeFocusKindSchema,
    obligation_key: z.string().trim().min(1),
    lead_id: uuidSchema,
    lead_name: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().trim(),
    due_at: publicationTimestampSchema,
    status: z.enum(["due", "warning", "breached"]),
    tone: homeFocusToneSchema,
    policy_type: homeFocusPolicyTypeSchema.nullish(),
    task_type: z.string().trim().min(1).nullish(),
    target_url: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .refine(
        (value) => value.startsWith("/")
          && !value.startsWith("//")
          && !value.includes("\\")
          && !/[\u0000-\u001F\u007F]/.test(value),
        { message: "Use uma rota interna válida." },
      ),
    stage_id: uuidSchema.nullish(),
    stage_name: z.string().trim().min(1).nullish(),
  })
  .strict();

const homeNoticeActionURLSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) => {
      if (value.startsWith("/") && !value.startsWith("//")) return true;
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Use uma rota interna ou uma URL HTTP(S) válida." },
  );

export const apiHomeNoticeSchema = z
  .object({
    id: z.string().trim().min(1),
    source: homeNoticeSourceSchema,
    severity: homeNoticeSeveritySchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    action_label: z.string().trim().min(1).max(48).nullish(),
    action_url: homeNoticeActionURLSchema.nullish(),
    dismissible: z.boolean(),
    display_duration_seconds: z.number().int().min(5).max(86_400).nullish(),
    starts_at: publicationTimestampSchema.nullish(),
    ends_at: publicationTimestampSchema.nullish(),
  })
  .strict();

export const apiHomeAssistantAnswerSchema = z
  .object({
    answer: z.string().trim().min(1),
    title: z.string().trim().min(1),
    articleId: uuidSchema,
  })
  .passthrough();

export const homePublicationOrderItemSchema = z
  .object({
    id: uuidSchema,
    displayOrder: publicationDisplayOrderSchema,
  })
  .strict();

export const reorderHomePublicationsInputSchema = z
  .object({
    items: z
      .array(homePublicationOrderItemSchema)
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        { message: "Não repita publicações na ordenação." },
      ),
  })
  .strict();

export const homePublicationImageFileSchema = z.custom<File>(
  (value) =>
    typeof File !== "undefined" && value instanceof File && value.size > 0,
  { message: "Selecione um arquivo de imagem válido." },
);

export const apiHomePublicationListResponseSchema = apiEnvelopeSchema(
  z.array(apiHomePublicationSchema),
);
export const apiHomePublicationCardListResponseSchema = apiEnvelopeSchema(
  z.array(apiHomePublicationCardSchema),
);
export const apiHomePublicationResponseSchema = apiEnvelopeSchema(
  apiHomePublicationSchema,
);
export const apiHomeAssistantResponseSchema = apiEnvelopeSchema(
  apiHomeAssistantAnswerSchema.nullable(),
);
export const apiHomeFocusResponseSchema = apiEnvelopeSchema(
  z.array(apiHomeFocusItemSchema),
);
export const apiHomeNoticeListResponseSchema = apiEnvelopeSchema(
  z.array(apiHomeNoticeSchema),
);
export const apiDeleteHomePublicationImageResponseSchema =
  apiHomePublicationResponseSchema
    .extend({
      cleanupWarning: z.string().trim().min(1).optional(),
    })
    .passthrough();
export const apiDeleteHomePublicationResponseSchema = okResponseSchema
  .extend({
    cleanupWarning: z.string().trim().min(1).optional(),
  })
  .passthrough();

export type HomePublication = z.infer<typeof apiHomePublicationSchema>;
export type HomePublicationCard = z.infer<typeof apiHomePublicationCardSchema>;
export type HomePublicationCardSize = z.infer<
  typeof homePublicationCardSizeSchema
>;
export type HomePublicationAccent = z.infer<typeof homePublicationAccentSchema>;
export type HomePublicationTargetType = z.infer<
  typeof homePublicationTargetTypeSchema
>;
export type HomePublicationTargetRole = z.infer<
  typeof homePublicationTargetRoleSchema
>;
export type HomePublicationCtaHref = z.infer<
  typeof homePublicationCtaHrefSchema
>;
export type CreateHomePublicationInput = z.input<
  typeof createHomePublicationInputSchema
>;
export type UpdateHomePublicationInput = z.input<
  typeof updateHomePublicationInputSchema
>;
export type HomeAssistantAnswer = z.infer<typeof apiHomeAssistantAnswerSchema>;
export type HomeFocusFeedItem = z.infer<typeof apiHomeFocusItemSchema>;
export type HomeFocusFeedKind = z.infer<typeof homeFocusKindSchema>;
export type HomeFocusFeedTone = z.infer<typeof homeFocusToneSchema>;
export type HomeNotice = z.infer<typeof apiHomeNoticeSchema>;
export type HomeNoticeSource = z.infer<typeof homeNoticeSourceSchema>;
export type HomeNoticeSeverity = z.infer<typeof homeNoticeSeveritySchema>;
export type HomePublicationOrderItem = z.infer<
  typeof homePublicationOrderItemSchema
>;
export type ReorderHomePublicationsInput = z.input<
  typeof reorderHomePublicationsInputSchema
>;
