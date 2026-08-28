"use client";

import { useMemo, useState } from "react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import {
  useHomeNotices,
  useHomeOverview,
  useHomePublications,
} from "@/hooks/home";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import type { HomeFocusScope, HomePublicationCard } from "@/lib/api/home";
import { isBillingAccessBlocked } from "@/lib/billing-access";

import { HomeAssistant } from "./HomeAssistant";
import { HomeFocusList } from "./HomeFocusList";
import { HomeNoticeRail } from "./HomeNoticeRail";
import { HomePublicationGrid } from "./HomePublicationGrid";
import {
  FALLBACK_HOME_PUBLICATIONS,
  HOME_BILLING_ACTION,
  HOME_PAGE_SECTIONS,
  HOME_QUICK_ACTIONS,
  type HomeQuickAction,
} from "./home-catalog";

function getFirstName(name?: string | null) {
  const normalizedName = name?.trim();
  if (!normalizedName) return "bem-vindo";
  return normalizedName.split(/\s+/)[0];
}

function hasAnyPermission(
  action: HomeQuickAction,
  hasPermission: (permission: string) => boolean,
) {
  if (action.permission && !hasPermission(action.permission)) return false;
  if (action.anyPermissions && !action.anyPermissions.some(hasPermission))
    return false;
  return true;
}

export default function HomeScreen() {
  const { profile, organization, isSuperAdmin } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const access = useUserAccessScope();
  const [requestedFocusScope, setRequestedFocusScope] =
    useState<HomeFocusScope>("mine");
  const canViewTeamFocus = access.isAdmin || access.isTeamLeader;
  const canViewOrganizationFocus = access.canViewAllLeads;
  const focusScope: HomeFocusScope =
    requestedFocusScope === "organization" && !canViewOrganizationFocus
      ? "mine"
      : requestedFocusScope === "team" && !canViewTeamFocus
        ? "mine"
        : requestedFocusScope;
  const publicationsQuery = useHomePublications(
    HOME_PAGE_SECTIONS.publications,
  );
  const noticesQuery = useHomeNotices();
  const overview = useHomeOverview(focusScope, HOME_PAGE_SECTIONS.focus);
  const accessReady = !permissionsLoading && !modulesLoading;
  const billingBlocked = !isSuperAdmin && isBillingAccessBlocked(organization);

  const quickActions = useMemo(() => {
    if (billingBlocked) {
      const supportAction = HOME_QUICK_ACTIONS.find(
        (action) => action.href === "/suporte",
      );
      return supportAction
        ? [HOME_BILLING_ACTION, supportAction]
        : [HOME_BILLING_ACTION];
    }

    return HOME_QUICK_ACTIONS.filter((action) => {
      if (!accessReady) return action.href === "/suporte";
      if (action.module && !hasModule(action.module)) return false;
      return hasAnyPermission(action, hasPermission);
    });
  }, [accessReady, billingBlocked, hasModule, hasPermission]);

  const canAccessHref = (href?: string | null) => {
    if (!href || !accessReady) return false;
    if (billingBlocked) return href === "/settings" || href === "/suporte";
    const catalogAction = HOME_QUICK_ACTIONS.find(
      (action) => action.href === href,
    );
    if (catalogAction) {
      if (catalogAction.module && !hasModule(catalogAction.module))
        return false;
      return hasAnyPermission(catalogAction, hasPermission);
    }

    if (href.startsWith("/automations")) {
      return (
        hasModule("automations") &&
        (hasPermission("automations_view") ||
          hasPermission("automations_manage"))
      );
    }
    if (href === "/gamificacao") {
      return (
        hasModule("gamification") &&
        (hasPermission("gamification_view") ||
          hasPermission("gamification_manage"))
      );
    }

    return (
      href === "/notifications" || href === "/settings" || href === "/suporte"
    );
  };

  const configuredPublications = publicationsQuery.data || [];
  const sourcePublications = publicationsQuery.isError
    ? FALLBACK_HOME_PUBLICATIONS
    : configuredPublications;
  const publications: HomePublicationCard[] = sourcePublications
    .slice()
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .filter((publication) => canAccessHref(publication.ctaHref));

  return (
    <AppLayout
      title="Página inicial"
      borderless
      belowHeader={<HomeNoticeRail notices={noticesQuery.data || []} />}
    >
      <div className="mx-auto w-full max-w-[980px] pb-8 sm:pt-2">
        <HomeAssistant
          firstName={getFirstName(profile?.name)}
          quickActions={quickActions}
        />

        <div className="space-y-5 sm:space-y-7">
          {HOME_PAGE_SECTIONS.publications &&
            (!accessReady ||
              publicationsQuery.isLoading ||
              publications.length > 0) && (
              <HomePublicationGrid
                publications={publications}
                isLoading={!accessReady || publicationsQuery.isLoading}
              />
            )}

          {HOME_PAGE_SECTIONS.focus ? (
            <HomeFocusList
              items={overview.focusItems}
              isLoading={overview.isLoading}
              hasError={overview.hasError}
              isRetrying={overview.isRetrying}
              onRetry={overview.retry}
              hasAnyAccess={overview.hasAnyAccess}
              billingBlocked={overview.billingBlocked}
              scope={focusScope}
              onScopeChange={setRequestedFocusScope}
              canViewTeam={canViewTeamFocus}
              canViewOrganization={canViewOrganizationFocus}
            />
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
