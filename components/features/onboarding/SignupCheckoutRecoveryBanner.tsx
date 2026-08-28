"use client";

import { useEffect, useState } from "react";

import {
  applyPublicSignupEmailCorrection,
  clearPublicSignupAttempt,
  readPublicSignupCompletion,
  type StoredPublicSignupCompletion,
} from "@/lib/onboarding/signup-attempt";
import { SignupRecoveryActions } from "./SignupRecoveryActions";

export function SignupCheckoutRecoveryBanner({ checkoutToken }: { checkoutToken: string }) {
  const [completion, setCompletion] = useState<StoredPublicSignupCompletion | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readPublicSignupCompletion(window.sessionStorage);
      if (!stored?.requiresPayment || stored.checkoutToken !== checkoutToken || !stored.recoveryCapability) return;
      setCompletion(stored);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [checkoutToken]);

  if (!completion?.recoveryCapability) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-4 md:flex-row md:items-center md:justify-between md:gap-6">
      <p className="min-w-0 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
        Antes de pagar, confira o e-mail <span className="text-[var(--app-text-primary)]">{completion.email}</span>. A correção invalida este link e abre um checkout novo com segurança.
      </p>
      <div className="w-full shrink-0 md:w-[320px]">
        <SignupRecoveryActions
          capability={completion.recoveryCapability}
          currentEmail={completion.email}
          onCorrected={(result) => {
            try {
              applyPublicSignupEmailCorrection(window.sessionStorage, result);
            } finally {
              window.location.replace(result.redirectTo);
            }
          }}
          onCancelled={(result) => {
            try {
              clearPublicSignupAttempt(window.sessionStorage);
            } finally {
              window.location.replace(result.redirectTo);
            }
          }}
        />
      </div>
    </div>
  );
}
