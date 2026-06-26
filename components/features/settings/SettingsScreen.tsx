"use client";

import { useState, useEffect, useCallback } from 'react';
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
import { isBillingBlockedStatus } from '@/lib/billing-access';

export default function Settings() {
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { hasModule } = useOrganizationModules();
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
  const legacyIntegrationTabs = ['webhooks', 'meta', 'whatsapp', 'api'];
  const initialIntegration = legacyIntegrationTabs.includes(normalizedRequestedTab) ? normalizedRequestedTab : undefined;
  const initialTab = initialIntegration ? 'integrations' : requestedTab;
  const [activeTab, setActiveTab] = useState(initialTab);
  const isBillingBlocked = !isSuperAdmin && isBillingBlockedStatus(organization?.subscription_status);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const canManageOrganization =
    isSuperAdmin ||
    profile?.role === 'admin' ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';

  // Sync tab when URL query param changes (e.g. external navigation)
  useEffect(() => {
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
    const normalizedTab = t && legacyIntegrationTabs.includes(t) ? 'integrations' : t;
    if (normalizedTab && !canManageOrganization && ['team', 'subscription'].includes(normalizedTab)) {
      if (activeTab !== 'account') setActiveTab('account');
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'account');
      replaceSearchParams(next);
      return;
    }
    if (normalizedTab && normalizedTab !== activeTab) {
      setActiveTab(normalizedTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isBillingBlocked, activeTab, replaceSearchParams, canManageOrganization]);

  const handleTabChange = (value: string) => {
    if (isBillingBlocked && value !== 'subscription') return;
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    replaceSearchParams(next);
  };

  const hasWhatsAppModule = hasModule('whatsapp');
  const hasWebhooksModule = hasModule('webhooks');
  const hasAPIModule = hasModule('api');

  return (
    <AppLayout title={t.settings.title}>
      <div className="animate-in">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsContent value="account">
            <AccountTab />
          </TabsContent>

          {canManageOrganization && (
            <TabsContent value="team">
              <TeamTab />
            </TabsContent>
          )}

          <TabsContent value="integrations">
            <IntegrationsTab
              defaultIntegration={initialIntegration}
              hasWhatsAppModule={hasWhatsAppModule}
              hasWebhooksModule={hasWebhooksModule}
              hasAPIModule={hasAPIModule}
            />
          </TabsContent>

          {(canManageOrganization || isBillingBlocked) && (
            <TabsContent value="subscription">
              <SubscriptionTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
