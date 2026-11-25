export const signupFieldErrorKeys = [
  "documentNumber",
  "companyName",
  "brokersCount",
  "adminName",
  "adminCpf",
  "phone",
  "email",
  "password",
  "legal",
] as const;

export type SignupFieldErrorKey = (typeof signupFieldErrorKeys)[number];

export type SignupFieldErrors = Partial<Record<SignupFieldErrorKey, string>>;

const signupFieldErrorKeySet = new Set<SignupFieldErrorKey>(
  signupFieldErrorKeys,
);

export function translateSignupMessage(message?: string, code?: string) {
  if (code === "signup_conflict" || code === "signup_email_exists" ||
    code === "signup_document_exists" || code === "signup_attempt_conflict") {
    return "Não foi possível concluir o cadastro com os dados informados. Revise os dados ou, se já tem acesso ao Vimob, faça login ou recupere sua senha.";
  }
  if (code === "signup_rate_limited") {
    return "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";
  }

  const normalized = (message || "").toLowerCase();

  if (
    normalized.includes("already been registered") ||
    normalized.includes("already registered") ||
    normalized.includes("user already exists")
  ) {
    return "Não foi possível concluir o cadastro com os dados informados.";
  }

  return message || "Não foi possível concluir o cadastro.";
}

export function collectStepFieldErrors(
  issues: readonly { message: string; path: readonly PropertyKey[] }[],
): SignupFieldErrors {
  const errors: SignupFieldErrors = {};

  for (const issue of issues) {
    const rawField = issue.path[0] === "legalAccepted" ? "legal" : issue.path[0];
    if (
      typeof rawField !== "string" ||
      !signupFieldErrorKeySet.has(rawField as SignupFieldErrorKey)
    ) {
      continue;
    }
    const field = rawField as SignupFieldErrorKey;
    if (!errors[field]) errors[field] = issue.message;
  }

  return errors;
}
