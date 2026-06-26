"use client";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { MetaIntegrationSettings } from "@/components/features/integrations/MetaIntegrationSettings";

export default function MetaSettingsScreen() {
  return (
    <AppLayout title="Integração Meta">
      <MetaIntegrationSettings />
    </AppLayout>
  );
}
