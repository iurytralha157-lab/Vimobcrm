"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BellRing,
  Building2,
  CreditCard,
  Globe,
  Plug,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { AccountTab } from "@/components/features/settings/AccountTab";
import { TeamTab } from "@/components/features/settings/TeamTab";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { SubscriptionTab } from "@/components/features/settings/SubscriptionTab";
import { IntegrationsTab } from "@/components/features/settings/IntegrationsTab";
import { PropertySettingsTab } from "@/components/features/settings/PropertySettingsTab";
import { NotificationsTab } from "@/components/features/settings/NotificationsTab";
import { isBillingAccessBlocked } from "@/lib/billing-access";
import { canManageOrganization as canManageOrganizationAccess } from "@/lib/access/organization";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import {
  isSettingsLegacyIntegrationTab,
  isSettingsPageTab,
  normalizeSettingsTabAlias,
  type SettingsPageTab,
} from "@/lib/settings-tabs";

export default function Settings() {
  const {
    profile,
    isSuperAdmin,
    organization,
    userOrganizations,
    loading,
    organizationsLoaded,
  } = useAuth();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const replaceSearchParams = useCallback(
    (next: URLSearchParams) => {
      const nextSearch = next.toString();
      router.replace(`/settings${nextSearch ? `?${nextSearch}` : ""}`, {
        scroll: false,
      });
    },
    [router],
  );
  const requestedTab = searchParams.get("tab") || "account";
  const normalizedRequestedTab = normalizeSettingsTabAlias(requestedTab);
  const isBillingBlocked =
    !isSuperAdmin && isBillingAccessBlocked(organization);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find(
    (org) => org.organization_id === activeOrganizationId,
  )?.member_role;
  const canManageOrganization = canManageOrganizationAccess({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  const canAccessUsers =
    canManageOrganization ||
    hasPermission("users_manage") ||
    hasPermission("permissions_manage");
  const canManageIntegrations =
    canManageOrganization || hasPermission("settings_integrations");
  const canManageWhatsApp =
    canManageOrganization || hasPermission("whatsapp_manage");
  const canManageAI = canManageOrganization || hasPermission("settings_ai");
  const canManageBilling =
    canManageOrganization || hasPermission("settings_billing");
  const canManageProperties =
    hasModule("properties") &&
    (canManageOrganization || hasPermission("property_manage"));
  const canAccessIntegrations = Boolean(profile?.id && activeOrganizationId);
  const accessReady =
    !!profile &&
    !modulesLoading &&
    (canManageOrganization || (!loading && organizationsLoaded));
  const legacyIntegrationTabs = useMemo(
    () => [
      ...(canManageIntegrations
        ? ["webhooks", "meta", "grupo-olx", "api"]
        : []),
      ...(canManageWhatsApp ? ["whatsapp"] : []),
      ...(canManageAI ? ["ai"] : []),
    ],
    [canManageAI, canManageIntegrations, canManageWhatsApp],
  );
  const isUnauthorizedAIRequest =
    accessReady && normalizedRequestedTab === "ai" && !canManageAI;
  const isUnauthorizedIntegrationsRequest =
    accessReady &&
    normalizedRequestedTab === "integrations" &&
    !canAccessIntegrations;
  const requestedIntegration = searchParams.get("integration") || undefined;
  const initialIntegration =
    !isUnauthorizedAIRequest && !isUnauthorizedIntegrationsRequest
      ? normalizedRequestedTab === "integrations"
        ? requestedIntegration
        : isSettingsLegacyIntegrationTab(normalizedRequestedTab) &&
            legacyIntegrationTabs.includes(normalizedRequestedTab)
          ? normalizedRequestedTab
          : undefined
      : undefined;
  const initialTab: SettingsPageTab =
    isUnauthorizedAIRequest || isUnauthorizedIntegrationsRequest
      ? "account"
      : initialIntegration
        ? "integrations"
        : isSettingsPageTab(normalizedRequestedTab)
          ? normalizedRequestedTab
          : "account";
  const [activeTab, setActiveTab] = useState(initialTab);

  // Sync tab when URL query param changes (e.g. external navigation)
  useEffect(() => {
    if (!accessReady) return;

    if (isBillingBlocked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza a aba ativa com bloqueio de faturamento e URL.
      if (activeTab !== "subscription") setActiveTab("subscription");
      if (searchParams.get("tab") !== "subscription") {
        const next = new URLSearchParams(searchParams);
        next.set("tab", "subscription");
        replaceSearchParams(next);
      }
      return;
    }

    const rawTab = searchParams.get("tab");
    const requested = normalizeSettingsTabAlias(rawTab);
    const isKnownPageRequest = isSettingsPageTab(requested);
    const isKnownLegacyRequest = isSettingsLegacyIntegrationTab(requested);
    const isAllowedLegacyRequest =
      isKnownLegacyRequest && legacyIntegrationTabs.includes(requested);

    if (
      requested &&
      ((!isKnownPageRequest && !isKnownLegacyRequest) ||
        (isKnownLegacyRequest && !isAllowedLegacyRequest))
    ) {
      if (activeTab !== "account") setActiveTab("account");
      const next = new URLSearchParams(searchParams);
      next.set("tab", "account");
      next.delete("integration");
      replaceSearchParams(next);
      return;
    }
    const normalizedTab: SettingsPageTab | null = isAllowedLegacyRequest
      ? "integrations"
      : isKnownPageRequest
        ? requested
        : null;
    if (normalizedTab === "integrations" && !canAccessIntegrations) {
      if (activeTab !== "account") setActiveTab("account");
      const next = new URLSearchParams(searchParams);
      next.set("tab", "account");
      replaceSearchParams(next);
      return;
    }
    if (normalizedTab === "team" && !canAccessUsers) {
      if (activeTab !== "account") setActiveTab("account");
      const next = new URLSearchParams(searchParams);
      next.set("tab", "account");
      replaceSearchParams(next);
      return;
    }
    if (
      (normalizedTab === "subscription" && !canManageBilling) ||
      (normalizedTab === "properties" && !canManageProperties)
    ) {
      if (activeTab !== "account") setActiveTab("account");
      const next = new URLSearchParams(searchParams);
      next.set("tab", "account");
      replaceSearchParams(next);
      return;
    }
    if (normalizedTab && normalizedTab !== activeTab) {
      setActiveTab(normalizedTab);
    }
  }, [
    searchParams,
    isBillingBlocked,
    activeTab,
    replaceSearchParams,
    canAccessIntegrations,
    canAccessUsers,
    canManageAI,
    canManageBilling,
    canManageProperties,
    accessReady,
    legacyIntegrationTabs,
  ]);

  const handleTabChange = (value: string) => {
    if (!isSettingsPageTab(value)) return;
    if (isBillingBlocked && value !== "subscription") return;
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    if (value !== "integrations") next.delete("integration");
    replaceSearchParams(next);
  };

  const handleIntegrationClose = useCallback(() => {
    setActiveTab("integrations");
    const next = new URLSearchParams(searchParams);
    next.set("tab", "integrations");
    next.delete("integration");
    replaceSearchParams(next);
  }, [replaceSearchParams, searchParams]);

  const hasWhatsAppModule = hasModule("whatsapp");
  const hasAIModule = canManageAI && hasModule("ai_agent");
  const hasWebhooksModule = hasModule("webhooks");
  const hasAPIModule = hasModule("api");
  const hasPortalsModule = hasModule("portals");
  const canManageSite =
    hasModule("site") &&
    (canManageOrganization || hasPermission("settings_site"));
  const settingsTabs = [
    {
      value: "account",
      label: t.nav.settingsAccount,
      icon: SettingsIcon,
      visible: !isBillingBlocked,
    },
    {
      value: "notifications",
      label: t.nav.settingsNotifications,
      icon: BellRing,
      visible: !isBillingBlocked,
    },
    {
      value: "team",
      label: t.nav.settingsUsers,
      icon: Users,
      visible: !isBillingBlocked && accessReady && canAccessUsers,
    },
    {
      value: "subscription",
      label: t.nav.settingsBilling,
      icon: CreditCard,
      visible: accessReady && (canManageBilling || isBillingBlocked),
    },
    {
      value: "integrations",
      label: t.nav.settingsIntegrations,
      icon: Plug,
      visible: !isBillingBlocked && accessReady && canAccessIntegrations,
    },
    {
      value: "properties",
      label: t.nav.settingsProperties,
      icon: Building2,
      visible: !isBillingBlocked && accessReady && canManageProperties,
    },
  ].filter((tab) => tab.visible);

  return (
    <AppLayout title={t.settings.title}>
      <div className="animate-in">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="min-w-0 space-y-3"
        >
          <div className="flex min-w-0 flex-row items-center gap-2">
            <div
              className="app-responsive-tab-list min-w-0 flex-1"
              data-collapse="wide"
            >
              <nav
                aria-label="Áreas de Configurações"
                data-responsive-tab-scroll
                className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <div className="flex min-w-max gap-0">
                  {settingsTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = tab.value === activeTab;

                    return (
                      <button
                        key={tab.value}
                        type="button"
                        onClick={() => handleTabChange(tab.value)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={tab.label}
                        data-responsive-tab
                        title={tab.label}
                        className={cn(
                          "mx-0 inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 sm:text-[12px]",
                          isActive &&
                            "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-solid)] hover:text-[var(--app-text-primary)]",
                        )}
                      >
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        <span className="app-responsive-tab-label">
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}

                  {!isBillingBlocked && accessReady && canManageSite ? (
                    <Link
                      href="/settings/site"
                      aria-label={t.nav.site}
                      data-responsive-tab
                      title={t.nav.site}
                      className="mx-0 inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 sm:text-[12px]"
                    >
                      <Globe className="h-3 w-3" aria-hidden="true" />
                      <span className="app-responsive-tab-label">
                        {t.nav.site}
                      </span>
                    </Link>
                  ) : null}
                </div>
              </nav>
            </div>
          </div>

          <TabsContent value="account">
            <AccountTab />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationsTab />
          </TabsContent>

          {!accessReady &&
            ["team", "subscription", "properties"].includes(activeTab) && (
              <TabsContent value={activeTab}>
                <div className="app-card p-6 text-sm text-muted-foreground">
                  Carregando permissões da organização...
                </div>
              </TabsContent>
            )}

          {accessReady && canAccessUsers && (
            <TabsContent value="team">
              <TeamTab />
            </TabsContent>
          )}

          {accessReady && canAccessIntegrations && (
            <TabsContent value="integrations">
              <IntegrationsTab
                defaultIntegration={initialIntegration}
                onCloseIntegration={handleIntegrationClose}
                hasWhatsAppModule={hasWhatsAppModule}
                hasAIModule={hasAIModule}
                hasWebhooksModule={hasWebhooksModule}
                hasAPIModule={hasAPIModule}
                hasPortalsModule={hasPortalsModule}
                canManageIntegrations={canManageIntegrations}
                canManageWhatsApp={canManageWhatsApp}
                canManageAI={canManageAI}
              />
            </TabsContent>
          )}

          {accessReady && canManageProperties && (
            <TabsContent value="properties">
              <PropertySettingsTab />
            </TabsContent>
          )}

          {accessReady && (canManageBilling || isBillingBlocked) && (
            <TabsContent value="subscription">
              <SubscriptionTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
