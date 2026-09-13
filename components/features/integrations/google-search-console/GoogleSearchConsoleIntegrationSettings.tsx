"use client";

import { GoogleSiteIntegrationForm } from "@/components/features/integrations/google-site/GoogleSiteIntegrationForm";
import {
  useGoogleSearchConsoleIntegration,
  useSaveGoogleSearchConsoleIntegration,
} from "@/hooks/integrations/google-search-console";
import { googleSearchConsoleVerificationTokenSchema } from "@/lib/validation";

export function GoogleSearchConsoleIntegrationSettings() {
  const integration = useGoogleSearchConsoleIntegration();
  const save = useSaveGoogleSearchConsoleIntegration();

  return (
    <GoogleSiteIntegrationForm
      currentValue={integration.data?.value}
      description="Publica a meta tag de propriedade no HTML da página inicial para permitir a verificação do site no Google Search Console."
      documentationUrl="https://support.google.com/webmasters/answer/9008080?hl=pt-BR"
      instructions={[
        "No Search Console, adicione uma propriedade do tipo Prefixo do URL para o domínio publicado.",
        "Escolha Tag HTML e cole aqui o token ou a meta tag completa fornecida pelo Google.",
        "Salve, aguarde o site público atualizar e clique em Verificar no Search Console.",
      ]}
      inputId="google-search-console-verification-token"
      isConfigured={integration.data?.configured}
      isError={integration.isError}
      isLoading={integration.isLoading}
      isPending={save.isPending}
      label="Token ou meta tag de verificação"
      onSave={async (value) => {
        const normalized = value === null ? null : googleSearchConsoleVerificationTokenSchema.parse(value);
        await save.mutateAsync(normalized);
      }}
      placeholder='Token ou <meta name="google-site-verification" ...>'
      siteActive={integration.data?.siteActive}
      siteUrl={integration.data?.publicUrl}
      title="Google Search Console"
    />
  );
}
