import { getAPIBaseURL, vimobAPIRequest } from "@/lib/api/vimob-client";
import {
  apiChavesNaMaoIntegrationResponseSchema,
  apiChavesNaMaoPublicationListResponseSchema,
  apiOptionalChavesNaMaoIntegrationResponseSchema,
  chavesNaMaoIntegrationInputSchema,
  chavesNaMaoPublicationsInputSchema,
  parseDomainInput,
  validateDomainResponse,
  type ChavesNaMaoIntegration,
} from "@/lib/validation";

export const CHAVES_NA_MAO_HOMOLOGATION_REQUIRED_CODE =
  "chaves_na_mao_homologation_required";

export type ChavesNaMaoIntegrationInput = {
  settings?: {
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    detail_base_url?: string;
  };
};

export type ChavesNaMaoPublicationInput = {
  propertyId: string;
  clientListingId?: string;
  publicationType: "STANDARD" | "FEATURED";
  isEnabled?: boolean;
};

export function isChavesNaMaoHomologationRequired(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === CHAVES_NA_MAO_HOMOLOGATION_REQUIRED_CODE
  );
}

export function getChavesNaMaoFeedURL(
  integration?: ChavesNaMaoIntegration | null,
) {
  const token = integration?.feed_token?.trim();
  if (!token || integration?.status === "draft") return null;
  return `${getAPIBaseURL()}/v1/public/integrations/portals/chaves-na-mao/feed/${token}.xml`;
}

export const chavesNaMaoIntegrationsAPI = {
  async get(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao",
      { organizationId },
    );
    return validateDomainResponse(
      apiOptionalChavesNaMaoIntegrationResponseSchema,
      response,
      "integrations.chaves-na-mao.get",
    ).data;
  },

  async save(
    input: ChavesNaMaoIntegrationInput,
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      chavesNaMaoIntegrationInputSchema,
      input,
      "integrations.chaves-na-mao.save",
    );
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao",
      { method: "PUT", organizationId, body },
    );
    return validateDomainResponse(
      apiChavesNaMaoIntegrationResponseSchema,
      response,
      "integrations.chaves-na-mao.save",
    ).data;
  },

  async activate(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao/activate",
      { method: "POST", organizationId },
    );
    return validateDomainResponse(
      apiChavesNaMaoIntegrationResponseSchema,
      response,
      "integrations.chaves-na-mao.activate",
    ).data;
  },

  async pause(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao/pause",
      { method: "POST", organizationId },
    );
    return validateDomainResponse(
      apiChavesNaMaoIntegrationResponseSchema,
      response,
      "integrations.chaves-na-mao.pause",
    ).data;
  },

  async regenerateFeedToken(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao/regenerate-feed-token",
      { method: "POST", organizationId },
    );
    return validateDomainResponse(
      apiChavesNaMaoIntegrationResponseSchema,
      response,
      "integrations.chaves-na-mao.regenerate-feed-token",
    ).data;
  },

  async listPublications(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao/publications",
      { organizationId },
    );
    return validateDomainResponse(
      apiChavesNaMaoPublicationListResponseSchema,
      response,
      "integrations.chaves-na-mao.publications.list",
    ).data;
  },

  async savePublications(
    input: { publications: ChavesNaMaoPublicationInput[] },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      chavesNaMaoPublicationsInputSchema,
      input,
      "integrations.chaves-na-mao.publications.save",
    );
    const response = await vimobAPIRequest<unknown>(
      "/v1/integrations/portals/chaves-na-mao/publications",
      { method: "PUT", organizationId, body },
    );
    return validateDomainResponse(
      apiChavesNaMaoPublicationListResponseSchema,
      response,
      "integrations.chaves-na-mao.publications.save",
    ).data;
  },
};
