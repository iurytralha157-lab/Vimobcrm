"use client";

import { GoogleSiteIntegrationForm } from "@/components/features/integrations/google-site/GoogleSiteIntegrationForm";
import {
  useGoogleAnalyticsIntegration,
  useSaveGoogleAnalyticsIntegration,
} from "@/hooks/integrations/google-analytics";
import { googleAnalyticsMeasurementIdSchema } from "@/lib/validation";

export function GoogleAnalyticsIntegrationSettings() {
  const integration = useGoogleAnalyticsIntegration();
  const save = useSaveGoogleAnalyticsIntegration();

  return (
    <GoogleSiteIntegrationForm
      currentValue={integration.data?.value}
      description="Instala o Google Analytics 4 nas páginas públicas da imobiliária somente após o consentimento de cookies."
      documentationUrl="https://support.google.com/analytics/answer/14183469?hl=pt-BR"
      instructions={[
        "No Google Analytics, abra Administrador > Fluxos de dados e selecione o fluxo da Web.",
        "Copie o ID de medição iniciado por G- e salve-o aqui.",
        "Se houver um identificador legado iniciado por UA-, substitua-o pelo ID atual do fluxo GA4.",
        "Escolha um único caminho: ID do GA4 direto no Vimob ou tag do GA4 dentro do GTM. Não use os dois para evitar pageviews e eventos duplicados.",
        "Acesse o site publicado, aceite os cookies e confirme a visita no relatório Em tempo real.",
      ]}
      inputId="google-analytics-measurement-id"
      isConfigured={integration.data?.configured}
      isError={integration.isError}
      isLoading={integration.isLoading}
      isPending={save.isPending}
      label="ID de medição do GA4"
      onSave={async (value) => {
        const normalized = value === null ? null : googleAnalyticsMeasurementIdSchema.parse(value);
        await save.mutateAsync(normalized);
      }}
      placeholder="G-XXXXXXXXXX"
      siteActive={integration.data?.siteActive}
      siteUrl={integration.data?.publicUrl}
      title="Google Analytics"
    />
  );
}
