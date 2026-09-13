import { maskCNPJ, maskCPF } from "@/lib/masks";
import { normalizeBrazilianTaxId } from "@/lib/validation/brazilian-tax-id";
import type {
  CountryCodeOption,
  OnboardingData,
} from "./types";

export {
  comparePlansByDisplayOrder,
  mapPublicPlan,
} from "./plan-rules";

export const initialFormData: OnboardingData = {
  documentNumber: "",
  companyName: "",
  brokersCount: "",
  adminName: "",
  adminCpf: "",
  phoneCountryCode: "+55",
  phone: "",
  email: "",
  password: "",
  signupPath: "trial",
  planSlug: "",
};

export const defaultCountryCodeOption: CountryCodeOption = {
  label: "BR +55",
  maxDigits: 11,
  placeholder: "(00) 00000-0000",
  value: "+55",
};

export const countryCodeOptions: CountryCodeOption[] = [
  defaultCountryCodeOption,
  { label: "US +1", maxDigits: 10, placeholder: "000 000 0000", value: "+1" },
  { label: "PT +351", maxDigits: 9, placeholder: "000 000 000", value: "+351" },
  { label: "AR +54", maxDigits: 10, placeholder: "00 0000 0000", value: "+54" },
  { label: "CL +56", maxDigits: 9, placeholder: "0 0000 0000", value: "+56" },
  { label: "UY +598", maxDigits: 8, placeholder: "0000 0000", value: "+598" },
  { label: "PY +595", maxDigits: 9, placeholder: "000 000 000", value: "+595" },
];

function digits(value: string, maxLength = 14) {
  return normalizeBrazilianTaxId(value).slice(0, maxLength);
}

export function formatCpfDigits(value: string) {
  return maskCPF(digits(value, 11));
}

export function formatCpfCnpj(value: string) {
  const documentDigits = digits(value);

  if (documentDigits.length <= 11) {
    return maskCPF(documentDigits);
  }

  return maskCNPJ(documentDigits);
}

export function getCountryCodeOption(value: string) {
  return (
    countryCodeOptions.find((option) => option.value === value) ??
    defaultCountryCodeOption
  );
}

function formatBrazilPhoneDigits(phoneDigits: string) {
  if (phoneDigits.length <= 2) {
    return phoneDigits;
  }

  if (phoneDigits.length <= 7) {
    return "(" + phoneDigits.slice(0, 2) + ") " + phoneDigits.slice(2);
  }

  return (
    "(" +
    phoneDigits.slice(0, 2) +
    ") " +
    phoneDigits.slice(2, 7) +
    "-" +
    phoneDigits.slice(7)
  );
}

export function formatPhoneNumber(value: string, countryCode: string) {
  const countryCodeOption = getCountryCodeOption(countryCode);
  const phoneDigits = digits(value, countryCodeOption.maxDigits);

  if (countryCodeOption.value === "+55") {
    return formatBrazilPhoneDigits(phoneDigits);
  }

  return phoneDigits;
}

export function isCnpjDocument(value: string) {
  return digits(value).length === 14;
}
