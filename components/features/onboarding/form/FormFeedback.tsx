import Link from "next/link";
import type { OnboardingStep } from "./types";
import type { SignupFieldErrorKey } from "./validation-rules";

export function InlineFieldError({
  field,
  message,
}: {
  field: SignupFieldErrorKey;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p id={field + "-error"} className="text-[12px] font-light leading-[15px] text-primary">
      {message}
    </p>
  );
}

export function EnvelopeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.75"
      className="text-[var(--app-text-tertiary)]"
      aria-hidden="true"
    >
      <rect x="1.5" y="3.5" width="13" height="9" />
      <path d="M1.5 4.5L8 9.5L14.5 4.5" />
    </svg>
  );
}

export function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        aria-hidden="true"
      >
        <path d="M1.5 8C1.5 8 3.5 3.5 8 3.5C12.5 3.5 14.5 8 14.5 8C14.5 8 12.5 12.5 8 12.5C3.5 12.5 1.5 8 1.5 8Z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    );
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden="true"
    >
      <path d="M2 2L14 14" />
      <path d="M6.5 6.5C6 7 5.75 7.5 5.75 8C5.75 9.25 6.75 10.25 8 10.25C8.5 10.25 9 10 9.5 9.5" />
      <path d="M1.5 8C1.5 8 3.5 3.5 8 3.5C9.25 3.5 10.35 3.85 11.25 4.4M14.5 8C14.5 8 12.5 12.5 8 12.5C7.15 12.5 6.35 12.3 5.65 11.95" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4.5 11.5L8.75 15.75L17.5 6.25" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M3.25 5L6.5 8.25L9.75 5" />
    </svg>
  );
}

export function StepIndicator({
  step,
  compact = false,
}: {
  step: OnboardingStep;
  compact?: boolean;
}) {
  const steps = [1, 2, 3] as const;
  const currentStep = Math.min(step, 3);

  return (
    <div
      className={compact ? "mb-2" : "mb-5"}
      role="progressbar"
      aria-label="Progresso do cadastro"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={currentStep}
      aria-valuetext={"Etapa " + currentStep + " de 3"}
    >
      <div className="grid grid-cols-3 gap-2">
        {steps.map((item) => (
          <span
            key={item}
            className={item <= currentStep ? "h-px bg-primary" : "h-px bg-[var(--app-border)]"}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

export function LegalConsentText({
  checked,
  disabled,
  invalid,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="auth-signup-legal mx-auto flex max-w-[360px] items-start gap-3 text-left">
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          id="legal-consent"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "legal-error" : undefined}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="peer absolute inset-0 z-10 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          className={
            invalid
              ? "h-4 w-4 rounded-[4px] border border-primary transition-colors peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30"
              : "h-4 w-4 rounded-[4px] border border-[var(--app-border-strong)] transition-colors peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30"
          }
        />
        <span className="pointer-events-none absolute hidden h-2 w-2 rounded-[2px] bg-primary peer-checked:block" />
      </span>
      <label
        htmlFor="legal-consent"
        className="text-[11px] leading-[17px] text-[var(--app-text-tertiary)]"
      >
      Ao me cadastrar, eu aceito os{" "}
      <Link
        href="/termos-de-uso"
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className="text-primary outline-none transition-opacity hover:opacity-80"
      >
        Termos de Uso
      </Link>{' '}

      e{" "}
      <Link
        href="/politica-de-privacidade"
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className="text-primary outline-none transition-opacity hover:opacity-80"
      >
        Política de Privacidade
      </Link>{' '}

      da Vimob CRM.
      </label>
    </div>
  );
}
