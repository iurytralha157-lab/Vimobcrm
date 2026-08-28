"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { VIMOB_MARKETING_SITE_URL } from "@/config/constants";

export type OnboardingPlanOption = {
  id?: string;
  slug: string;
  signupPath: "trial" | "paid";
  name: string;
  price: string;
  originalPrice?: number | null;
  discount?: number | null;
  displayOrder?: number | null;
  description: string;
  billingCycle?: string | null;
  trialEnabled?: boolean | null;
  trialDays?: number | null;
  maxUsers?: number | null;
  maxWhatsappSessions?: number | null;
  modules?: string[];
  features?: string[];
};

type PlanCarouselProps = Readonly<{
  plans: OnboardingPlanOption[];
  selectedSlug?: string;
  disabled?: boolean;
  onSelect: (plan: OnboardingPlanOption) => void | Promise<void>;
}>;

function splitPlanPrice(price: string) {
  const match = price.trim().match(/^(R\$)\s*([\d.,]+)(\/\S+)?$/i);

  if (!match) {
    return { amount: price, currency: "", cycle: "" };
  }

  return {
    amount: match[2],
    currency: match[1],
    cycle: (match[3] || "").replace("/mes", "/mês"),
  };
}

function formatCurrency(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value.toLocaleString("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  });
}

const sideButtonClass =
  "absolute top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:bg-[var(--app-surface-soft)] disabled:text-[var(--app-text-muted)]";

export function PlanCarousel({
  plans,
  selectedSlug,
  disabled = false,
  onSelect,
}: PlanCarouselProps) {
  const [visiblePlanSlug, setVisiblePlanSlug] = useState<string | null>(
    () => plans[0]?.slug || null,
  );
  const requestedIndex = plans.findIndex((plan) => plan.slug === visiblePlanSlug);
  const selectedIndex = plans.findIndex((plan) => plan.slug === selectedSlug);
  const visibleIndex = disabled && selectedIndex >= 0
    ? selectedIndex
    : requestedIndex >= 0
      ? requestedIndex
      : 0;
  const activePlan = plans[visibleIndex];
  const canNavigate = plans.length > 1 && !disabled;
  const canShowPrevious = canNavigate && visibleIndex > 0;
  const canShowNext = canNavigate && visibleIndex < plans.length - 1;

  function showPlan(index: number) {
    if (!canNavigate || index < 0 || index >= plans.length) return;
    setVisiblePlanSlug(plans[index].slug);
  }

  function handleCarouselKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.currentTarget !== event.target || !canNavigate) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPlan(visibleIndex - 1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      showPlan(visibleIndex + 1);
    }
  }

  if (!activePlan) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-solid)] px-5 py-8 text-center text-xs font-light text-[var(--app-text-tertiary)]">
        Nenhum plano disponível agora.
      </div>
    );
  }

  const isSelected = selectedSlug === activePlan.slug;
  const price = splitPlanPrice(activePlan.price);
  const originalPrice = formatCurrency(activePlan.originalPrice);
  const discount =
    typeof activePlan.discount === "number" &&
    Number.isFinite(activePlan.discount) &&
    activePlan.discount > 0
      ? activePlan.discount.toLocaleString("pt-BR", {
          maximumFractionDigits: 2,
        })
      : null;
  return (
    <section
      aria-label="Planos do Vimob crm"
      aria-roledescription="carrossel"
      className="space-y-1.5 rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      tabIndex={0}
      onKeyDown={handleCarouselKeyDown}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        Plano {activePlan.name}, {visibleIndex + 1} de {plans.length}.
      </p>

      <div className="relative">
        <button
          type="button"
          onClick={() => showPlan(visibleIndex - 1)}
          disabled={!canShowPrevious}
          aria-label="Ver plano anterior"
          className={`${sideButtonClass} left-0`}
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
        </button>

        <article className="mx-9 rounded-[8px] bg-[var(--app-surface-solid)] p-4 sm:p-5">
          <div className="flex min-h-6 items-start justify-between gap-3">
            <h2 className="text-[18px] font-normal text-[var(--app-text-primary)]">
              {activePlan.name}
            </h2>
            {discount ? (
              <span className="shrink-0 rounded-[6px] bg-primary/50 px-2.5 py-1 text-[10px] font-light text-primary-foreground">
                {discount}% de desconto
              </span>
            ) : null}
          </div>

          {originalPrice ? (
            <p className="mt-3 text-[11px] font-light text-[var(--app-text-tertiary)]">
              De <span className="line-through decoration-primary/70">{originalPrice}</span> por
            </p>
          ) : null}

          <div className="mt-1 flex items-end gap-1 text-[var(--app-text-primary)]">
            {price.currency ? (
              <span className="pb-1 text-[12px] font-light">{price.currency}</span>
            ) : null}
            <span className="text-[30px] font-light leading-none tracking-[-0.04em]">
              {price.amount}
            </span>
            {price.cycle ? (
              <span className="pb-0.5 text-[13px] font-light text-[var(--app-text-secondary)]">
                {price.cycle}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void onSelect(activePlan)}
            disabled={disabled}
            aria-pressed={isSelected}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            {isSelected ? "Plano selecionado" : "Escolher plano"}
          </button>

          <p className="mt-2 text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
            {activePlan.signupPath === "trial"
              ? `${activePlan.trialDays || 7} dias grátis. Sem cobrança agora.`
              : "Pagamento seguro na próxima etapa."}
          </p>

          <a
            href={VIMOB_MARKETING_SITE_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-[11px] font-light text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-primary hover:underline hover:underline-offset-4 focus-visible:text-primary focus-visible:underline focus-visible:underline-offset-4"
          >
            Saiba mais
          </a>
        </article>

        <button
          type="button"
          onClick={() => showPlan(visibleIndex + 1)}
          disabled={!canShowNext}
          aria-label="Ver próximo plano"
          className={`${sideButtonClass} right-0`}
        >
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-1" aria-label="Escolher posição do carrossel">
        {plans.map((plan, index) => (
          <button
            key={plan.slug}
            type="button"
            onClick={() => showPlan(index)}
            disabled={disabled}
            aria-label={`Mostrar plano ${plan.name}`}
            aria-current={index === visibleIndex ? "true" : undefined}
            className="group inline-flex h-6 w-6 items-center justify-center rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span
              className={`h-1.5 rounded-full transition-all ${
                index === visibleIndex
                  ? "w-5 bg-primary/70"
                  : "w-1.5 bg-[var(--app-border-strong)] group-hover:bg-primary/50"
              }`}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
