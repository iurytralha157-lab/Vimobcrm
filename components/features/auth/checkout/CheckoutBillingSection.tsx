"use client";

import type { RefObject } from "react";
import { ArrowRight, Check, Pencil } from "lucide-react";
import { BillingDetailsFields } from "./BillingDetailsFields";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPeriodLabel } from "@/lib/billing/checkout-domain";
import type { PaymentMethod } from "@/lib/billing/checkout-types";

type BillingDetails = {
  name: string;
  email: string;
  document: string;
  phone: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onDocumentChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPostalCodeChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onAddressNumberChange: (value: string) => void;
  onAddressComplementChange: (value: string) => void;
  onNeighborhoodChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onStateChange: (value: string) => void;
};

export type CheckoutBillingSectionProps = {
  periodSectionRef: RefObject<HTMLElement | null>;
  details: BillingDetails;
  state: {
    confirmed: boolean;
    usesStoredProfile: boolean;
    submitting: boolean;
    processingMethod: PaymentMethod | null;
    hasDirectPaymentResult: boolean;
  };
  period: {
    managingPaymentMethod: boolean;
    periods: number[];
    selectedMonths: number | null;
    canEdit: boolean;
    monthlyPrice: number;
  };
  actions: {
    onContinue: () => void;
    onEdit: () => void;
    onSelectPeriod: (period: number) => void;
  };
};

export function CheckoutBillingSection({
  periodSectionRef,
  details,
  state,
  period,
  actions,
}: CheckoutBillingSectionProps) {
  const {
    name: holderName,
    email: holderEmail,
    document: holderCpf,
    phone: holderPhone,
    postalCode: holderPostalCode,
    address: holderAddress,
    addressNumber: holderAddressNumber,
    addressComplement: holderAddressComplement,
    neighborhood: holderNeighborhood,
    city: holderCity,
    state: holderState,
    onNameChange: setHolderName,
    onEmailChange: setHolderEmail,
    onDocumentChange: setHolderCpf,
    onPhoneChange: setHolderPhone,
    onPostalCodeChange: setHolderPostalCode,
    onAddressChange: setHolderAddress,
    onAddressNumberChange: setHolderAddressNumber,
    onAddressComplementChange: setHolderAddressComplement,
    onNeighborhoodChange: setHolderNeighborhood,
    onCityChange: setHolderCity,
    onStateChange: setHolderState,
  } = details;
  const {
    confirmed: billingDetailsConfirmed,
    usesStoredProfile: usesStoredBillingProfile,
    submitting,
    processingMethod,
    hasDirectPaymentResult,
  } = state;
  const {
    managingPaymentMethod,
    periods: billingPeriods,
    selectedMonths: selectedPeriodMonths,
    canEdit: canEditCheckoutSelection,
    monthlyPrice,
  } = period;
  const {
    onContinue: handleBillingDetailsContinue,
    onEdit,
    onSelectPeriod: setSelectedPeriodMonths,
  } = actions;
  return (
        <div className="min-w-0 space-y-4">
          <form
            id="checkout-billing-form"
            className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              handleBillingDetailsContinue();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground">
                  1
                </span>
                <div>
                  <h2 className="app-section-title">Dados de faturamento</h2>
                </div>
              </div>
              {billingDetailsConfirmed &&
                  !usesStoredBillingProfile &&
                  !hasDirectPaymentResult &&
                  !processingMethod
                ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onEdit}
                    className="h-8 shrink-0 rounded-[6px] px-2.5 text-[11px] font-light text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-soft)] hover:text-primary"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Editar
                  </Button>
                )
                : null}
            </div>

            <BillingDetailsFields
              name={holderName}
              email={holderEmail}
              document={holderCpf}
              phone={holderPhone}
              postalCode={holderPostalCode}
              address={holderAddress}
              addressNumber={holderAddressNumber}
              addressComplement={holderAddressComplement}
              neighborhood={holderNeighborhood}
              city={holderCity}
              state={holderState}
              disabled={usesStoredBillingProfile ||
                billingDetailsConfirmed ||
                submitting ||
                Boolean(processingMethod) ||
                hasDirectPaymentResult}
              onNameChange={setHolderName}
              onEmailChange={setHolderEmail}
              onDocumentChange={setHolderCpf}
              onPhoneChange={setHolderPhone}
              onPostalCodeChange={setHolderPostalCode}
              onAddressChange={setHolderAddress}
              onAddressNumberChange={setHolderAddressNumber}
              onAddressComplementChange={setHolderAddressComplement}
              onNeighborhoodChange={setHolderNeighborhood}
              onCityChange={setHolderCity}
              onStateChange={setHolderState}
            />

            {billingDetailsConfirmed
              ? (
                <div className="mt-4 flex items-center gap-2 rounded-[6px] bg-emerald-500/10 px-3 py-2.5 text-[11px] font-light text-emerald-700 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {usesStoredBillingProfile
                    ? "Dados protegidos e conferidos. As informações sensíveis permanecem mascaradas."
                    : "Dados conferidos. Escolha o período para continuar."}
                </div>
              )
              : (
                <Button
                  type="submit"
                  className="mt-5 h-10 rounded-[6px] bg-primary/50 px-5 text-[12px] font-light hover:bg-primary focus-visible:bg-primary"
                >
                  Continuar para o período
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              )}
          </form>

          {!managingPaymentMethod
            ? (
              <section
                ref={periodSectionRef}
                className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground">
                    2
                  </span>
                  <div>
                    <h2 className="app-section-title">Escolha o período</h2>
                  </div>
                </div>

                {billingPeriods.length > 0
                  ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      {billingPeriods.map((period) => {
                        const selected = selectedPeriodMonths === period;

                        return (
                          <button
                            key={period}
                            type="button"
                            aria-pressed={selected}
                            disabled={!canEditCheckoutSelection}
                            onClick={() => setSelectedPeriodMonths(period)}
                            className={`group rounded-[6px] border-0 p-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-[var(--app-surface-soft)] hover:bg-primary hover:text-primary-foreground"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-light">
                                {formatPeriodLabel(period)}
                              </span>
                              <span
                                className={`flex h-4 w-4 items-center justify-center rounded-[4px] ${
                                  selected
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "bg-[var(--app-surface-solid)] text-transparent group-hover:bg-primary-foreground/20"
                                }`}
                              >
                                {selected
                                  ? (
                                    <Check
                                      className="h-3 w-3"
                                      aria-hidden="true"
                                    />
                                  )
                                  : null}
                              </span>
                            </span>
                            <span
                              className={`mt-1.5 block text-[11px] font-light ${
                                selected
                                  ? "text-primary-foreground/80"
                                  : "text-[var(--app-text-tertiary)] group-hover:text-primary-foreground/75"
                              }`}
                            >
                              {formatCurrency(monthlyPrice * period)} no período
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )
                  : (
                    <div className="mt-4 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300">
                      Os períodos deste plano ainda não foram configurados.
                      Atualize o catálogo antes de cobrar.
                    </div>
                  )}
              </section>
            )
            : null}
        </div>
  );
}
