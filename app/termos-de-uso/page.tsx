import type { Metadata } from "next";

import { PublicHero, PublicPageShell } from "@/components/features/public";

export const metadata: Metadata = {
  title: "Termos de Uso | Vimob",
  description:
    "Termos de Uso da plataforma Vimob para licenciamento e utilização do CRM imobiliário.",
};

const responsibilityItems = [
  "Manter o sigilo das credenciais de acesso e responder pelas atividades realizadas nas contas vinculadas à organização.",
  "Garantir a origem legítima dos leads, contatos, dados de clientes e mídias inseridos ou integrados à plataforma.",
  "Utilizar o Vimob conforme a lei, estes termos, as políticas aplicáveis e as permissões contratadas no plano ativo.",
  "Não tentar explorar vulnerabilidades, executar testes de estresse não autorizados ou realizar engenharia reversa da plataforma.",
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

export default function TermsOfUsePage() {
  return (
    <PublicPageShell plainBackground>
      <PublicHero
        backgroundImage="/images/legal-hero-background.webp"
        compact
        eyebrow="Documentação legal"
        title="Termos de Uso"
        meta="Última atualização: junho de 2026"
      />

      <section className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 lg:py-14">
        <div className="space-y-10">
          <p className="text-sm leading-7 text-[var(--public-muted)] sm:text-[15px]">
            Ao acessar ou utilizar o Vimob, o cliente declara que leu, entendeu
            e concorda com estes Termos de Uso. O documento regula o uso da
            plataforma de CRM imobiliário, seus módulos, integrações e serviços
            relacionados.
          </p>

          <LegalSection title="1. Licenciamento e escopo de uso">
            <p>
              O Vimob concede uma licença de uso revogável, não exclusiva e
              intransferível da plataforma, conforme o plano contratado ou
              período de teste disponibilizado. Limites de usuários, recursos,
              integrações e módulos podem variar de acordo com a assinatura
              ativa.
            </p>
          </LegalSection>

          <LegalSection title="2. Responsabilidades do usuário">
            <p>Ao utilizar a infraestrutura do Vimob, o cliente compromete-se a:</p>
            <ul className="space-y-3 pl-5 marker:text-[var(--public-accent)]">
              {responsibilityItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </LegalSection>

          <LegalSection title="3. Disponibilidade e serviços terceiros">
            <p>
              O Vimob busca manter um padrão elevado de disponibilidade e
              segurança. Ainda assim, a plataforma depende de serviços de
              infraestrutura, autenticação, banco de dados, mensageria,
              provedores de pagamento e integrações externas. Instabilidades
              nesses terceiros podem afetar temporariamente recursos do sistema.
            </p>
          </LegalSection>

          <LegalSection title="4. Cancelamento e encerramento">
            <p>
              Violações de segurança, fraude, uso abusivo ou descumprimento
              destes termos poderão resultar em bloqueio ou suspensão do acesso.
              Em cancelamentos regulares, o cliente poderá solicitar exportação
              dos dados disponíveis conforme os limites técnicos, contratuais e
              legais aplicáveis.
            </p>
          </LegalSection>

          <LegalSection title="5. Alterações dos termos">
            <p>
              Estes termos poderão ser atualizados para refletir mudanças
              legais, operacionais ou evoluções do produto. Quando necessário, o
              Vimob poderá comunicar alterações relevantes pelos canais
              cadastrados na plataforma.
            </p>
          </LegalSection>

          <LegalSection title="6. Foro">
            <p>
              Para dirimir eventuais controvérsias relacionadas a estes termos,
              as partes elegem o foro competente conforme a sede da empresa
              proprietária da marca Vimob, salvo disposição legal obrigatória em
              sentido diverso.
            </p>
          </LegalSection>
        </div>
      </section>
    </PublicPageShell>
  );
}
