import {
  apiDeleteHomePublicationImageResponseSchema,
  apiDeleteHomePublicationResponseSchema,
  apiHomeAssistantResponseSchema,
  apiHomeFocusResponseSchema,
  apiHomeNoticeListResponseSchema,
  apiHomePublicationCardListResponseSchema,
  apiHomePublicationListResponseSchema,
  apiHomePublicationResponseSchema,
  createHomePublicationInputSchema,
  homeAssistantInputSchema,
  homePublicationImageFileSchema,
  parseDomainInput,
  reorderHomePublicationsInputSchema,
  updateHomePublicationInputSchema,
  uuidSchema,
  validateDomainResponse,
  type CreateHomePublicationInput,
  type HomeAssistantAnswer,
  type HomeFocusFeedItem,
  type HomeNotice,
  type HomePublication,
  type HomePublicationAccent,
  type HomePublicationCard,
  type HomePublicationCardSize,
  type HomePublicationCtaHref,
  type HomePublicationOrderItem,
  type HomePublicationTargetRole,
  type HomePublicationTargetType,
  type ReorderHomePublicationsInput,
  type UpdateHomePublicationInput,
} from "@/lib/validation";

import { vimobAPIRequest } from "./vimob-client";

type Envelope<T> = {
  data: T;
};

export type HomeFocusScope = "mine" | "team" | "organization";

export type DeleteHomePublicationResult = {
  ok: true;
  cleanupWarning?: string;
};

export type DeleteHomePublicationImageResult = {
  publication: HomePublication;
  cleanupWarning?: string;
};

export const homeAPI = {
  async listNotices(
    organizationId?: string | null,
    signal?: AbortSignal,
  ): Promise<HomeNotice[]> {
    const response = await vimobAPIRequest<Envelope<HomeNotice[]>>(
      "/v1/home/notices",
      {
        organizationId,
        signal,
      },
    );
    validateDomainResponse(
      apiHomeNoticeListResponseSchema,
      response,
      "home.notices.list",
    );
    return response.data;
  },

  async listFocus(
    organizationId?: string | null,
    signal?: AbortSignal,
    limit = 8,
    scope: HomeFocusScope = "mine",
  ): Promise<HomeFocusFeedItem[]> {
    const response = await vimobAPIRequest<Envelope<HomeFocusFeedItem[]>>(
      "/v1/home/focus",
      {
        organizationId,
        signal,
        query: {
          scope,
          limit: Math.min(20, Math.max(1, Math.trunc(limit))),
        },
      },
    );
    validateDomainResponse(
      apiHomeFocusResponseSchema,
      response,
      "home.focus.list",
    );
    return response.data;
  },

  async listPublications(
    organizationId?: string | null,
    signal?: AbortSignal,
  ): Promise<HomePublicationCard[]> {
    const response = await vimobAPIRequest<Envelope<HomePublicationCard[]>>(
      "/v1/home/publications",
      {
        organizationId,
        signal,
      },
    );
    validateDomainResponse(
      apiHomePublicationCardListResponseSchema,
      response,
      "home.publications.list",
    );
    return response.data;
  },

  async askAssistant(
    question: string,
    organizationId?: string | null,
  ): Promise<HomeAssistantAnswer | null> {
    const body = parseDomainInput(
      homeAssistantInputSchema,
      { question },
      "home.assistant.ask",
    );
    const response = await vimobAPIRequest<
      Envelope<HomeAssistantAnswer | null>
    >("/v1/home/assistant", {
      method: "POST",
      organizationId,
      body,
    });
    validateDomainResponse(
      apiHomeAssistantResponseSchema,
      response,
      "home.assistant.ask",
    );
    return response.data;
  },

  async listAdminPublications(
    signal?: AbortSignal,
  ): Promise<HomePublication[]> {
    const response = await vimobAPIRequest<Envelope<HomePublication[]>>(
      "/v1/admin/home-publications",
      { signal },
    );
    validateDomainResponse(
      apiHomePublicationListResponseSchema,
      response,
      "home.admin.publications.list",
    );
    return response.data;
  },

  async createPublication(
    input: CreateHomePublicationInput,
  ): Promise<HomePublication> {
    const body = parseDomainInput(
      createHomePublicationInputSchema,
      input,
      "home.admin.publications.create",
    );
    const response = await vimobAPIRequest<Envelope<HomePublication>>(
      "/v1/admin/home-publications",
      {
        method: "POST",
        body,
      },
    );
    validateDomainResponse(
      apiHomePublicationResponseSchema,
      response,
      "home.admin.publications.create",
    );
    return response.data;
  },

  async updatePublication(
    id: string,
    input: UpdateHomePublicationInput,
  ): Promise<HomePublication> {
    const publicationId = parseDomainInput(
      uuidSchema,
      id,
      "home.admin.publications.update.id",
    );
    const body = parseDomainInput(
      updateHomePublicationInputSchema,
      input,
      "home.admin.publications.update",
    );
    const response = await vimobAPIRequest<Envelope<HomePublication>>(
      `/v1/admin/home-publications/${publicationId}`,
      {
        method: "PATCH",
        body,
      },
    );
    validateDomainResponse(
      apiHomePublicationResponseSchema,
      response,
      "home.admin.publications.update",
    );
    return response.data;
  },

  async deletePublication(id: string): Promise<DeleteHomePublicationResult> {
    const publicationId = parseDomainInput(
      uuidSchema,
      id,
      "home.admin.publications.delete.id",
    );
    const response = await vimobAPIRequest<DeleteHomePublicationResult>(
      `/v1/admin/home-publications/${publicationId}`,
      { method: "DELETE" },
    );
    validateDomainResponse(
      apiDeleteHomePublicationResponseSchema,
      response,
      "home.admin.publications.delete",
    );
    return response;
  },

  async reorderPublications(
    input: ReorderHomePublicationsInput,
  ): Promise<HomePublication[]> {
    const body = parseDomainInput(
      reorderHomePublicationsInputSchema,
      input,
      "home.admin.publications.reorder",
    );
    const response = await vimobAPIRequest<Envelope<HomePublication[]>>(
      "/v1/admin/home-publications/order",
      {
        method: "PUT",
        body,
      },
    );
    validateDomainResponse(
      apiHomePublicationListResponseSchema,
      response,
      "home.admin.publications.reorder",
    );
    return response.data;
  },

  async uploadPublicationImage(
    id: string,
    file: File,
  ): Promise<HomePublication> {
    const publicationId = parseDomainInput(
      uuidSchema,
      id,
      "home.admin.publications.image.upload.id",
    );
    const parsedFile = parseDomainInput(
      homePublicationImageFileSchema,
      file,
      "home.admin.publications.image.upload.file",
    );
    const body = new FormData();
    body.append("file", parsedFile);

    const response = await vimobAPIRequest<Envelope<HomePublication>>(
      `/v1/admin/home-publications/${publicationId}/image`,
      {
        method: "POST",
        body,
      },
    );
    validateDomainResponse(
      apiHomePublicationResponseSchema,
      response,
      "home.admin.publications.image.upload",
    );
    return response.data;
  },

  async deletePublicationImage(
    id: string,
  ): Promise<DeleteHomePublicationImageResult> {
    const publicationId = parseDomainInput(
      uuidSchema,
      id,
      "home.admin.publications.image.delete.id",
    );
    const response = await vimobAPIRequest<
      Envelope<HomePublication> & {
        cleanupWarning?: string;
      }
    >(`/v1/admin/home-publications/${publicationId}/image`, {
      method: "DELETE",
    });
    validateDomainResponse(
      apiDeleteHomePublicationImageResponseSchema,
      response,
      "home.admin.publications.image.delete",
    );
    return {
      publication: response.data,
      cleanupWarning: response.cleanupWarning,
    };
  },
};

export type {
  CreateHomePublicationInput,
  HomeAssistantAnswer,
  HomeFocusFeedItem,
  HomeNotice,
  HomePublication,
  HomePublicationAccent,
  HomePublicationCard,
  HomePublicationCardSize,
  HomePublicationCtaHref,
  HomePublicationOrderItem,
  HomePublicationTargetRole,
  HomePublicationTargetType,
  ReorderHomePublicationsInput,
  UpdateHomePublicationInput,
};
