"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AccountTab } from '@/components/features/settings/AccountTab';
import { TeamTab } from '@/components/features/settings/TeamTab';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { SubscriptionTab } from '@/components/features/settings/SubscriptionTab';
import { IntegrationsTab } from '@/components/features/settings/IntegrationsTab';
import { PropertySettingsTab } from '@/components/features/settings/PropertySettingsTab';
import { isBillingBlockedStatus } from '@/lib/billing-access';
import { canManageOrganization as canManageOrganizationAccess } from '@/lib/access/organization';
import { useUserPermissions } from '@/hooks/use-user-permissions';

export default function Settings() {
  const { profile, isSuperAdmin, organization, userOrganizations, loading, organizationsLoaded } = useAuth();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const replaceSearchParams = useCallback(
    (next: URLSearchParams) => {
      const nextSearch = next.toString();
      router.replace(`/settings${nextSearch ? `?${nextSearch}` : ''}`, { scroll: false });
    },
    [router]
  );
  const requestedTab = searchParams.get('tab') || 'account';
  const normalizedRequestedTab = requestedTab === 'webhook' ? 'webhooks' : requestedTab;
  const isBillingBlocked = !isSuperAdmin && isBillingBlockedStatus(organization?.subscription_status);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const canManageOrganization = canManageOrganizationAccess({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  const canAccessUsers = canManageOrganization || hasPermission('users_manage') || hasPermission('permissions_manage');
  const canManageIntegrations = canManageOrganization || hasPermission('settings_integrations');
  const canManageWhatsApp = canManageOrganization || hasPermission('whatsapp_manage');
  const canManageAI = canManageOrganization || hasPermission('settings_ai');
  const canManageBilling = canManageOrganization || hasPermission('settings_billing');
  const canManageProperties = canManageOrganization || hasPermission('property_manage');
  const canAccessIntegrations = canManageIntegrations || canManageWhatsApp || canManageAI;
  const accessReady = !!profile && (canManageOrganization || (!loading && organizationsLoaded));
  const legacyIntegrationTabs = useMemo(() => [
    ...(canManageIntegrations ? ['webhooks', 'meta', 'grupo-olx', 'api'] : []),
    ...(canManageWhatsApp ? ['whatsapp'] : []),
    ...(canManageAI ? ['ai'] : []),
  ], [canManageAI, canManageIntegrations, canManageWhatsApp]);
  const isUnauthorizedAIRequest = accessReady && normalizedRequestedTab === 'ai' && !canManageAI;
  const isUnauthorizedIntegrationsRequest = accessReady && normalizedRequestedTab === 'integrations' && !canAccessIntegrations;
  const initialIntegration =
    !isUnauthorizedAIRequest && legacyIntegrationTabs.includes(normalizedRequestedTab) ? normalizedRequestedTab : undefined;
  const initialTab = isUnauthorizedAIRequest || isUnauthorizedIntegrationsRequest
    ? 'account'
    : initialIntegration
      ? 'integrations'
      : requestedTab;
  const [activeTab, setActiveTab] = useState(initialTab);

  // Sync tab when URL query param changes (e.g. external navigation)
  useEffect(() => {
    if (!accessReady) return;

    if (isBillingBlocked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza a aba ativa com bloqueio de faturamento e URL.
      if (activeTab !== 'subscription') setActiveTab('subscription');
      if (searchParams.get('tab') !== 'subscription') {
        const next = new URLSearchParams(searchParams);
        next.set('tab', 'subscription');
        replaceSearchParams(next);
      }
      return;
    }

    const rawTab = searchParams.get('tab');
    const t = rawTab === 'webhook' ? 'webhooks' : rawTab;
    if (t === 'ai' && !canManageAI) {
      if (activeTab !== 'account') setActiveTab('account');
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'account');
      replaceSearchParams(next);
      return;
    }
    const normalizedTab = t && legacyIntegrationTabs.includes(t) ? 'integrations' : t;
    if (normalizedTab === 'integrations' && !canAccessIntegrations) {
      if (activeTab !== 'account') setActiveTab('account');
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'account');
      replaceSearchParams(next);
      return;
    }
    if (normalizedTab === 'team' && !canAccessUsers) {
      if (activeTab !== 'account') setActiveTab('account');
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'account');
      replaceSearchParams(next);
      return;
    }
    if (
      (normalizedTab === 'subscription' && !canManageBilling) ||
      (normalizedTab === 'properties' && !canManageProperties)
    ) {
      if (activeTab !== 'account') setActiveTab('account');
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'account');
      replaceSearchParams(next);
      return;
    }
    if (normalizedTab && normalizedTab !== activeTab) {
      setActiveTab(normalizedTab);
    }
  }, [searchParams, isBillingBlocked, activeTab, replaceSearchParams, canAccessIntegrations, canAccessUsers, canManageAI, canManageBilling, canManageProperties, accessReady, legacyIntegrationTabs]);

  const handleTabChange = (value: string) => {
    if (isBillingBlocked && value !== 'subscription') return;
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    replaceSearchParams(next);
  };

  const hasWhatsAppModule = hasModule('whatsapp');
  const hasAIModule = canManageAI && hasModule('ai_agent');
  const hasWebhooksModule = hasModule('webhooks');
  const hasAPIModule = hasModule('api');
  const hasPortalsModule = hasModule('portals');

  return (
    <AppLayout title={t.settings.title}>
      <div className="animate-in">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsContent value="account">
            <AccountTab />
          </TabsContent>

          {!accessReady && ['team', 'subscription', 'properties'].includes(activeTab) && (
            <TabsContent value={activeTab}>
              <div className="app-card p-6 text-sm text-muted-foreground">Carregando permissões da organização...</div>
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
