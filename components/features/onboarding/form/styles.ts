import type { SignupFieldErrorKey, SignupFieldErrors } from "./types";

export const inputClass =
  "auth-login-field h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-4 text-base text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] outline-none ring-0 transition-colors sm:text-sm focus:bg-[var(--app-surface-solid)] focus:ring-1 focus:ring-primary/40";

export const labelClass =
  "block text-[13px] font-light text-[var(--app-text-primary)]";

export const secondaryActionClass =
  "h-12 w-[36%] rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light text-[var(--app-text-secondary)] outline-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/40";

export function getFieldInputClass(
  fieldErrors: SignupFieldErrors,
  field: SignupFieldErrorKey,
  extra = "",
) {
  return [inputClass, extra, fieldErrors[field] ? "ring-1 ring-primary/50" : ""]
    .filter(Boolean)
    .join(" ");
}

export function getFieldDescription(
  fieldErrors: SignupFieldErrors,
  field: SignupFieldErrorKey,
) {
  return fieldErrors[field] ? field + "-error" : undefined;
}
