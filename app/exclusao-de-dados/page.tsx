import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";

import {
  PublicDocument,
  PublicDocumentSection,
  PublicHero,
  PublicPageShell,
} from "@/components/features/public";

export const metadata: Metadata = {
  title: "Exclusão de dados | Vimob",
  description:
    "Instruções para desconectar a integração do Vimob com a Meta e solicitar a exclusão de dados relacionados ao Facebook e Instagram.",
};

const vimobDisconnectSteps = [
  "Entre no Vimob com um usuário autorizado pela organização.",
  "Acesse Configurações, abra Integrações e selecione Meta.",
  "Em Gerenciar conexão Meta, localize a conta conectada, selecione Desconectar e confirme a operação.",
];

const facebookRemovalSteps = [
  "Acesse o Facebook com a conta que autorizou a integração.",
  "Abra Configurações e privacidade, entre em Configurações e acesse Aplicativos e sites.",
  "Localize Vimob CRM, selecione Remover e confirme a revogação do acesso.",
];

const requestDetails = [
  "nome completo e e-mail utilizado no Vimob;",
  "nome da organização vinculada à conta;",
  "nome ou identificador público da Página do Facebook e do perfil do Instagram envolvidos;",
  "se o pedido abrange somente a integração Meta ou também dados históricos do CRM.",
];

export default function DataDeletionPage() {
  return (
    <PublicPageShell>
      <PublicHero
        compact
        eyebrow="Privacidade e integrações"
        title="Exclusão de dados e desconexão da Meta"
      />

      <PublicDocument>
        <div className="space-y-8">
          <div className="space-y-3 text-[13px] leading-6 text-[var(--public-muted)] sm:text-sm sm:leading-7">
            <p>
              Esta página se aplica às conexões autorizadas entre o Vimob CRM e
              produtos da Meta, incluindo Páginas do Facebook, perfis
              profissionais do Instagram, contas de anúncios e formulários de
              leads.
            </p>
            <p>
              Desconectar a Meta interrompe novos acessos e sincronizações após
              a conclusão do processo. A remoção da conexão e a exclusão de
              registros históricos do CRM são solicitações diferentes, conforme
              explicado abaixo.
            </p>
          </div>

          <PublicDocumentSection title="1. Desconectar a Meta pelo Vimob">
            <ol className="list-decimal space-y-2 pl-5 marker:text-[var(--public-accent)]">
              {vimobDisconnectSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p>
              Caso você não consiga acessar a conta ou não encontre a opção de
              desconexão, envie uma solicitação para o canal indicado na seção 5.
            </p>
          </PublicDocumentSection>

          <PublicDocumentSection title="2. Revogar o acesso diretamente no Facebook">
            <ol className="list-decimal space-y-2 pl-5 marker:text-[var(--public-accent)]">
              {facebookRemovalSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <a
              href="https://www.facebook.com/settings?tab=applications"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-primary/50 px-4 font-medium text-primary-foreground transition-colors hover:bg-primary"
            >
              Abrir Aplicativos e sites no Facebook
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            <p>
              Essa ação revoga a autorização concedida à Meta. Para obter a
              confirmação da remoção dos dados técnicos mantidos pelo Vimob,
              envie também a solicitação descrita na seção 5.
            </p>
          </PublicDocumentSection>

          <PublicDocumentSection title="3. Dados removidos da integração">
            <p>Após a validação do pedido, a remoção abrange:</p>
            <ul className="list-disc space-y-2 pl-5 marker:text-[var(--public-accent)]">
              <li>
                tokens de acesso e outras credenciais de autorização da Meta
                armazenadas pelo Vimob;
              </li>
              <li>
                vínculos entre a organização e as Páginas, perfis do Instagram,
                contas de anúncios, formulários e demais ativos conectados;
              </li>
              <li>
                configurações da integração necessárias para futuras
                sincronizações, assinaturas de eventos e recebimento de leads.
              </li>
            </ul>
          </PublicDocumentSection>

          <PublicDocumentSection title="4. Histórico do CRM e retenção legal">
            <p>
              A desconexão da Meta não apaga automaticamente leads, contatos,
              atendimentos, negócios, métricas ou outros registros históricos já
              incorporados ao CRM. Em regra, a organização contratante é a
              controladora desses dados e o Vimob atua como operador.
            </p>
            <p>
              Pedidos de exclusão desse histórico serão avaliados separadamente,
              conforme o contrato aplicável, as instruções da organização
              controladora, a LGPD e eventuais obrigações legais, regulatórias,
              fiscais, de auditoria, segurança ou defesa de direitos. Quando a
              eliminação não puder ser integral, informaremos o escopo da
              retenção aplicável.
            </p>
          </PublicDocumentSection>

          <PublicDocumentSection title="5. Enviar uma solicitação ao Vimob">
            <p>
              Envie um e-mail com o assunto “Exclusão de dados Meta” para:
            </p>
            <a
              href="mailto:contato@vimobcrm.com.br?subject=Exclus%C3%A3o%20de%20dados%20Meta"
              className="inline-flex min-h-11 items-center gap-2 rounded-[6px] bg-primary/50 px-4 font-medium text-primary-foreground transition-colors hover:bg-primary"
            >
              <Mail className="h-4 w-4" aria-hidden />
              contato@vimobcrm.com.br
            </a>
            <p>Inclua no pedido:</p>
            <ul className="list-disc space-y-2 pl-5 marker:text-[var(--public-accent)]">
              {requestDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            <p>
              Nunca envie senhas, códigos de autenticação, tokens de acesso ou
              chaves privadas por e-mail.
            </p>
          </PublicDocumentSection>

          <PublicDocumentSection title="6. Verificação, prazo e confirmação">
            <p>
              Para impedir exclusões indevidas, poderemos confirmar a identidade
              do solicitante, seu vínculo com a organização e sua autorização
              sobre os ativos informados. O prazo começa após o recebimento das
              informações necessárias para essa verificação.
            </p>
            <p>
              A remoção técnica será concluída em até 30 dias após a validação do
              pedido. Se houver fundamento legal ou contratual para manter parte
              dos registros, o solicitante será informado. Ao final, enviaremos
              uma confirmação para o e-mail verificado.
            </p>
          </PublicDocumentSection>

          <PublicDocumentSection title="7. Mais informações">
            <p>
              Consulte também a nossa{" "}
              <Link
                href="/politica-de-privacidade"
                className="font-medium text-[var(--public-accent)] underline-offset-4 hover:underline"
              >
                Política de Privacidade
              </Link>{" "}
              para entender as finalidades, bases de tratamento, retenção e
              direitos dos titulares.
            </p>
          </PublicDocumentSection>
        </div>
      </PublicDocument>
    </PublicPageShell>
  );
}
