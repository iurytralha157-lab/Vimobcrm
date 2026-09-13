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
  if (code === "signup_email_exists") {
    return "Este e-mail já está cadastrado. Faça login ou use outro e-mail.";
  }
  if (code === "signup_document_exists") {
    return "Já existe uma organização cadastrada com este CPF ou CNPJ.";
  }
  if (code === "signup_attempt_conflict") {
    return "A tentativa anterior estava vinculada a outro e-mail. Reiniciamos com segurança; tente novamente.";
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
    return "Este e-mail ja esta cadastrado. Faca login ou use outro e-mail.";
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
