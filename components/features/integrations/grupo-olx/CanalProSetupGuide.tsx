"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

const officialLinks = {
  feedGuide: "https://developers.grupozap.com/feeds/integration.html",
  xmlValidator: "https://developers.grupozap.com/feeds/xml_validator/",
  leadWebhook: "https://developers.grupozap.com/webhooks/integration_leads.html",
  reportWebhook: "https://developers.grupozap.com/webhooks/integration_report_feeds_via_webhooks.html",
} as const;

function OfficialLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

export function CanalProSetupGuide({ endpointsReady }: { endpointsReady: boolean }) {
  return (
    <section className="space-y-3 rounded-[8px] border border-white/[0.055] p-4" aria-labelledby="canal-pro-setup-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <h4 id="canal-pro-setup-title" className="font-medium">Manual de configuração no Canal Pro</h4>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Passo a passo para publicar no ZAP, Viva Real e OLX e receber os leads no Vimob.
          </p>
        </div>
        <Badge variant={endpointsReady ? "default" : "outline"}>
          {endpointsReady ? "URLs prontas" : "Ative para gerar as URLs"}
        </Badge>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Não baixe o XML. O Canal Pro consulta a URL gerada pelo Vimob a cada ciclo de importação. Os portais exibidos dependem do plano contratado com o Grupo OLX.
        </AlertDescription>
      </Alert>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="prepare">
          <AccordionTrigger>1. Preparar e ativar no Vimob</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Confirme que o contrato do Canal Pro inclui os portais e a grade de anúncios desejados.</li>
              <li>Preencha nome e e-mail de contato e escolha a pipeline, etapa e roleta ou responsável dos leads.</li>
              <li>Salve e ative a integração. Depois, na Ficha 360 de cada imóvel, disponibilize o canal Grupo OLX.</li>
              <li>Volte a esta tela e copie as três URLs sem alterar nenhum caractere.</li>
            </ol>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="feed">
          <AccordionTrigger>2. Cadastrar o XML de imóveis</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Acesse o Canal Pro com um usuário autorizado.</li>
              <li>Abra <strong className="text-foreground">Configurações da conta &gt; Integração de anúncios</strong>.</li>
              <li>Selecione a integração por feed/CRM e cole a URL <strong className="text-foreground">XML de imóveis</strong>.</li>
              <li>Salve e confira no Canal Pro a data da próxima execução e o Relatório de Integração.</li>
            </ol>
            <p>
              Consulte o <OfficialLink href={officialLinks.feedGuide}>guia oficial de feeds</OfficialLink>.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="webhooks">
          <AccordionTrigger>3. Habilitar leads e relatórios</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Use <strong className="text-foreground">Webhook de leads</strong> exclusivamente para novos contatos.</li>
              <li>Use <strong className="text-foreground">Webhook de relatórios</strong> exclusivamente para o resultado das cargas XML.</li>
              <li>Se esses campos não aparecerem no Canal Pro, solicite a homologação/cadastro ao suporte de integrações do Grupo OLX e informe as duas URLs.</li>
            </ol>
            <p>
              A autenticação Basic usa uma SECRET_KEY global fornecida ao CRM e administrada pela Vimob. Não envie esse segredo ao cliente e não acrescente token fora das URLs exibidas.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <OfficialLink href={officialLinks.leadWebhook}>contrato oficial de leads</OfficialLink>
              <OfficialLink href={officialLinks.reportWebhook}>contrato oficial de relatórios</OfficialLink>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="validate">
          <AccordionTrigger>4. Validar antes de liberar</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="space-y-1.5">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Abra a URL XML e confirme HTTP 200 e conteúdo VRSync.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Valide uma amostra no <OfficialLink href={officialLinks.xmlValidator}>validador oficial de XML</OfficialLink>.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Envie um lead de homologação e confirme criação, vínculo com imóvel e distribuição no CRM.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Após a próxima carga, confira os horários de XML, lead e relatório nesta tela.</li>
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="troubleshooting">
          <AccordionTrigger>Problemas comuns</AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong className="text-foreground">XML vazio:</strong> integração pausada ou nenhum imóvel válido disponibilizado na Ficha 360.</li>
              <li><strong className="text-foreground">404 no XML:</strong> URL antiga após regeneração; copie novamente e atualize o Canal Pro.</li>
              <li><strong className="text-foreground">401 no webhook:</strong> falha na SECRET_KEY da homologação; acione o suporte técnico da Vimob.</li>
              <li><strong className="text-foreground">Anúncio duplicado:</strong> o anúncio manual não é substituído automaticamente pelo XML; revise-o no Canal Pro.</li>
              <li><strong className="text-foreground">Mudança não apareceu:</strong> o processamento do feed ocorre duas vezes por dia e o horário pode variar.</li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
