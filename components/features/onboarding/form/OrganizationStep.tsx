import { InlineFieldError } from "./FormFeedback";
import { formatCpfCnpj } from "./model";
import {
  getFieldDescription,
  getFieldInputClass,
  labelClass,
} from "./styles";
import type { OnboardingData, SignupFieldErrors } from "./types";

type OrganizationStepProps = {
  formData: OnboardingData;
  fieldErrors: SignupFieldErrors;
  isValidatingStep: boolean;
  submitError: string | null;
  onUpdateField: (field: keyof OnboardingData, value: string) => void;
};

export function OrganizationStep({
  formData,
  fieldErrors,
  isValidatingStep,
  submitError,
  onUpdateField,
}: OrganizationStepProps) {
  return (
    <>
      <div className="space-y-2">
        <label
          htmlFor="documentNumber"
          className={labelClass}
        >
          CPF/CNPJ
        </label>
        <input
          id="documentNumber"
          name="documentNumber"
          type="text"
          inputMode="numeric"
          maxLength={18}
          pattern="(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})"
          required
          disabled={isValidatingStep}
          aria-invalid={Boolean(fieldErrors.documentNumber) || undefined}
          aria-describedby={getFieldDescription(fieldErrors, "documentNumber")}
          title="Informe um CPF com 11 números ou CNPJ com 14 números."
          placeholder="CPF ou CNPJ"
          value={formData.documentNumber}
          onChange={(event) =>
            onUpdateField(
              "documentNumber",
              formatCpfCnpj(event.target.value),
            )
          }
          className={getFieldInputClass(fieldErrors, "documentNumber")}
        />
        <InlineFieldError field="documentNumber" message={fieldErrors.documentNumber} />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="companyName"
          className={labelClass}
        >
          Nome da imobiliária
        </label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          required
          disabled={isValidatingStep}
          aria-invalid={Boolean(fieldErrors.companyName) || undefined}
          aria-describedby={getFieldDescription(fieldErrors, "companyName")}
          placeholder="Ex: Machado Imóveis"
          value={formData.companyName}
          onChange={(event) =>
            onUpdateField("companyName", event.target.value)
          }
          className={getFieldInputClass(fieldErrors, "companyName")}
        />
        <InlineFieldError field="companyName" message={fieldErrors.companyName} />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="brokersCount"
          className={labelClass}
        >
          Quantidade de corretores
        </label>
        <input
          id="brokersCount"
          name="brokersCount"
          type="number"
          min="1"
          max="500"
          required
          disabled={isValidatingStep}
          aria-invalid={Boolean(fieldErrors.brokersCount) || undefined}
          aria-describedby={getFieldDescription(fieldErrors, "brokersCount")}
          placeholder="Ex: 25"
          value={formData.brokersCount}
          onChange={(event) =>
            onUpdateField("brokersCount", event.target.value)
          }
          className={getFieldInputClass(fieldErrors, "brokersCount")}
        />
        <InlineFieldError field="brokersCount" message={fieldErrors.brokersCount} />
      </div>

      <button
        type="submit"
        disabled={isValidatingStep}
        className="auth-primary-action h-12 w-full rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isValidatingStep ? "Verificando..." : "Continuar"}
      </button>

      {submitError ? (
        <p role="alert" className="text-center text-[12px] font-light leading-[15px] text-primary">
          {submitError}
        </p>
      ) : null}
    </>
  );
}
