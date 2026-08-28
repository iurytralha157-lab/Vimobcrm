import assert from "node:assert/strict";
import test from "node:test";

import {
  apiContractDocumentResponseSchema,
  apiContractDocumentsResponseSchema,
  apiCommissionBrokerSummariesResponseSchema,
  apiCommissionRegenerationResponseSchema,
  apiCommissionRulesResponseSchema,
  apiCommissionsResponseSchema,
  apiFinancialContractsResponseSchema,
  apiFinancialContractResponseSchema,
  apiFinancialDashboardResponseSchema,
  apiFinancialEntriesResponseSchema,
  apiDREGroupsResponseSchema,
  apiDREInputResponseSchema,
  apiDREMappingsResponseSchema,
  apiSignedUrlResponseSchema,
  addMonthsToFinancialCalendarDate,
  commissionApproveInputSchema,
  commissionCancellationInputSchema,
  commissionPaymentInputSchema,
  commissionRuleCreateInputSchema,
  financialContractCreateInputSchema,
  financialContractUpdateInputSchema,
  financialEntryCreateInputSchema,
  financialEntryPaymentInputSchema,
  financialEntryUpdateInputSchema,
  splitFinancialAmountIntoInstallments,
} from "./financial";

const validDocument = {
  name: "contrato.pdf",
  path: "0f1c6daa-0601-4bd8-b130-c90c6a748db8/bc799028-8b9f-4cf9-bd09-3b591ef3d448/1720000000000_contrato.pdf",
  size: 1024,
  uploaded_at: "2026-08-16T12:00:00Z",
};

test("contract document response accepts the API contract", () => {
  assert.equal(
    apiContractDocumentResponseSchema.safeParse({ data: validDocument })
      .success,
    true,
  );
  assert.equal(
    apiContractDocumentsResponseSchema.safeParse({ data: [validDocument] })
      .success,
    true,
  );
});

test("contract document response rejects malformed metadata", () => {
  assert.equal(
    apiContractDocumentsResponseSchema.safeParse({
      data: [{ ...validDocument, size: 0 }],
    }).success,
    false,
  );
  assert.equal(
    apiContractDocumentsResponseSchema.safeParse({
      data: [{ ...validDocument, uploaded_at: "not-a-date" }],
    }).success,
    false,
  );
});

test("signed contract document URL accepts only HTTP protocols", () => {
  assert.equal(
    apiSignedUrlResponseSchema.safeParse({
      data: {
        signedUrl:
          "https://supabase.example/storage/v1/object/sign/document.pdf?token=token",
      },
    }).success,
    true,
  );
  assert.equal(
    apiSignedUrlResponseSchema.safeParse({
      data: { signedUrl: "javascript:alert(1)" },
    }).success,
    false,
  );
  assert.equal(
    apiSignedUrlResponseSchema.safeParse({
      data: { signedUrl: "not-a-url" },
    }).success,
    false,
  );
});

test("financial list responses coerce database numerics and validate relations", () => {
  const response = apiFinancialEntriesResponseSchema.parse({
    data: [
      {
        id: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
        organization_id: "bc799028-8b9f-4cf9-bd09-3b591ef3d448",
        type: "receivable",
        amount: "1500.50",
        due_date: "2026-08-16",
        property: {
          id: "621908de-792b-4395-a6d1-b7c99ab6cc55",
          code: "AP001",
          title: "Apartamento Centro",
        },
      },
    ],
  });

  assert.equal(response.data[0].amount, 1500.5);
  assert.equal(response.data[0].property?.code, "AP001");
  assert.equal(
    apiFinancialEntriesResponseSchema.safeParse({
      data: [{ type: "receivable" }],
    }).success,
    false,
  );
});

test("financial dashboard rejects incomplete or non-finite metrics", () => {
  const validDashboard = {
    receivable30: 1,
    receivable60: 2,
    receivable90: 3,
    confirmedRevenue30: 4,
    confirmedRevenueYTD: 5,
    totalPayable: 6,
    forecastCommissions: 7,
    paidCommissions: 8,
    pendingCommissions: 9,
    overdueReceivables: 10,
    overduePayables: 11,
    monthlyData: [{ month: "Ago/26", receitas: 12, despesas: 13 }],
    totalLeadsValue: 14,
    vgvBruto: 15,
    vgvLiquido: 16,
    totalContractsValue: 17,
    activeContracts: 18,
    wonLeadsCount: 19,
    avgTicket: 20,
    conversionRate: 21,
    annualProjection: 22,
    defaultRate: 23,
  };

  assert.equal(
    apiFinancialDashboardResponseSchema.safeParse({ data: validDashboard })
      .success,
    true,
  );
  assert.equal(
    apiFinancialDashboardResponseSchema.safeParse({
      data: { ...validDashboard, avgTicket: "NaN" },
    }).success,
    false,
  );
  assert.equal(
    apiFinancialDashboardResponseSchema.safeParse({
      data: { ...validDashboard, monthlyData: [] },
      extra: true,
    }).success,
    true,
  );
});

test("commission broker summaries require an identifiable user", () => {
  assert.equal(
    apiCommissionBrokerSummariesResponseSchema.safeParse({
      data: [
        {
          user: {
            id: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
            name: "Corretor QA",
            email: "corretor@example.com",
          },
          forecast: "10",
          approved: 20,
          paid: 30,
          total: 60,
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    apiCommissionBrokerSummariesResponseSchema.safeParse({
      data: [{ user: null, forecast: 0, approved: 0, paid: 0, total: 0 }],
    }).success,
    false,
  );
  assert.equal(
    apiCommissionBrokerSummariesResponseSchema.safeParse({
      data: [
        {
          user: {
            id: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
            name: null,
            email: null,
          },
          forecast: 0,
          approved: 0,
          paid: 0,
          total: 0,
        },
      ],
    }).success,
    true,
  );
});

test("contract and commission lists reject malformed tenant records", () => {
  const contract = {
    id: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
    organization_id: "bc799028-8b9f-4cf9-bd09-3b591ef3d448",
    contract_number: "CTR-001",
    contract_type: "sale",
    status: "active",
    value: "450000",
    brokers: [],
  };
  const commission = {
    id: "621908de-792b-4395-a6d1-b7c99ab6cc55",
    organization_id: contract.organization_id,
    user_id: "f839c42f-99fe-48b0-b0f0-0e42a5d15369",
    base_value: "450000",
    calculated_value: "22500",
    status: "forecast",
  };

  assert.equal(
    apiFinancialContractsResponseSchema.safeParse({ data: [contract] }).success,
    true,
  );
  assert.equal(
    apiCommissionsResponseSchema.safeParse({ data: [commission] }).success,
    true,
  );
  assert.equal(
    apiCommissionsResponseSchema.parse({
      data: [{ ...commission, status: "prevista" }],
    }).data[0].status,
    "forecast",
  );
  assert.equal(
    apiFinancialContractsResponseSchema.safeParse({
      data: [{ ...contract, id: "invalid" }],
    }).success,
    false,
  );
  assert.equal(
    apiCommissionsResponseSchema.safeParse({
      data: [{ ...commission, status: "unknown" }],
    }).success,
    false,
  );
});

test("contract details accept normalized commissions with an identifiable user", () => {
  const organizationId = "bc799028-8b9f-4cf9-bd09-3b591ef3d448";
  const userId = "f839c42f-99fe-48b0-b0f0-0e42a5d15369";
  const parsed = apiFinancialContractResponseSchema.parse({
    data: {
      id: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
      organization_id: organizationId,
      contract_number: "CTR-001",
      contract_type: "sale",
      status: "active",
      value: "450000",
      brokers: [],
      entries: [],
      commissions: [
        {
          id: "621908de-792b-4395-a6d1-b7c99ab6cc55",
          organization_id: organizationId,
          user_id: userId,
          amount: "22500",
          base_value: null,
          calculated_value: null,
          status: null,
          user: {
            id: userId,
            name: "Corretor QA",
            email: "corretor@example.com",
          },
        },
      ],
    },
  });

  assert.equal(parsed.data.commissions?.[0].base_value, 0);
  assert.equal(parsed.data.commissions?.[0].calculated_value, 0);
  assert.equal(parsed.data.commissions?.[0].status, "pending");
  assert.equal(parsed.data.commissions?.[0].user?.id, userId);

  assert.equal(
    apiFinancialContractResponseSchema.safeParse({
      data: {
        ...parsed.data,
        commissions: [
          {
            ...parsed.data.commissions?.[0],
            user: { name: "Corretor sem ID" },
          },
        ],
      },
    }).success,
    false,
  );
});

test("commission rules validate supported calculation modes", () => {
  const rule = {
    id: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
    organization_id: "bc799028-8b9f-4cf9-bd09-3b591ef3d448",
    name: "Venda padrão",
    business_type: "sale",
    commission_type: "percentage",
    commission_value: "5",
    is_active: true,
  };

  assert.equal(
    apiCommissionRulesResponseSchema.safeParse({ data: [rule] }).success,
    true,
  );
  assert.equal(
    apiCommissionRulesResponseSchema.safeParse({
      data: [{ ...rule, commission_type: "script" }],
    }).success,
    false,
  );

  const normalizedLegacyRule = apiCommissionRulesResponseSchema.parse({
    data: [{ ...rule, is_active: null }],
  });
  assert.equal(normalizedLegacyRule.data[0].is_active, true);
});

test("financial calendar math preserves civil dates and clamps month ends", () => {
  assert.equal(addMonthsToFinancialCalendarDate("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToFinancialCalendarDate("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsToFinancialCalendarDate("2026-12-15", 2), "2027-02-15");
  assert.throws(() => addMonthsToFinancialCalendarDate("2026-02-31", 1));
});

test("financial installments preserve the exact total in cents", () => {
  const installments = splitFinancialAmountIntoInstallments(100, 3);
  assert.deepEqual(installments, [33.34, 33.33, 33.33]);
  assert.equal(
    Math.round(installments.reduce((sum, amount) => sum + amount, 0) * 100),
    10_000,
  );
  assert.throws(() => splitFinancialAmountIntoInstallments(0.01, 2));
});

test("financial entry input requires valid amount, date and recurrence", () => {
  const validEntry = {
    type: "receivable",
    category: "Venda",
    description: "Parcela do contrato",
    amount: 1_500.5,
    due_date: "2026-08-16",
  };

  assert.equal(
    financialEntryCreateInputSchema.safeParse(validEntry).success,
    true,
  );
  assert.equal(
    financialEntryCreateInputSchema.safeParse({ ...validEntry, amount: 0 })
      .success,
    false,
  );
  assert.equal(
    financialEntryCreateInputSchema.safeParse({
      ...validEntry,
      due_date: "2026-02-31",
    }).success,
    false,
  );
  assert.equal(
    financialEntryCreateInputSchema.safeParse({
      ...validEntry,
      is_recurring: true,
    }).success,
    false,
  );
  for (const managedField of [
    "status",
    "paid_amount",
    "paid_value",
    "paid_date",
    "created_by",
  ]) {
    assert.equal(
      financialEntryCreateInputSchema.safeParse({
        ...validEntry,
        [managedField]: managedField === "status" ? "paid" : 1,
      }).success,
      false,
    );
  }
  assert.equal(
    financialEntryUpdateInputSchema.safeParse({
      description: "Atualizada",
      created_by: "0f1c6daa-0601-4bd8-b130-c90c6a748db8",
    }).success,
    false,
  );
});

test("contract input rejects inconsistent values and unsupported broker fields", () => {
  const firstBroker = "0f1c6daa-0601-4bd8-b130-c90c6a748db8";
  const secondBroker = "bc799028-8b9f-4cf9-bd09-3b591ef3d448";
  const validContract = {
    contract_type: "sale",
    client_name: "Cliente QA",
    value: 450_000,
    down_payment: 50_000,
    start_date: "2026-08-16",
    end_date: "2026-09-16",
    brokers: [
      { user_id: firstBroker, commission_percentage: 40 },
      { user_id: secondBroker, commission_percentage: 60 },
    ],
  };

  assert.equal(
    financialContractCreateInputSchema.safeParse(validContract).success,
    true,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      ...validContract,
      status: "active",
    }).success,
    false,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      ...validContract,
      status: "draft",
    }).success,
    true,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      ...validContract,
      down_payment: 500_000,
    }).success,
    false,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      ...validContract,
      start_date: "2026-09-17",
    }).success,
    false,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      ...validContract,
      brokers: [
        { user_id: firstBroker, commission_percentage: 50 },
        { user_id: firstBroker, commission_percentage: 50 },
      ],
    }).success,
    false,
  );
  assert.equal(
    financialContractCreateInputSchema.safeParse({
      ...validContract,
      brokers: [
        {
          user_id: firstBroker,
          commission_percentage: 100,
          role: "closer",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    financialContractUpdateInputSchema.safeParse({ status: "active" }).success,
    false,
  );
  assert.equal(
    financialContractUpdateInputSchema.safeParse({
      created_by: firstBroker,
    }).success,
    false,
  );
});

test("regeneration and DRE responses enforce their API contracts", () => {
  const organizationId = "bc799028-8b9f-4cf9-bd09-3b591ef3d448";
  const groupId = "0f1c6daa-0601-4bd8-b130-c90c6a748db8";
  const mappingId = "621908de-792b-4395-a6d1-b7c99ab6cc55";
  const entryId = "f839c42f-99fe-48b0-b0f0-0e42a5d15369";
  const group = {
    id: groupId,
    organization_id: organizationId,
    name: "Receita de vendas",
    group_type: "revenue",
    display_order: 1,
    parent_id: null,
    is_system: true,
    created_at: "2026-08-16T12:00:00Z",
    updated_at: "2026-08-16T12:00:00Z",
  };
  const mapping = {
    id: mappingId,
    organization_id: organizationId,
    group_id: groupId,
    category: "Venda",
    entry_type: "receivable",
    created_at: "2026-08-16T12:00:00Z",
    updated_at: "2026-08-16T12:00:00Z",
    group: { id: groupId, name: group.name, group_type: group.group_type },
  };
  const entry = {
    id: entryId,
    organization_id: organizationId,
    type: "receivable",
    category: "Venda",
    amount: "100.01",
    status: "paid",
    paid_date: "2026-08-16",
  };

  assert.equal(
    apiCommissionRegenerationResponseSchema.safeParse({
      data: { commissionsCount: 2, totalValue: "4500.50" },
    }).success,
    true,
  );
  assert.equal(
    apiCommissionRegenerationResponseSchema.safeParse({
      data: { commissionsCount: -1, totalValue: 0 },
    }).success,
    false,
  );
  assert.equal(
    apiDREGroupsResponseSchema.safeParse({ data: [group] }).success,
    true,
  );
  assert.equal(
    apiDREMappingsResponseSchema.safeParse({ data: [mapping] }).success,
    true,
  );
  assert.equal(
    apiDREInputResponseSchema.safeParse({
      data: {
        groups: [group],
        mappings: [mapping],
        entries: [entry],
        previousEntries: [],
      },
    }).success,
    true,
  );
  assert.equal(
    apiDREInputResponseSchema.safeParse({
      data: { groups: [group], mappings: [mapping], entries: [entry] },
    }).success,
    false,
  );
  assert.equal(
    apiDREMappingsResponseSchema.safeParse({
      data: [{ ...mapping, entry_type: "other" }],
    }).success,
    false,
  );
});

test("commission and payment actions reject invalid or unexpected values", () => {
  assert.equal(
    commissionRuleCreateInputSchema.safeParse({
      name: "Venda padrão",
      business_type: "sale",
      commission_type: "percentage",
      commission_value: 5,
      is_active: true,
    }).success,
    true,
  );
  assert.equal(
    commissionRuleCreateInputSchema.safeParse({
      name: "Percentual inválido",
      business_type: "sale",
      commission_type: "percentage",
      commission_value: 101,
    }).success,
    false,
  );
  assert.equal(
    financialEntryPaymentInputSchema.safeParse({ paid_value: -1 }).success,
    false,
  );
  assert.equal(financialEntryPaymentInputSchema.safeParse({}).success, false);
  assert.equal(
    financialEntryPaymentInputSchema.safeParse({ paid_value: 100 }).success,
    true,
  );
  assert.equal(
    commissionApproveInputSchema.safeParse({ notes: "unexpected" }).success,
    false,
  );
  assert.equal(
    commissionPaymentInputSchema.safeParse({ payment_proof: "ref-123" })
      .success,
    true,
  );
  assert.equal(
    commissionCancellationInputSchema.safeParse({ notes: "Duplicidade" })
      .success,
    true,
  );
});
