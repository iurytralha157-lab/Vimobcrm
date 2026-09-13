import { useQuery } from "@tanstack/react-query";

import {
  adminAPI,
  type AdminNotificationDispatchSettings,
} from "@/lib/api/admin";
import { getErrorMessage, type AdminRecord } from "@/components/features/admin/admin-display";

export type OrganizationModuleRow = AdminRecord & {
  module_name?: string;
  is_enabled?: boolean;
};

export type OrganizationPaymentRow = AdminRecord & {
  id?: string;
  status?: string;
  value?: number | string;
  billing_type?: string;
  due_date?: string;
  payment_date?: string;
};

export type NotificationDispatchForm = {
  enabled: boolean;
  mode: "webhook" | "evolution_go_instance";
  instanceName: string;
  instanceToken: string;
  instanceTokenConfigured: boolean;
  clearInstanceToken: boolean;
  senderNumber: string;
  webhookUrl: string;
  headerName: string;
  headerValue: string;
  headerValueConfigured: boolean;
  clearHeaderValue: boolean;
  timeoutSeconds: number;
};

export type SafeQueryResult<T> = {
  data: T;
  errorMessage: string | null;
};

export function useSafeAdminQuery<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  fallback: T,
  enabled = true,
) {
  return useQuery<SafeQueryResult<T>>({
    queryKey,
    enabled,
    queryFn: async () => {
      try {
        return { data: await queryFn(), errorMessage: null };
      } catch (error) {
        return { data: fallback, errorMessage: getErrorMessage(error) };
      }
    },
    staleTime: 60_000,
  });
}

export async function countAdminTable(table: string) {
  const result = await adminAPI.countTableRows(table);
  return result.count || 0;
}

export function useAdminRows(table: string, limit = 60) {
  return useSafeAdminQuery(
    ["admin-rows", table, limit],
    () => adminAPI.listTableRows(table, limit) as Promise<AdminRecord[]>,
    [],
  );
}

export function useAdminUsersList() {
  return useSafeAdminQuery<AdminRecord[]>(
    ["admin-users-list"],
    () => adminAPI.listUsers() as Promise<AdminRecord[]>,
    [],
  );
}

export function getNotificationDispatchForm(
  settings?: AdminNotificationDispatchSettings,
): NotificationDispatchForm {
  return {
    enabled: settings?.enabled ?? false,
    mode: settings?.mode ?? "webhook",
    instanceName: settings?.instanceName ?? "",
    instanceToken: "",
    instanceTokenConfigured: settings?.instanceTokenConfigured ?? false,
    clearInstanceToken: false,
    senderNumber: settings?.senderNumber ?? "",
    webhookUrl: settings?.webhookUrl ?? "",
    headerName: settings?.headerName ?? "",
    headerValue: "",
    headerValueConfigured: settings?.headerValueConfigured ?? false,
    clearHeaderValue: false,
    timeoutSeconds: settings?.timeoutSeconds ?? 10,
  };
}

export function useAdminOrganizationModules(organizationId?: string) {
  return useSafeAdminQuery<OrganizationModuleRow[]>(
    ["admin-organization-modules", organizationId],
    async () => {
      if (!organizationId) return [];
      return adminAPI.listOrganizationModules(organizationId) as Promise<OrganizationModuleRow[]>;
    },
    [],
    Boolean(organizationId),
  );
}

export function useAdminOrganizationPayments(organizationId?: string) {
  return useSafeAdminQuery<OrganizationPaymentRow[]>(
    ["admin-organization-payments", organizationId],
    async () => {
      if (!organizationId) return [];
      return adminAPI.listOrganizationPayments(organizationId) as Promise<OrganizationPaymentRow[]>;
    },
    [],
    Boolean(organizationId),
  );
}
