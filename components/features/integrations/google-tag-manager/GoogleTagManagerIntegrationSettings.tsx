"use client";

import { GoogleSiteIntegrationForm } from "@/components/features/integrations/google-site/GoogleSiteIntegrationForm";
import {
  useGoogleTagManagerIntegration,
  useSaveGoogleTagManagerIntegration,
} from "@/hooks/integrations/google-tag-manager";
import { googleTagManagerContainerIdSchema } from "@/lib/validation";

export function GoogleTagManagerIntegrationSettings() {
  const integration = useGoogleTagManagerIntegration();
  const save = useSaveGoogleTagManagerIntegration();

  return (
    <GoogleSiteIntegrationForm
      currentValue={integration.data?.value}
      description="Instala o contêiner Web do Google Tag Manager nas páginas públicas somente após o consentimento de cookies."
      documentationUrl="https://support.google.com/tagmanager/answer/14847097?hl=pt-BR"
      instructions={[
        "No Google Tag Manager, crie ou abra um contêiner do tipo Web.",
        "Copie apenas o ID iniciado por GTM- e salve-o aqui.",
        "Se o GA4 for configurado dentro do GTM, remova o ID direto do Google Analytics no Vimob para não medir pageviews e eventos duas vezes.",
        "Configure e publique as tags no workspace do Google; salvar no Vimob não publica alterações dentro do GTM.",
        "Abra o site no Tag Assistant e aceite os cookies antes de testar; o contêiner não deve carregar antes do consentimento.",
      ]}
      inputId="google-tag-manager-container-id"
      isConfigured={integration.data?.configured}
      isError={integration.isError}
      isLoading={integration.isLoading}
      isPending={save.isPending}
      label="ID do contêiner Web"
      onSave={async (value) => {
        const normalized = value === null ? null : googleTagManagerContainerIdSchema.parse(value);
        await save.mutateAsync(normalized);
      }}
      placeholder="GTM-XXXXXXXX"
      siteActive={integration.data?.siteActive}
      siteUrl={integration.data?.publicUrl}
      title="Google Tag Manager"
    />
  );
}
