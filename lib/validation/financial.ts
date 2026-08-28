import { z } from "zod";
import { apiEnvelopeSchema, uuidSchema } from "./common";

const optionalText = z.string().trim().max(4_000).nullish();
const optionalUUID = z.union([uuidSchema, z.literal(""), z.null()]).optional();
const moneySchema = z.union([
  z.number().finite().min(0).max(999_999_999_999.99),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine(
      (value) => Number(value) <= 999_999_999_999.99,
      "Valor excede o limite permitido",
    ),
]);
const responseNumberSchema = z.coerce.number().finite();
const legacyResponseNumberSchema = z.preprocess(
  (value) => value ?? 0,
  responseNumberSchema,
);
const legacyResponseBooleanSchema = z.preprocess(
  (value) => value ?? true,
  z.boolean(),
);
const responseDateSchema = z.string().trim().min(1).max(40).nullish();
export const financialCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Data inválida");
const optionalFinancialDateSchema = z
  .union([financialCalendarDateSchema, z.literal(""), z.null()])
  .optional();

function rejectClientManagedFields(
  input: Record<string, unknown>,
  fields: readonly string[],
  ctx: z.RefinementCtx,
) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: "Campo gerenciado pelo servidor",
      });
    }
  }
}

export function addMonthsToFinancialCalendarDate(
  value: string,
  months: number,
) {
  const date = financialCalendarDateSchema.parse(value);
  if (!Number.isInteger(months) || Math.abs(months) > 1_200) {
    throw new RangeError("Quantidade de meses inválida");
  }

  const [year, month, day] = date.split("-").map(Number);
  const targetStart = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = targetStart.getUTCFullYear();
  const targetMonth = targetStart.getUTCMonth();
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return [
    targetYear,
    String(targetMonth + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
}

export function splitFinancialAmountIntoInstallments(
  amount: number,
  installments: number,
) {
  const totalCents = Math.round(amount * 100);
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isInteger(installments) ||
    installments < 2 ||
    installments > 120 ||
    totalCents < installments
  ) {
    throw new RangeError("Parcelamento financeiro inválido");
  }

  const baseInstallmentCents = Math.floor(totalCents / installments);
  const remainder = totalCents % installments;
  return Array.from(
    { length: installments },
    (_, index) =>
      (baseInstallmentCents + (index < remainder ? 1 : 0)) / 100,
  );
}

export const financialCategoryInputSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    type: z.enum(["income", "expense"]),
    category_group: optionalText,
  })
  .strict();

const financialEntryShape = {
  type: z.enum(["receivable", "payable"]).optional(),
  category: z.string().trim().min(1).max(180).optional(),
  category_group: optionalText,
  contract_id: optionalUUID,
  lead_id: optionalUUID,
  broker_id: optionalUUID,
  description: z.string().trim().min(1).max(2_000).optional(),
  amount: moneySchema.optional(),
  paid_amount: moneySchema.nullish(),
  paid_value: moneySchema.nullish(),
  due_date: financialCalendarDateSchema.optional(),
  paid_date: optionalFinancialDateSchema,
  payment_method: optionalText,
  status: z
    .enum(["pending", "partial", "paid", "overdue", "cancelled"])
    .optional(),
  notes: optionalText,
  created_by: optionalUUID,
  installment_number: z.number().int().min(1).nullish(),
  total_installments: z.number().int().min(1).max(360).nullish(),
  is_recurring: z.boolean().optional(),
  recurring_type: z.enum(["monthly", "weekly", "yearly"]).nullish(),
  parent_entry_id: optionalUUID,
};

function validateFinancialEntryRelations(
  input: z.infer<z.ZodObject<typeof financialEntryShape>>,
  ctx: z.RefinementCtx,
) {
  if (input.amount !== undefined && Number(input.amount) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: "Valor deve ser maior que zero",
    });
  }
  if (input.is_recurring && !input.recurring_type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recurring_type"],
      message: "Informe a frequência da recorrência",
    });
  }
  if (
    input.installment_number &&
    input.total_installments &&
    input.installment_number > input.total_installments
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["installment_number"],
      message: "A parcela atual não pode exceder o total",
    });
  }
}

export const financialEntryCreateInputSchema = z
  .object(financialEntryShape)
  .passthrough()
  .superRefine((input, ctx) => {
    for (const key of [
      "type",
      "category",
      "description",
      "amount",
      "due_date",
    ] as const) {
      if (input[key] === undefined || input[key] === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Campo obrigatorio",
        });
      }
    }
    rejectClientManagedFields(
      input,
      ["status", "paid_amount", "paid_value", "paid_date", "created_by"],
      ctx,
    );
    validateFinancialEntryRelations(input, ctx);
  });
export const financialEntryUpdateInputSchema = z
  .object(financialEntryShape)
  .passthrough()
  .superRefine((input, ctx) => {
    rejectClientManagedFields(
      input,
      ["status", "paid_amount", "paid_value", "paid_date", "created_by"],
      ctx,
    );
    validateFinancialEntryRelations(input, ctx);
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "Informe ao menos uma alteracao",
  );

export const contractBrokerInputSchema = z
  .object({
    user_id: uuidSchema,
    commission_percentage: z.number().finite().min(0).max(100),
  })
  .strict();

const contractShape = {
  contract_number: optionalText,
  contract_type: z.enum(["sale", "rent", "rental", "service"]).optional(),
  status: z.enum(["draft", "active", "finished", "cancelled"]).optional(),
  property_id: optionalUUID,
  lead_id: optionalUUID,
  value: moneySchema.optional(),
  commission_percentage: moneySchema.nullish(),
  commission_value: moneySchema.nullish(),
  client_name: z.string().trim().min(1).max(180).optional(),
  client_email: z
    .union([z.string().trim().email(), z.literal(""), z.null()])
    .optional(),
  client_phone: optionalText,
  client_document: optionalText,
  down_payment: moneySchema.nullish(),
  installments: z.number().int().min(1).max(360).nullish(),
  payment_conditions: optionalText,
  start_date: optionalFinancialDateSchema,
  end_date: optionalFinancialDateSchema,
  signing_date: optionalFinancialDateSchema,
  closing_date: optionalFinancialDateSchema,
  notes: optionalText,
  attachments: z.unknown().optional(),
  created_by: optionalUUID,
  brokers: z.array(contractBrokerInputSchema).max(100).optional(),
};

function validateContractRelations(
  input: z.infer<z.ZodObject<typeof contractShape>>,
  ctx: z.RefinementCtx,
) {
  if (input.value !== undefined && Number(input.value) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "Valor deve ser maior que zero",
    });
  }
  if (
    input.value !== undefined &&
    input.down_payment != null &&
    Number(input.down_payment) > Number(input.value)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["down_payment"],
      message: "A entrada não pode exceder o valor total",
    });
  }
  if (input.start_date && input.end_date && input.end_date < input.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_date"],
      message: "A data final deve ser igual ou posterior à inicial",
    });
  }
  if (
    input.commission_percentage != null &&
    Number(input.commission_percentage) > 100
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commission_percentage"],
      message: "O percentual não pode exceder 100%",
    });
  }

  if (input.brokers) {
    const brokerIds = input.brokers.map((broker) => broker.user_id);
    if (new Set(brokerIds).size !== brokerIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["brokers"],
        message: "O mesmo corretor não pode ser adicionado mais de uma vez",
      });
    }
    const totalPercentage = input.brokers.reduce(
      (sum, broker) => sum + broker.commission_percentage,
      0,
    );
    if (totalPercentage > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["brokers"],
        message: "A soma das comissões não pode exceder 100%",
      });
    }
  }
}

export const financialContractCreateInputSchema = z
  .object(contractShape)
  .passthrough()
  .superRefine((input, ctx) => {
    for (const key of ["contract_type", "client_name", "value"] as const) {
      if (input[key] === undefined || input[key] === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Campo obrigatorio",
        });
      }
    }
    if (input.status !== undefined && input.status !== "draft") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Contratos novos devem iniciar como rascunho",
      });
    }
    rejectClientManagedFields(
      input,
      ["contract_number", "created_by"],
      ctx,
    );
    validateContractRelations(input, ctx);
  });
export const financialContractUpdateInputSchema = z
  .object(contractShape)
  .passthrough()
  .superRefine((input, ctx) => {
    rejectClientManagedFields(
      input,
      ["contract_number", "status", "created_by"],
      ctx,
    );
    validateContractRelations(input, ctx);
  })
  .refine(
    (input) => Object.keys(input).length > 0,
    "Informe ao menos uma alteracao",
  );

const commissionRuleShape = {
  name: z.string().trim().min(1).max(180).optional(),
  business_type: z.enum(["sale", "rental", "service", "all"]).optional(),
  commission_type: z.enum(["percentage", "fixed"]).optional(),
  commission_value: moneySchema.nullish(),
  percentage: moneySchema.nullish(),
  is_active: z.boolean().optional(),
};

function validateCommissionRule(
  input: z.infer<z.ZodObject<typeof commissionRuleShape>>,
  ctx: z.RefinementCtx,
) {
  if (input.commission_value != null && Number(input.commission_value) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commission_value"],
      message: "O valor da comissão deve ser maior que zero",
    });
  }
  if (
    input.commission_type === "percentage" &&
    input.commission_value != null &&
    Number(input.commission_value) > 100
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commission_value"],
      message: "O percentual não pode exceder 100%",
    });
  }
}

export const commissionRuleCreateInputSchema = z
  .object(commissionRuleShape)
  .passthrough()
  .superRefine((input, ctx) => {
    for (const key of [
      "name",
      "business_type",
      "commission_type",
      "commission_value",
    ] as const) {
      if (
        input[key] === undefined ||
        input[key] === null ||
        input[key] === ""
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Campo obrigatório",
        });
      }
    }
    validateCommissionRule(input, ctx);
  });
export const commissionRuleUpdateInputSchema = z
  .object(commissionRuleShape)
  .passthrough()
  .superRefine(validateCommissionRule)
  .refine(
    (input) => Object.keys(input).length > 0,
    "Informe ao menos uma alteracao",
  );

export const contractActivationInputSchema = z
  .object({ skipCommissions: z.boolean().optional() })
  .strict();
export const financialEntryPaymentInputSchema = z
  .object({ paid_value: z.number().finite().positive() })
  .strict();
export const commissionApproveInputSchema = z.object({}).strict();
export const commissionPaymentInputSchema = z
  .object({ payment_proof: z.string().trim().min(1).max(2_000).optional() })
  .strict();
export const commissionCancellationInputSchema = z
  .object({ notes: z.string().trim().min(1).max(2_000).optional() })
  .strict();
export const contractDocumentInputSchema = z
  .object({ path: z.string().trim().min(1).max(1_000) })
  .strict();
export const contractDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    path: z.string().trim().min(1).max(1_000),
    size: z
      .number()
      .int()
      .min(1)
      .max(25 * 1024 * 1024),
    uploaded_at: z.string().datetime({ offset: true }),
  })
  .passthrough();
export const apiContractDocumentResponseSchema = apiEnvelopeSchema(
  contractDocumentSchema,
);
export const apiContractDocumentsResponseSchema = apiEnvelopeSchema(
  z.array(contractDocumentSchema),
);
export const dreMappingInputSchema = z
  .object({
    category: z.string().trim().min(1).max(180),
    entry_type: z.enum(["payable", "receivable"]),
    group_id: uuidSchema,
  })
  .passthrough();
export const apiSignedUrlResponseSchema = apiEnvelopeSchema(
  z
    .object({
      signedUrl: z
        .string()
        .trim()
        .url()
        .refine((value) => {
          try {
            const protocol = new URL(value).protocol;
            return protocol === "https:" || protocol === "http:";
          } catch {
            return false;
          }
        }, "URL assinada inválida"),
    })
    .passthrough(),
);

export const commissionRegenerationResultSchema = z
  .object({
    commissionsCount: z.coerce.number().int().min(0),
    totalValue: responseNumberSchema.min(0),
  })
  .strict();

export const dreAccountGroupSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string().trim().min(1),
    group_type: z.enum([
      "revenue",
      "deduction",
      "cost",
      "expense",
      "financial_expense",
      "financial_revenue",
      "tax",
    ]),
    display_order: z.coerce.number().int(),
    parent_id: uuidSchema.nullish(),
    is_system: z.boolean(),
    created_at: responseDateSchema,
    updated_at: responseDateSchema,
  })
  .passthrough();

const dreMappingGroupSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(1),
    group_type: dreAccountGroupSchema.shape.group_type,
  })
  .strict();

export const dreAccountMappingSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    group_id: uuidSchema,
    category: z.string().trim().min(1),
    entry_type: z.enum(["receivable", "payable"]),
    created_at: responseDateSchema,
    updated_at: responseDateSchema,
    group: dreMappingGroupSchema.nullish(),
  })
  .passthrough();

export const financialEntrySchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    type: z.enum(["payable", "receivable"]),
    category: z.string().nullish(),
    category_group: z.string().nullish(),
    contract_id: uuidSchema.nullish(),
    lead_id: uuidSchema.nullish(),
    broker_id: uuidSchema.nullish(),
    description: z.string().nullish(),
    amount: responseNumberSchema,
    paid_amount: responseNumberSchema.nullish(),
    paid_value: responseNumberSchema.nullish(),
    due_date: responseDateSchema,
    paid_date: responseDateSchema,
    payment_method: z.string().nullish(),
    status: z.string().nullish(),
    notes: z.string().nullish(),
    created_at: responseDateSchema,
    updated_at: responseDateSchema,
    installment_number: z.coerce.number().int().nullish(),
    total_installments: z.coerce.number().int().nullish(),
    is_recurring: z.boolean().nullish(),
    recurring_type: z.enum(["monthly", "weekly", "yearly"]).nullish(),
    parent_entry_id: uuidSchema.nullish(),
    contract: z.object({ contract_number: z.string().nullish() }).nullish(),
    property: z
      .object({
        id: uuidSchema,
        code: z.string().nullish(),
        title: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough();

export const dreInputSchema = z
  .object({
    groups: z.array(dreAccountGroupSchema),
    mappings: z.array(dreAccountMappingSchema),
    entries: z.array(financialEntrySchema),
    previousEntries: z.array(financialEntrySchema),
  })
  .strict();

export const financialDashboardSchema = z
  .object({
    receivable30: responseNumberSchema,
    receivable60: responseNumberSchema,
    receivable90: responseNumberSchema,
    confirmedRevenue30: responseNumberSchema,
    confirmedRevenueYTD: responseNumberSchema,
    totalPayable: responseNumberSchema,
    forecastCommissions: responseNumberSchema,
    paidCommissions: responseNumberSchema,
    pendingCommissions: responseNumberSchema,
    overdueReceivables: responseNumberSchema,
    overduePayables: responseNumberSchema,
    monthlyData: z.array(
      z
        .object({
          month: z.string().trim().min(1).max(40),
          receitas: responseNumberSchema,
          despesas: responseNumberSchema,
        })
        .strict(),
    ),
    totalLeadsValue: responseNumberSchema,
    vgvBruto: responseNumberSchema,
    vgvLiquido: responseNumberSchema,
    totalContractsValue: responseNumberSchema,
    activeContracts: responseNumberSchema,
    wonLeadsCount: responseNumberSchema,
    avgTicket: responseNumberSchema,
    conversionRate: responseNumberSchema,
    annualProjection: responseNumberSchema,
    defaultRate: responseNumberSchema,
  })
  .passthrough();

export const commissionBrokerSummarySchema = z
  .object({
    user: z
      .object({
        id: uuidSchema,
        name: z.string().trim().min(1).nullish(),
        email: z.string().trim().email().nullish(),
      })
      .strict(),
    forecast: responseNumberSchema,
    approved: responseNumberSchema,
    paid: responseNumberSchema,
    total: responseNumberSchema,
  })
  .passthrough();

export const financialCategorySchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string().trim().min(1),
    type: z.enum(["income", "expense"]),
    category_group: z.string().nullish(),
    created_at: responseDateSchema,
  })
  .passthrough();

export const commissionRuleSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string().trim().min(1),
    business_type: z.enum(["sale", "rental", "service", "all"]),
    commission_type: z.enum(["percentage", "fixed"]),
    commission_value: responseNumberSchema,
    is_active: legacyResponseBooleanSchema,
    created_at: responseDateSchema,
  })
  .passthrough();

const commissionStatusSchema = z.preprocess(
  (value) => {
    if (value === null) return "pending";
    if (typeof value !== "string") return value;
    const aliases: Record<string, string> = {
      prevista: "forecast",
      pendente: "pending",
      aprovada: "approved",
      paga: "paid",
      cancelada: "cancelled",
    };
    const normalized = value.trim().toLowerCase();
    return aliases[normalized] ?? normalized;
  },
  z.enum(["forecast", "pending", "approved", "paid", "cancelled"]),
);

export const commissionSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    contract_id: uuidSchema.nullish(),
    user_id: uuidSchema,
    property_id: uuidSchema.nullish(),
    rule_id: uuidSchema.nullish(),
    amount: responseNumberSchema.nullish(),
    base_value: legacyResponseNumberSchema,
    percentage: responseNumberSchema.nullish(),
    calculated_value: legacyResponseNumberSchema,
    status: commissionStatusSchema,
    forecast_date: responseDateSchema,
    approved_at: responseDateSchema,
    approved_by: uuidSchema.nullish(),
    paid_at: responseDateSchema,
    paid_by: uuidSchema.nullish(),
    payment_proof: z.string().nullish(),
    notes: z.string().nullish(),
    created_at: responseDateSchema,
    updated_at: responseDateSchema,
    user: z
      .object({
        id: uuidSchema,
        name: z.string().nullish(),
        email: z.string().nullish(),
      })
      .nullish(),
    contract: z
      .object({
        contract_number: z.string().nullish(),
        client_name: z.string().nullish(),
      })
      .nullish(),
    property: z
      .object({
        code: z.string().nullish(),
        title: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough();

const contractBrokerSchema = z
  .object({
    id: uuidSchema,
    contract_id: uuidSchema,
    user_id: uuidSchema,
    commission_percentage: legacyResponseNumberSchema,
    commission_value: responseNumberSchema.nullish(),
    role: z.string().nullish(),
    created_at: responseDateSchema,
    user: z
      .object({
        id: uuidSchema,
        name: z.string().nullish(),
        email: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough();

export const financialContractSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    contract_number: z.string().nullish(),
    contract_type: z.string().nullish(),
    status: z.string().nullish(),
    property_id: uuidSchema.nullish(),
    lead_id: uuidSchema.nullish(),
    value: responseNumberSchema.nullish(),
    commission_percentage: responseNumberSchema.nullish(),
    commission_value: responseNumberSchema.nullish(),
    client_name: z.string().nullish(),
    client_email: z.string().nullish(),
    client_phone: z.string().nullish(),
    client_document: z.string().nullish(),
    down_payment: responseNumberSchema.nullish(),
    installments: z.coerce.number().int().nullish(),
    payment_conditions: z.string().nullish(),
    start_date: responseDateSchema,
    end_date: responseDateSchema,
    signing_date: responseDateSchema,
    closing_date: responseDateSchema,
    notes: z.string().nullish(),
    attachments: z.unknown().optional(),
    created_by: uuidSchema.nullish(),
    created_at: responseDateSchema,
    updated_at: responseDateSchema,
    property: z
      .object({
        id: uuidSchema,
        code: z.string().nullish(),
        title: z.string().nullish(),
        endereco: z.string().nullish(),
      })
      .nullish(),
    lead: z
      .object({
        id: uuidSchema,
        name: z.string().nullish(),
        email: z.string().nullish(),
        phone: z.string().nullish(),
      })
      .nullish(),
    brokers: z.array(contractBrokerSchema),
    entries: z.array(financialEntrySchema).optional(),
    commissions: z.array(commissionSchema).optional(),
  })
  .passthrough();

export const apiFinancialEntriesResponseSchema = apiEnvelopeSchema(
  z.array(financialEntrySchema),
);
export const apiFinancialEntryResponseSchema =
  apiEnvelopeSchema(financialEntrySchema);
export const apiFinancialDashboardResponseSchema = apiEnvelopeSchema(
  financialDashboardSchema,
);
export const apiCommissionBrokerSummariesResponseSchema = apiEnvelopeSchema(
  z.array(commissionBrokerSummarySchema),
);
export const apiFinancialCategoryResponseSchema = apiEnvelopeSchema(
  financialCategorySchema,
);
export const apiFinancialCategoriesResponseSchema = apiEnvelopeSchema(
  z.array(financialCategorySchema),
);
export const apiCommissionRuleResponseSchema =
  apiEnvelopeSchema(commissionRuleSchema);
export const apiCommissionRulesResponseSchema = apiEnvelopeSchema(
  z.array(commissionRuleSchema),
);
export const apiCommissionResponseSchema = apiEnvelopeSchema(commissionSchema);
export const apiCommissionsResponseSchema = apiEnvelopeSchema(
  z.array(commissionSchema),
);
export const apiFinancialContractResponseSchema = apiEnvelopeSchema(
  financialContractSchema,
);
export const apiFinancialContractsResponseSchema = apiEnvelopeSchema(
  z.array(financialContractSchema),
);
export const apiCommissionRegenerationResponseSchema = apiEnvelopeSchema(
  commissionRegenerationResultSchema,
);
export const apiDREInputResponseSchema = apiEnvelopeSchema(dreInputSchema);
export const apiDREGroupsResponseSchema = apiEnvelopeSchema(
  z.array(dreAccountGroupSchema),
);
export const apiDREMappingsResponseSchema = apiEnvelopeSchema(
  z.array(dreAccountMappingSchema),
);
export const apiDREMappingResponseSchema = apiEnvelopeSchema(
  dreAccountMappingSchema,
);

export type ContractDocument = z.infer<typeof contractDocumentSchema>;
