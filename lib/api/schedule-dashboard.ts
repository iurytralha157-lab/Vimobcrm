import { vimobAPIRequest } from "./vimob-client";
import {
  apiScheduleDashboardEventsResponseSchema,
  apiScheduleDashboardResponseSchema,
  scheduleDashboardEventsQuerySchema,
  scheduleDashboardQuerySchema,
  type ScheduleDashboardData,
  type ScheduleDashboardEventsPage,
  type ScheduleDashboardEventsQueryInput,
  type ScheduleDashboardQueryInput,
} from "@/lib/validation/schedule-dashboard";
import {
  parseDomainInput,
  validateDomainResponse,
} from "@/lib/validation/common";

export type ScheduleDashboardRequestOptions = {
  organizationId?: string | null;
  signal?: AbortSignal;
};

export function getScheduleDashboardQueryKey(
  query: ScheduleDashboardQueryInput,
) {
  return [
    query.dateFrom,
    query.dateTo,
    query.dateBasis ?? "start_time",
    query.teamId ?? null,
    query.userId ?? null,
    query.source ?? null,
    query.eventType ?? null,
    query.status ?? null,
  ] as const;
}

export function getScheduleDashboardEventsQueryKey(
  query: ScheduleDashboardQueryInput,
  limit = 20,
) {
  return [...getScheduleDashboardQueryKey(query), limit] as const;
}

export const scheduleDashboardAPI = {
  async getDashboard(
    query: ScheduleDashboardQueryInput,
    options: ScheduleDashboardRequestOptions = {},
  ): Promise<ScheduleDashboardData> {
    const validatedQuery = parseDomainInput(
      scheduleDashboardQuerySchema,
      query,
      "schedule.dashboard.query",
    );
    const response = await vimobAPIRequest<unknown>("/v1/schedule/dashboard", {
      query: validatedQuery,
      organizationId: options.organizationId,
      signal: options.signal,
    });

    return validateDomainResponse(
      apiScheduleDashboardResponseSchema,
      response,
      "schedule.dashboard.response",
    ).data;
  },

  async getEvents(
    query: ScheduleDashboardEventsQueryInput,
    options: ScheduleDashboardRequestOptions = {},
  ): Promise<ScheduleDashboardEventsPage> {
    const validatedQuery = parseDomainInput(
      scheduleDashboardEventsQuerySchema,
      query,
      "schedule.dashboard.events.query",
    );
    const response = await vimobAPIRequest<unknown>(
      "/v1/schedule/dashboard/events",
      {
        query: validatedQuery,
        organizationId: options.organizationId,
        signal: options.signal,
      },
    );

    return validateDomainResponse(
      apiScheduleDashboardEventsResponseSchema,
      response,
      "schedule.dashboard.events.response",
    ).data;
  },
};
