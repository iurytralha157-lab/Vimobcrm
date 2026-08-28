import {
  apiContractDocumentResponseSchema,
  apiContractDocumentsResponseSchema,
  apiCommissionBrokerSummariesResponseSchema,
  apiCommissionRegenerationResponseSchema,
  apiCommissionResponseSchema,
  apiCommissionRuleResponseSchema,
  apiCommissionRulesResponseSchema,
  apiCommissionsResponseSchema,
  apiFinancialDashboardResponseSchema,
  apiFinancialCategoriesResponseSchema,
  apiFinancialCategoryResponseSchema,
  apiFinancialContractResponseSchema,
  apiFinancialContractsResponseSchema,
  apiFinancialEntryResponseSchema,
  apiFinancialEntriesResponseSchema,
  apiDREGroupsResponseSchema,
  apiDREInputResponseSchema,
  apiDREMappingResponseSchema,
  apiDREMappingsResponseSchema,
  apiSignedUrlResponseSchema,
  commissionRuleCreateInputSchema,
  commissionRuleUpdateInputSchema,
  commissionApproveInputSchema,
  commissionCancellationInputSchema,
  commissionPaymentInputSchema,
  contractActivationInputSchema,
  contractDocumentInputSchema,
  dreMappingInputSchema,
  financialCategoryInputSchema,
  financialContractCreateInputSchema,
  financialContractUpdateInputSchema,
  financialEntryCreateInputSchema,
  financialEntryPaymentInputSchema,
  financialEntryUpdateInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from "@/lib/validation";
import { vimobAPIRequest } from "./vimob-client";

type Envelope<T> = { data: T };
type Query = Record<string, string | number | boolean | null | undefined>;

const financialListPageSize = 200;

async function listAllFinancialPages(
  path: string,
  query: Query,
  organizationId: string | null | undefined,
  parsePage: (response: unknown) => unknown[],
) {
  if (query.limit != null || query.offset != null) {
    const response = await vimobAPIRequest<Envelope<unknown[]>>(path, {
      organizationId,
      query,
    });
    return parsePage(response);
  }

  const items: unknown[] = [];
  let offset = 0;
  for (;;) {
    const response = await vimobAPIRequest<Envelope<unknown[]>>(path, {
      organizationId,
      query: { ...query, limit: financialListPageSize, offset },
    });
    const page = parsePage(response);
    items.push(...page);
    if (page.length < financialListPageSize) return items;
    offset += page.length;
  }
}

export const financialAPI = {
  async listCategories<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/financial/categories",
      { organizationId },
    );
    return validateDomainResponse(
      apiFinancialCategoriesResponseSchema,
      response,
      "financial.categories.list",
    ).data as T;
  },

  async createCategory<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(
      financialCategoryInputSchema,
      body,
      "financial.categories.create",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/financial/categories",
      {
        method: "POST",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiFinancialCategoryResponseSchema,
      response,
      "financial.categories.create",
    ).data as T;
  },

  async listEntries<T>(query: Query = {}, organizationId?: string | null) {
    const items = await listAllFinancialPages(
      "/v1/financial/entries",
      query,
      organizationId,
      (response) =>
        validateDomainResponse(
          apiFinancialEntriesResponseSchema,
          response,
          "financial.entries.list",
        ).data,
    );
    return items as T;
  },

  async createEntry<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(
      financialEntryCreateInputSchema,
      body,
      "financial.entries.create",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/financial/entries",
      {
        method: "POST",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiFinancialEntryResponseSchema,
      response,
      "financial.entries.create",
    ).data as T;
  },

  async updateEntry<T>(
    id: string,
    body: unknown,
    organizationId?: string | null,
  ) {
    const validatedBody = parseDomainInput(
      financialEntryUpdateInputSchema,
      body,
      "financial.entries.update",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/financial/entries/${id}`,
      {
        method: "PATCH",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiFinancialEntryResponseSchema,
      response,
      "financial.entries.update",
    ).data as T;
  },

  async deleteEntry(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/financial/entries/${id}`, {
      method: "DELETE",
      organizationId,
    });
  },

  async markEntryPaid<T>(
    id: string,
    body: unknown,
    organizationId?: string | null,
  ) {
    const validatedBody = parseDomainInput(
      financialEntryPaymentInputSchema,
      body,
      "financial.entries.pay",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/financial/entries/${id}/pay`,
      {
        method: "POST",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiFinancialEntryResponseSchema,
      response,
      "financial.entries.pay",
    ).data as T;
  },

  async dashboard<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/financial/dashboard",
      { organizationId },
    );
    return validateDomainResponse(
      apiFinancialDashboardResponseSchema,
      response,
      "financial.dashboard",
    ).data as T;
  },

  async listContracts<T>(query: Query = {}, organizationId?: string | null) {
    const items = await listAllFinancialPages(
      "/v1/contracts",
      query,
      organizationId,
      (response) =>
        validateDomainResponse(
          apiFinancialContractsResponseSchema,
          response,
          "financial.contracts.list",
        ).data,
    );
    return items as T;
  },

  async getContract<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}`, {
      organizationId,
    });
    return validateDomainResponse(
      apiFinancialContractResponseSchema,
      response,
      "financial.contracts.get",
    ).data as T;
  },

  async createContract<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(
      financialContractCreateInputSchema,
      body,
      "financial.contracts.create",
    );
    const response = await vimobAPIRequest<Envelope<T>>("/v1/contracts", {
      method: "POST",
      organizationId,
      body: validatedBody,
    });
    return validateDomainResponse(
      apiFinancialContractResponseSchema,
      response,
      "financial.contracts.create",
    ).data as T;
  },

  async updateContract<T>(
    id: string,
    body: unknown,
    organizationId?: string | null,
  ) {
    const validatedBody = parseDomainInput(
      financialContractUpdateInputSchema,
      body,
      "financial.contracts.update",
    );
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/contracts/${id}`, {
      method: "PATCH",
      organizationId,
      body: validatedBody,
    });
    return validateDomainResponse(
      apiFinancialContractResponseSchema,
      response,
      "financial.contracts.update",
    ).data as T;
  },

  async deleteContract(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/contracts/${id}`, {
      method: "DELETE",
      organizationId,
    });
  },

  async activateContract<T>(
    id: string,
    body: unknown,
    organizationId?: string | null,
  ) {
    const validatedBody = parseDomainInput(
      contractActivationInputSchema,
      body,
      "financial.contracts.activate",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/contracts/${id}/activate`,
      {
        method: "POST",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiFinancialContractResponseSchema,
      response,
      "financial.contracts.activate",
    ).data as T;
  },

  async regenerateCommissions<T>(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/contracts/${id}/regenerate-commissions`,
      {
        method: "POST",
        organizationId,
        body: {},
      },
    );
    return validateDomainResponse(
      apiCommissionRegenerationResponseSchema,
      response,
      "financial.contracts.regenerate-commissions",
    ).data as T;
  },

  async listContractDocuments(id: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<unknown>>(
      `/v1/contracts/${id}/documents`,
      { organizationId },
    );
    return validateDomainResponse(
      apiContractDocumentsResponseSchema,
      response,
      "financial.contracts.documents.list",
    ).data;
  },

  async uploadContractDocument(
    id: string,
    file: File,
    organizationId?: string | null,
  ) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await vimobAPIRequest<Envelope<unknown>>(
      `/v1/contracts/${id}/documents`,
      {
        method: "POST",
        organizationId,
        body: formData,
      },
    );
    return validateDomainResponse(
      apiContractDocumentResponseSchema,
      response,
      "financial.contracts.documents.upload",
    ).data;
  },

  async deleteContractDocument(
    id: string,
    path: string,
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      contractDocumentInputSchema,
      { path },
      "financial.contracts.documents.delete",
    );
    await vimobAPIRequest<{ ok: boolean }>(`/v1/contracts/${id}/documents`, {
      method: "DELETE",
      organizationId,
      body,
    });
  },

  async contractDocumentSignedURL(
    id: string,
    path: string,
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      contractDocumentInputSchema,
      { path },
      "financial.contracts.documents.signed-url",
    );
    const response = await vimobAPIRequest<Envelope<{ signedUrl: string }>>(
      `/v1/contracts/${id}/documents/signed-url`,
      {
        method: "POST",
        organizationId,
        body,
      },
    );
    return validateDomainResponse(
      apiSignedUrlResponseSchema,
      response,
      "financial.contracts.documents.signed-url",
    ).data.signedUrl;
  },

  async listCommissionRules<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/commission-rules",
      { organizationId },
    );
    return validateDomainResponse(
      apiCommissionRulesResponseSchema,
      response,
      "financial.commission-rules.list",
    ).data as T;
  },

  async createCommissionRule<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(
      commissionRuleCreateInputSchema,
      body,
      "financial.commission-rules.create",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/commission-rules",
      {
        method: "POST",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiCommissionRuleResponseSchema,
      response,
      "financial.commission-rules.create",
    ).data as T;
  },

  async updateCommissionRule<T>(
    id: string,
    body: unknown,
    organizationId?: string | null,
  ) {
    const validatedBody = parseDomainInput(
      commissionRuleUpdateInputSchema,
      body,
      "financial.commission-rules.update",
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/commission-rules/${id}`,
      {
        method: "PATCH",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiCommissionRuleResponseSchema,
      response,
      "financial.commission-rules.update",
    ).data as T;
  },

  async deleteCommissionRule(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/commission-rules/${id}`, {
      method: "DELETE",
      organizationId,
    });
  },

  async listCommissions<T>(query: Query = {}, organizationId?: string | null) {
    const items = await listAllFinancialPages(
      "/v1/commissions",
      query,
      organizationId,
      (response) =>
        validateDomainResponse(
          apiCommissionsResponseSchema,
          response,
          "financial.commissions.list",
        ).data,
    );
    return items as T;
  },

  async commissionAction<T>(
    id: string,
    action: "approve" | "pay" | "cancel",
    body: unknown,
    organizationId?: string | null,
  ) {
    const actionSchema =
      action === "approve"
        ? commissionApproveInputSchema
        : action === "pay"
          ? commissionPaymentInputSchema
          : commissionCancellationInputSchema;
    const validatedBody = parseDomainInput(
      actionSchema,
      body,
      `financial.commissions.${action}`,
    );
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/commissions/${id}/${action}`,
      {
        method: "POST",
        organizationId,
        body: validatedBody,
      },
    );
    return validateDomainResponse(
      apiCommissionResponseSchema,
      response,
      `financial.commissions.${action}`,
    ).data as T;
  },

  async commissionsByBroker<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>(
      "/v1/commissions/by-broker",
      { organizationId },
    );
    return validateDomainResponse(
      apiCommissionBrokerSummariesResponseSchema,
      response,
      "financial.commissions.by-broker",
    ).data as T;
  },

  async dreInput<T>(query: Query, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>("/v1/dre/input", {
      organizationId,
      query,
    });
    return validateDomainResponse(
      apiDREInputResponseSchema,
      response,
      "financial.dre.input",
    ).data as T;
  },

  async dreGroups<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>("/v1/dre/groups", {
      organizationId,
    });
    return validateDomainResponse(
      apiDREGroupsResponseSchema,
      response,
      "financial.dre.groups",
    ).data as T;
  },

  async dreMappings<T>(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T>>("/v1/dre/mappings", {
      organizationId,
    });
    return validateDomainResponse(
      apiDREMappingsResponseSchema,
      response,
      "financial.dre.mappings",
    ).data as T;
  },

  async createDREMapping<T>(body: unknown, organizationId?: string | null) {
    const validatedBody = parseDomainInput(
      dreMappingInputSchema,
      body,
      "financial.dre.mappings.create",
    );
    const response = await vimobAPIRequest<Envelope<T>>("/v1/dre/mappings", {
      method: "POST",
      organizationId,
      body: validatedBody,
    });
    return validateDomainResponse(
      apiDREMappingResponseSchema,
      response,
      "financial.dre.mappings.create",
    ).data as T;
  },

  async deleteDREMapping(id: string, organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/dre/mappings/${id}`, {
      method: "DELETE",
      organizationId,
    });
  },

  async initializeDREGroups(organizationId?: string | null) {
    await vimobAPIRequest<{ ok: boolean }>("/v1/dre/groups/initialize", {
      method: "POST",
      organizationId,
      body: {},
    });
  },
};
