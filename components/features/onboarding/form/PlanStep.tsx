import { VimobLoader } from "@/components/shared/loading";
import { PlanCarousel } from "../PlanCarousel";
import { labelClass, secondaryActionClass } from "./styles";
import type { OnboardingPlanOption } from "./plan-rules";
import type { PlansLoadState } from "./types";

type PlanStepProps = {
  canSubmitPlan: boolean;
  checkoutToken: string | null;
  isChangingCheckoutPlan: boolean;
  isCheckoutPlanLocked: boolean;
  isSubmitting: boolean;
  isUpdatingCheckoutPlan: boolean;
  planOptions: OnboardingPlanOption[];
  plansLoadError: string | null;
  plansLoadState: PlansLoadState;
  selectedPlan: OnboardingPlanOption | undefined;
  selectedPlanSlug: string;
  submitError: string | null;
  onBack: () => void;
  onRetryPlans: () => void;
  onSelectPlan: (plan: OnboardingPlanOption) => void | Promise<void>;
};

export function PlanStep({
  canSubmitPlan,
  checkoutToken,
  isChangingCheckoutPlan,
  isCheckoutPlanLocked,
  isSubmitting,
  isUpdatingCheckoutPlan,
  planOptions,
  plansLoadError,
  plansLoadState,
  selectedPlan,
  selectedPlanSlug,
  submitError,
  onBack,
  onRetryPlans,
  onSelectPlan,
}: PlanStepProps) {
  return (
    <>
      <div className="space-y-1.5">
        <p className={labelClass}>
          Escolha seu plano
        </p>
        {plansLoadState === "idle" || plansLoadState === "loading" ? (
          <div className="flex min-h-36 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
            <VimobLoader size="sm" label="Carregando planos..." />
          </div>
        ) : plansLoadState === "error" || plansLoadState === "empty" ? (
          <div className="rounded-[8px] bg-[var(--app-surface-solid)] px-5 py-6 text-center">
            <p className="text-xs font-light leading-5 text-[var(--app-text-secondary)]">
              {plansLoadState === "empty"
                ? "Nenhum plano está disponível agora. Tente novamente em instantes."
                : plansLoadError || "Não foi possível carregar os planos agora."}
            </p>
            <button
              type="button"
              onClick={onRetryPlans}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-[6px] bg-primary/50 px-5 text-[11px] font-light text-primary-foreground outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <PlanCarousel
            plans={planOptions}
            selectedSlug={selectedPlanSlug}
            disabled={isCheckoutPlanLocked || isUpdatingCheckoutPlan}
            onSelect={onSelectPlan}
          />
        )}
        {checkoutToken ? (
          <p
            className={
              "text-[11px] font-light leading-5 " +
              (isChangingCheckoutPlan
                ? "text-primary"
                : "text-[var(--app-text-tertiary)]")
            }
          >
            {isChangingCheckoutPlan
              ? "Escolha outro plano para atualizar este checkout."
              : "Plano travado para a cobranca atual. Cancele a cobranca na coluna de pagamento para trocar."}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting || !!checkoutToken}
          className={secondaryActionClass + " disabled:cursor-not-allowed disabled:opacity-45"}
        >
          Voltar
        </button>
        <button
          type="submit"
          disabled={!canSubmitPlan}
          className="auth-primary-action h-12 flex-1 rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isUpdatingCheckoutPlan
            ? "Atualizando plano"
            : checkoutToken
            ? "Ambiente criado"
            : isSubmitting
              ? "Criando ambiente"
              : selectedPlan?.signupPath === "paid"
                ? "Criar e pagar " + selectedPlan.name
                : selectedPlan
                  ? "Iniciar teste " + selectedPlan.name
                  : "Escolha um plano"}
        </button>
      </div>

      {submitError ? (
        <p role="alert" className="text-center text-xs font-light leading-5 text-primary">
          {submitError}
        </p>
      ) : null}
    </>
  );
}
