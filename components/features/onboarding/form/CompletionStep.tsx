import Link from "next/link";
import { SignupRecoveryActions } from "../SignupRecoveryActions";
import type { ParsedOnboardingSignupRecoveryResponse } from "@/lib/validation/onboarding";
import { CheckIcon } from "./FormFeedback";

type RecoverySuccess = Extract<
  ParsedOnboardingSignupRecoveryResponse,
  { ok: true }
>;

type CompletionStepProps = {
  companyName: string;
  email: string;
  recoveryCapability: string | null;
  onCancelled: (result: RecoverySuccess) => void;
  onCorrected: (result: RecoverySuccess) => void;
};

export function CompletionStep({
  companyName,
  email,
  recoveryCapability,
  onCancelled,
  onCorrected,
}: CompletionStepProps) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
        <CheckIcon />
      </div>
      <div className="space-y-2">
        <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
          O ambiente da{" "}
          <span className="text-[var(--app-text-primary)]">
            {companyName || "sua organização"}
          </span>{" "}
          está pronto. Enviamos um e-mail para {email || "o endereço cadastrado"}. Confirme o endereço antes de entrar no Vimob.
        </p>
      </div>
      <Link
        href="/login?emailConfirmation=required"
        className="auth-primary-action inline-flex h-12 w-full items-center justify-center rounded-[6px] text-[12px] font-light outline-none transition-colors"
      >
        Ir para login
      </Link>
      {recoveryCapability && email ? (
        <SignupRecoveryActions
          capability={recoveryCapability}
          currentEmail={email}
          onCorrected={onCorrected}
          onCancelled={onCancelled}
        />
      ) : null}
    </div>
  );
}
