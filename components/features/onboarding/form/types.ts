import type {
  ParsedOnboardingSignupResponse,
  ParsedOnboardingStepValidationResponse,
} from "@/lib/validation/onboarding";

export type {
  OnboardingPlanOption,
  PublicPlan,
  PublicPlansResponse,
} from "./plan-rules";
export type {
  SignupFieldErrorKey,
  SignupFieldErrors,
} from "./validation-rules";

export type OnboardingStep = 1 | 2 | 3 | 4;

export type OnboardingData = {
  documentNumber: string;
  companyName: string;
  brokersCount: string;
  adminName: string;
  adminCpf: string;
  phoneCountryCode: string;
  phone: string;
  email: string;
  password: string;
  signupPath: "trial" | "paid";
  planSlug: string;
};

export type CountryCodeOption = {
  label: string;
  maxDigits: number;
  placeholder: string;
  value: string;
};

export type SignupResponse = ParsedOnboardingSignupResponse;

export type CheckoutPlanChangeResponse = {
  ok: boolean;
  message: string;
  requiresPayment?: boolean;
  checkoutToken?: string | null;
  organizationId?: string;
};

export type PlansLoadState = "idle" | "loading" | "ready" | "empty" | "error";

export type StepValidationResult = {
  response: Response;
  result: ParsedOnboardingStepValidationResponse;
};
