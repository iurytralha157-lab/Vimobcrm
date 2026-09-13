import {
  onboardingStepValidationResponseSchema,
} from "@/lib/validation/onboarding";
import type { StepValidationResult } from "./types";

export {
  collectStepFieldErrors,
  translateSignupMessage,
} from "./validation-rules";

export async function requestStepValidation(
  body: unknown,
): Promise<StepValidationResult> {
  const response = await fetch("/api/onboarding/validate-step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = onboardingStepValidationResponseSchema.safeParse(
    await response.json().catch(() => null),
  );

  if (!parsed.success) {
    throw new Error("O servidor devolveu uma resposta de validação inválida.");
  }

  return { response, result: parsed.data };
}
