import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BookOpenText,
  CircleHelp,
  MessageCircle,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import { PublicHero, PublicPageShell } from "@/components/features/public";

type HelpCategory = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
  stats: string;
};

const categories: HelpCategory[] = [
  {
    description: "Configure sua conta, crie a organização e entenda o primeiro acesso.",
    href: "#primeiros-passos",
    icon: Rocket,
    label: "Primeiros passos",
    stats: "4 guias essenciais",
  },
  {
    description: "Aprenda os fluxos principais de CRM, leads, agenda, WhatsApp e imóveis.",
    href: "#conteudos",
    icon: BookOpenText,
    label: "Conteúdos do Vimob",
    stats: "8 temas principais",
  },
  {
    description: "Respostas rápidas sobre cadastro, pagamento, segurança e uso diário.",
    href: "#faq",
    icon: CircleHelp,
    label: "FAQ",
    stats: "Dúvidas frequentes",
  },
];

const topics = [
  {
    icon: Workflow,
    title: "CRM e pipeline",
    text: "Organize leads por estágios, acompanhe cadências e mantenha o histórico comercial em um só lugar.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp",
    text: "Conecte conversas ao atendimento do time e mantenha o relacionamento sem perder contexto.",
  },
  {
    icon: Settings2,
    title: "Configurações",
    text: "Ajuste equipe, permissões, dados da organização, integrações e preferências do ambiente.",
  },
  {
    icon: ShieldCheck,
    title: "Segurança",
    text: "Entenda permissões, termos, privacidade e cuidados básicos para operar a plataforma.",
  },
];

const firstSteps = [
  "Criar sua conta e confirmar os dados da imobiliária.",
  "Escolher o plano ou iniciar o período de teste disponível.",
  "Convidar corretores e definir permissões de acesso.",
  "Configurar o primeiro pipeline comercial do time.",
];

const faqItems = [
  {
    question: "O teste grátis já libera o CRM?",
    answer:
      "Sim. O plano inicial pode liberar o acesso durante o período de teste configurado, com os módulos previstos para essa oferta.",
  },
  {
    question: "O pagamento libera o acesso automaticamente?",
    answer:
      "A liberação acontece após a confirmação do provedor de pagamento. O Vimob recebe o retorno e atualiza o status da organização.",
  },
  {
    question: "Onde encontro termos e política de privacidade?",
    answer:
      "Os documentos públicos ficam disponíveis no rodapé desta página e também nas telas de cadastro e acesso.",
  },
];

export default function PublicHelpScreen() {
  return (
    <PublicPageShell>
      <PublicHero
        backgroundImage="/images/legal-hero-background.webp"
        eyebrow="Central de ajuda"
        title="Como podemos ajudar?"
        description="Guias rápidos para começar, entender os módulos principais e resolver dúvidas comuns sobre o Vimob."
      >
        <div className="flex h-14 items-center gap-3 rounded-full border border-[var(--public-border)] bg-white px-5 text-left shadow-sm">
          <Search className="h-5 w-5 shrink-0 text-[var(--public-muted)]" />
          <span className="text-sm text-[var(--public-muted)]">
            Busque por cadastro, CRM, WhatsApp, pagamento ou configurações
          </span>
        </div>
      </PublicHero>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-12 sm:px-8 md:grid-cols-3">
        {categories.map((category) => (
          <Link
            key={category.label}
            href={category.href}
            className="group rounded-lg border border-[var(--public-border)] bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--public-accent)] hover:shadow-md"
          >
            <category.icon className="h-7 w-7 text-[var(--public-accent)]" />
            <h2 className="mt-5 text-xl font-semibold text-[var(--public-foreground)]">
              {category.label}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--public-muted)]">
              {category.description}
            </p>
            <div className="mt-6 flex items-center justify-between text-sm font-medium text-[var(--public-foreground)]">
              <span>{category.stats}</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </section>

      <section
        id="primeiros-passos"
        className="border-y border-[var(--public-border)] bg-white"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--public-accent)]">
              Primeiros passos
            </p>
            <h2 className="mt-4 text-3xl font-semibold text-[var(--public-foreground)]">
              Comece com o essencial, sem pular a estrutura.
            </h2>
            <p className="mt-4 leading-7 text-[var(--public-muted)]">
              A configuração inicial deve deixar usuário, organização, plano e
              permissões coerentes antes de avançar para módulos maiores.
            </p>
          </div>
          <ol className="grid gap-4">
            {firstSteps.map((step, index) => (
              <li
                key={step}
                className="flex gap-4 rounded-lg border border-[var(--public-border)] bg-[var(--public-background)] p-5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--public-accent)] text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <span className="pt-1 text-sm leading-6 text-[var(--public-foreground)]">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="conteudos" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--public-accent)]">
              Conteúdos
            </p>
            <h2 className="mt-4 text-3xl font-semibold text-[var(--public-foreground)]">
              Tudo sobre o Vimob
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[var(--public-muted)]">
            Esta base pública nasce enxuta e vai crescer junto com os módulos do sistema.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {topics.map((topic) => (
            <article
              key={topic.title}
              className="rounded-lg border border-[var(--public-border)] bg-white p-6 shadow-sm"
            >
              <topic.icon className="h-6 w-6 text-[var(--public-accent)]" />
              <h3 className="mt-4 text-lg font-semibold text-[var(--public-foreground)]">
                {topic.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[var(--public-muted)]">
                {topic.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="bg-white">
        <div className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--public-accent)]">
            FAQ
          </p>
          <h2 className="mt-4 text-center text-3xl font-semibold text-[var(--public-foreground)]">
            Dúvidas frequentes
          </h2>

          <div className="mt-8 divide-y divide-[var(--public-border)] rounded-lg border border-[var(--public-border)] bg-white">
            {faqItems.map((item) => (
              <article key={item.question} className="p-6">
                <h3 className="text-base font-semibold text-[var(--public-foreground)]">
                  {item.question}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--public-muted)]">
                  {item.answer}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
