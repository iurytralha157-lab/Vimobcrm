import {
  evaluatePasswordPolicy,
  PASSWORD_POLICY,
} from "@/lib/validation/password";
import {
  ChevronDownIcon,
  EnvelopeIcon,
  EyeIcon,
  InlineFieldError,
  LegalConsentText,
} from "./FormFeedback";
import {
  countryCodeOptions,
  formatCpfDigits,
  formatPhoneNumber,
  getCountryCodeOption,
} from "./model";
import {
  getFieldDescription,
  getFieldInputClass,
  labelClass,
  secondaryActionClass,
} from "./styles";
import type { OnboardingData, SignupFieldErrors } from "./types";

type AccessStepProps = {
  acceptedLegal: boolean;
  fieldErrors: SignupFieldErrors;
  formData: OnboardingData;
  isOrganizationCnpj: boolean;
  isRetryingAttemptEmail: boolean;
  isSubmitting: boolean;
  isValidatingStep: boolean;
  showPassword: boolean;
  submitError: string | null;
  onBack: () => void;
  onLegalChange: (checked: boolean) => void;
  onPhoneCountryCodeChange: (countryCode: string) => void;
  onTogglePassword: () => void;
  onUpdateField: (field: keyof OnboardingData, value: string) => void;
};

export function AccessStep({
  acceptedLegal,
  fieldErrors,
  formData,
  isOrganizationCnpj,
  isRetryingAttemptEmail,
  isSubmitting,
  isValidatingStep,
  showPassword,
  submitError,
  onBack,
  onLegalChange,
  onPhoneCountryCodeChange,
  onTogglePassword,
  onUpdateField,
}: AccessStepProps) {
  const passwordRules = evaluatePasswordPolicy(formData.password);
  const selectedCountryCodeOption = getCountryCodeOption(
    formData.phoneCountryCode,
  );

  return (
    <>
      <div className="space-y-2">
        <label
          htmlFor="adminName"
          className={labelClass}
        >
          Nome completo do gestor
        </label>
        <input
          id="adminName"
          name="adminName"
          type="text"
          required
          disabled={isValidatingStep}
          aria-invalid={Boolean(fieldErrors.adminName) || undefined}
          aria-describedby={getFieldDescription(fieldErrors, "adminName")}
          placeholder="Nome do gestor administrador"
          value={formData.adminName}
          onChange={(event) =>
            onUpdateField("adminName", event.target.value)
          }
          className={getFieldInputClass(fieldErrors, "adminName")}
        />
        <InlineFieldError field="adminName" message={fieldErrors.adminName} />
      </div>

      {isOrganizationCnpj ? (
        <div className="space-y-2">
          <label
            htmlFor="adminCpf"
            className={labelClass}
          >
            CPF do gestor
          </label>
          <input
            id="adminCpf"
            name="adminCpf"
            type="text"
            inputMode="numeric"
            maxLength={14}
            required
            disabled={isValidatingStep}
            aria-invalid={Boolean(fieldErrors.adminCpf) || undefined}
            aria-describedby={getFieldDescription(fieldErrors, "adminCpf")}
            placeholder="000.000.000-00"
            value={formData.adminCpf}
            onChange={(event) =>
              onUpdateField(
                "adminCpf",
                formatCpfDigits(event.target.value),
              )
            }
            className={getFieldInputClass(fieldErrors, "adminCpf")}
          />
          <InlineFieldError field="adminCpf" message={fieldErrors.adminCpf} />
        </div>
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="phone"
          className={labelClass}
        >
          WhatsApp
        </label>
        <div className={fieldErrors.phone ? "flex h-12 overflow-hidden rounded-[6px] bg-[var(--app-surface-solid)] ring-1 ring-primary/50" : "flex h-12 overflow-hidden rounded-[6px] bg-[var(--app-surface-solid)] focus-within:ring-1 focus-within:ring-primary/40"}>
          <div className="relative w-[112px] shrink-0 border-r border-[var(--app-border)]">
            <select
              name="phoneCountryCode"
              value={formData.phoneCountryCode}
              disabled={isValidatingStep}
              onChange={(event) =>
                onPhoneCountryCodeChange(event.target.value)
              }
              aria-label="Código do país"
              className="auth-login-field h-12 w-full appearance-none bg-[var(--app-surface-solid)] pl-4 pr-8 text-base text-[var(--app-text-primary)] outline-none sm:text-sm"
            >
              {countryCodeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--app-text-tertiary)]">
              <ChevronDownIcon />
            </span>
          </div>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            maxLength={
              selectedCountryCodeOption.value === "+55"
                ? 15
                : selectedCountryCodeOption.maxDigits
            }
            required
            disabled={isValidatingStep}
            aria-invalid={Boolean(fieldErrors.phone) || undefined}
            aria-describedby={getFieldDescription(fieldErrors, "phone")}
            placeholder={selectedCountryCodeOption.placeholder}
            value={formData.phone}
            onChange={(event) =>
              onUpdateField(
                "phone",
                formatPhoneNumber(
                  event.target.value,
                  formData.phoneCountryCode,
                ),
              )
            }
            className="auth-login-field h-12 min-w-0 flex-1 bg-[var(--app-surface-solid)] px-4 text-base text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] outline-none sm:text-sm"
          />
        </div>
        <InlineFieldError field="phone" message={fieldErrors.phone} />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="email"
          className={labelClass}
        >
          E-mail de acesso
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <EnvelopeIcon />
          </span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={isValidatingStep}
            aria-invalid={Boolean(fieldErrors.email) || undefined}
            aria-describedby={getFieldDescription(fieldErrors, "email")}
            placeholder="seu@email.com"
            value={formData.email}
            onChange={(event) =>
              onUpdateField("email", event.target.value)
            }
            className={getFieldInputClass(fieldErrors, "email", "pl-11")}
          />
        </div>
        <InlineFieldError field="email" message={fieldErrors.email} />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className={labelClass}
        >
          Crie sua senha
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={PASSWORD_POLICY.minLength}
            maxLength={PASSWORD_POLICY.maxLength}
            disabled={isValidatingStep}
            aria-invalid={Boolean(fieldErrors.password) || undefined}
            aria-describedby={
              [
                getFieldDescription(fieldErrors, "password"),
                "password-requirements",
                isRetryingAttemptEmail ? "password-retry-help" : undefined,
              ]
                .filter(Boolean)
                .join(" ")
            }
            placeholder="Mínimo 8 caracteres"
            value={formData.password}
            onChange={(event) =>
              onUpdateField("password", event.target.value)
            }
            className={getFieldInputClass(fieldErrors, "password", "pr-12")}
          />
          <button
            type="button"
            onClick={onTogglePassword}
            className="absolute inset-y-0 right-0 flex items-center px-4 text-[var(--app-text-tertiary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:text-[var(--app-text-primary)]"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
          >
            <EyeIcon open={showPassword} />
          </button>
        </div>
        <InlineFieldError field="password" message={fieldErrors.password} />
        {isRetryingAttemptEmail ? (
          <p
            id="password-retry-help"
            className="text-[11px] font-light leading-5 text-[var(--app-text-secondary)]"
          >
            Para retomar o cadastro com segurança, use a mesma senha informada no primeiro envio.
          </p>
        ) : null}
        <div
          id="password-requirements"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] font-light"
        >
          {passwordRules.map((rule) => (
            <span
              key={rule.id}
              className={
                "inline-flex items-center gap-1 whitespace-nowrap " +
                (rule.isValid
                  ? "text-primary"
                  : "text-[var(--app-text-tertiary)]")
              }
            >
              <span
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (rule.isValid
                    ? "bg-primary"
                    : "bg-[var(--app-border-strong)]")
                }
                aria-hidden="true"
              />
              {rule.label}
              <span className="sr-only">
                {rule.isValid ? ": requisito atendido" : ": requisito pendente"}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting || isValidatingStep}
          className={secondaryActionClass}
        >
          Voltar
        </button>
        <button
          type="submit"
          disabled={isSubmitting || isValidatingStep}
          className="auth-primary-action h-12 flex-1 rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isValidatingStep ? "Verificando..." : "Continuar"}
        </button>
      </div>

      {submitError ? (
        <p role="alert" className="text-center text-xs font-light leading-5 text-primary">
          {submitError}
        </p>
      ) : null}

      <LegalConsentText
        checked={acceptedLegal}
        disabled={isValidatingStep}
        invalid={Boolean(fieldErrors.legal)}
        onCheckedChange={onLegalChange}
      />
      <InlineFieldError field="legal" message={fieldErrors.legal} />
    </>
  );
}
