import type { Metadata } from "next";

import { PublicHero, PublicPageShell } from "@/components/features/public";

export const metadata: Metadata = {
  title: "Política de Privacidade | Vimob",
  description:
    "Política de Privacidade da plataforma Vimob sobre tratamento de dados pessoais em conformidade com a LGPD.",
};

const collectionItems = [
  "Dados da organização contratante, como razão social, nome fantasia, CNPJ, telefone, e-mail, endereço comercial e configurações da conta.",
  "Dados de usuários da plataforma, como nome, e-mail, WhatsApp, função, permissões, organização vinculada e registros de autenticação.",
  "Dados de leads, contatos e clientes finais inseridos ou integrados pela organização, incluindo histórico de atendimento e informações comerciais necessárias ao CRM.",
  "Dados técnicos de uso, como endereço IP, datas de acesso, navegador, dispositivo, eventos de segurança, logs de erro e registros operacionais.",
];

const usageItems = [
  "Criar, configurar, manter e operar a conta do cliente na plataforma Vimob.",
  "Disponibilizar funcionalidades de CRM, leads, pipelines, agenda, WhatsApp, imóveis, integrações e automações.",
  "Executar integrações autorizadas pelo cliente, como Meta, WhatsApp, sites, formulários, APIs e provedores de pagamento.",
  "Proteger a plataforma, controlar acessos, auditar eventos, prevenir fraudes e investigar uso indevido.",
  "Prestar suporte técnico, corrigir incidentes, melhorar estabilidade, desempenho e experiência de uso.",
  "Cumprir obrigações legais, regulatórias, contratuais ou ordens de autoridades competentes.",
  "Enviar comunicações operacionais, administrativas, de segurança, cobrança, manutenção ou atualização da plataforma.",
];

const sharingItems = [
  "Provedores de infraestrutura, hospedagem, banco de dados, autenticação, armazenamento, monitoramento, mensageria e segurança.",
  "Ferramentas externas configuradas, contratadas ou autorizadas pela organização administradora da conta.",
  "Prestadores necessários para suporte técnico, manutenção, segurança, melhoria e continuidade da plataforma.",
  "Autoridades públicas, judiciais, administrativas ou regulatórias, quando houver obrigação legal ou necessidade de defesa de direitos.",
];

function LegalSection({
  children,
  title,
}: Readonly<{
  children: React.ReactNode;
  title: string;
}>) {
  return (
    <section className="space-y-4">
      <h2 className="border-l-2 border-[var(--public-accent)] pl-4 text-lg font-semibold text-[var(--public-foreground)]">
        {title}
      </h2>
      <div className="space-y-4 text-sm leading-7 text-[var(--public-muted)] sm:text-[15px]">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <PublicPageShell plainBackground>
      <PublicHero
        backgroundImage="/images/legal-hero-background.webp"
        compact
        eyebrow="Documentação legal"
        title="Política de Privacidade"
        meta="Última atualização: junho de 2026"
      />

      <section className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 lg:py-14">
        <div className="space-y-10">
          <div className="space-y-4 text-sm leading-7 text-[var(--public-muted)] sm:text-[15px]">
            <p>
              Esta Política de Privacidade explica, de forma clara e objetiva,
              como o Vimob trata dados pessoais no contexto da utilização de sua
              plataforma de CRM imobiliário.
            </p>
            <p>
              Em regra, o Vimob atua como operador de dados, fornecendo
              infraestrutura tecnológica para que organizações contratantes
              gerenciem leads, contatos, atendimentos e negociações.
            </p>
            <p>
              A organização contratante atua, em regra, como controladora dos
              dados inseridos, importados, integrados ou tratados dentro da
              plataforma.
            </p>
          </div>

          <LegalSection title="1. Dados coletados">
            <p>
              Para viabilizar o funcionamento da plataforma e a prestação dos
              serviços contratados, o Vimob poderá tratar:
            </p>
            <ul className="space-y-3 pl-5 marker:text-[var(--public-accent)]">
              {collectionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </LegalSection>

          <LegalSection title="2. Finalidades de uso">
            <p>
              Os dados poderão ser tratados conforme a natureza da contratação,
              funcionalidades utilizadas e integrações autorizadas pelo cliente:
            </p>
            <ol className="space-y-3 pl-5 marker:text-[var(--public-accent)]">
              {usageItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </LegalSection>

          <LegalSection title="3. Compartilhamento">
            <p>
              O Vimob não vende dados pessoais. O compartilhamento ocorre apenas
              quando necessário para operação da plataforma, execução do
              contrato, cumprimento de obrigação legal ou proteção de direitos.
            </p>
            <ul className="space-y-3 pl-5 marker:text-[var(--public-accent)]">
              {sharingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </LegalSection>

          <LegalSection title="4. Direitos dos titulares">
            <p>
              Nos termos da LGPD, titulares de dados pessoais poderão solicitar,
              quando aplicável, confirmação de tratamento, acesso, correção,
              anonimização, bloqueio, eliminação, portabilidade, informações de
              compartilhamento e revogação de consentimento.
            </p>
            <p>
              Como o Vimob normalmente atua como operador, solicitações ligadas
              a leads, contatos ou clientes finais devem ser direcionadas
              preferencialmente à organização responsável pelo cadastro e uso
              desses dados.
            </p>
          </LegalSection>

          <LegalSection title="5. Retenção e segurança">
            <p>
              Os dados são mantidos pelo tempo necessário para cumprir as
              finalidades descritas, obrigações legais, contratuais,
              regulatórias, fiscais, contábeis, de auditoria, segurança ou
              defesa de direitos.
            </p>
          </LegalSection>
        </div>
      </section>
    </PublicPageShell>
  );
}
