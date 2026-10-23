"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePropertyMutation } from "@/hooks/properties/use-property-mutation";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canManageProperties } from "@/lib/access/properties";
import { createTenantQueryAccessSignature } from "@/lib/access/tenant-query-cache";
import { propertyDevelopmentsAPI } from "@/lib/api/property-developments";
import { VimobAPIError, stringifyErrorMessage } from "@/lib/api/vimob-error";
import {
  isDevelopmentMaintenanceScopeCurrent,
  nextDevelopmentMaintenanceInvalidation,
} from "@/hooks/properties/property-development-maintenance-scope";
import type {
  PropertyDevelopmentMaintenanceInput,
  PropertyDevelopmentMaintenanceKind,
} from "@/lib/validation";

export function usePropertyDevelopmentMaintenance(
  developmentId: string,
  organizationId: string,
) {
  const {
    activeOrganization,
    user,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth();
  const scope = useMemo(
    () => ({
      userId: user?.id ?? null,
      tenantUserId: tenantContext?.userId ?? null,
      organizationId: activeOrganization.organizationId,
      tenantOrganizationId: tenantContext?.organizationId ?? null,
      ready: activeOrganization.status === "ready",
      canManage:
        canManageProperties({
          userId: user?.id,
          organizationId: activeOrganization.organizationId,
          memberRole: tenantContext?.memberRole,
          permissions: tenantContext?.permissions,
          isSuperAdmin: tenantContext?.isSuperAdmin ?? isSuperAdmin,
        }) &&
        Boolean(
          tenantContext?.enabledModules.some(
            (module) => module.trim().toLowerCase() === "properties",
          ),
        ),
      accessSignature: createTenantQueryAccessSignature({
        userId: user?.id,
        organizationId: activeOrganization.organizationId,
        memberRole: tenantContext?.memberRole,
        permissions: tenantContext?.permissions,
        enabledModules: tenantContext?.enabledModules,
        isSuperAdmin: tenantContext?.isSuperAdmin ?? isSuperAdmin,
        impersonatedOrganizationId: impersonating?.orgId,
      }),
    }),
    [
      user?.id,
      tenantContext?.userId,
      tenantContext?.organizationId,
      activeOrganization.organizationId,
      activeOrganization.status,
      tenantContext?.memberRole,
      tenantContext?.permissions,
      tenantContext?.enabledModules,
      tenantContext?.isSuperAdmin,
      isSuperAdmin,
      impersonating?.orgId,
    ],
  );
  const [initialScope] = useState(() => scope);
  const [invalidated, setInvalidated] = useState(false);
  const nextInvalidated = nextDevelopmentMaintenanceInvalidation(
    invalidated,
    initialScope,
    scope,
    organizationId,
  );
  // Store the first scope loss in state. A later A → B → A transition cannot
  // revive this draft; refs are reserved for committed/event-time access.
  if (nextInvalidated !== invalidated) setInvalidated(nextInvalidated);
  const scopeValid = !nextInvalidated;
  const fence = useRef({
    current: scope,
    invalidated: !scopeValid,
    mounted: false,
  });
  useLayoutEffect(() => {
    fence.current.current = scope;
    fence.current.invalidated ||= !scopeValid;
  }, [scope, scopeValid]);
  useLayoutEffect(() => {
    const mountedFence = fence.current;
    mountedFence.mounted = true;
    return () => {
      mountedFence.mounted = false;
    };
  }, []);
  const isCurrentScope = () =>
    fence.current.mounted &&
    !fence.current.invalidated &&
    isDevelopmentMaintenanceScopeCurrent(
      initialScope,
      fence.current.current,
      organizationId,
    );
  const assertScope = () => {
    if (!isCurrentScope())
      throw new Error("Seu acesso mudou. Feche e abra o cadastro novamente.");
  };
  const queryClient = useQueryClient();
  const invalidateSource = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["property-developments", organizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["properties-infinite", organizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["properties", organizationId],
      }),
    ]);
  const mutation = usePropertyMutation({
    resourceId: developmentId,
    mutationFn: async ({
      kind,
      entityId,
      input,
    }: {
      kind: PropertyDevelopmentMaintenanceKind;
      entityId: string;
      input: PropertyDevelopmentMaintenanceInput;
    }, commandScope) => {
      assertScope();
      return propertyDevelopmentsAPI.updateMaintenance(
        organizationId,
        developmentId,
        kind,
        entityId,
        input,
        {
          ...commandScope.requestIntent,
          expectedUserId: initialScope.userId,
          onRequestStart: () => { commandScope.requestIntent.onRequestStart?.(); assertScope(); },
        },
      );
    },
    onSuccess: async (_data, _input, commandScope) => {
      await invalidateSource();
      if (commandScope.isCurrent() && isCurrentScope()) toast.success("Cadastro atualizado.");
    },
    onError: async (error, _input, commandScope) => {
      if (error instanceof VimobAPIError && error.status === 409)
        await invalidateSource();
      if (commandScope.isCurrent() && isCurrentScope()) toast.error(stringifyErrorMessage(error));
    },
  });
  return {
    ...mutation,
    scopeValid,
    isCurrentScope,
    reloadWorkspace: async () => {
      assertScope();
      const response = await propertyDevelopmentsAPI.getWorkspace(
        organizationId,
        developmentId,
        {
          expectedUserId: initialScope.userId,
          onRequestStart: assertScope,
        },
      );
      assertScope();
      if (
        !response.meta.can_manage ||
        response.data.development.organization_id !== organizationId ||
        response.data.development.id !== developmentId
      ) {
        throw new Error("Seu acesso mudou. Feche e abra o cadastro novamente.");
      }
      return response.data;
    },
  };
}
