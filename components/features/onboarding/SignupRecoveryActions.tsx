"use client";

import { useState } from "react";

import {
  onboardingSignupRecoveryResponseSchema,
  type ParsedOnboardingSignupRecoveryResponse,
} from "@/lib/validation/onboarding";

type RecoverySuccess = Extract<ParsedOnboardingSignupRecoveryResponse, { ok: true }>;

type SignupRecoveryActionsProps = {
  capability: string;
  currentEmail: string;
  onCorrected: (result: RecoverySuccess) => void;
  onCancelled: (result: RecoverySuccess) => void;
};

export function SignupRecoveryActions({
  capability,
  currentEmail,
  onCorrected,
  onCancelled,
}: SignupRecoveryActionsProps) {
  const [mode, setMode] = useState<"idle" | "correct" | "cancel">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: "correct_email" | "cancel_and_restart") {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/onboarding/signup/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability,
          action,
          currentEmail,
          ...(action === "correct_email" ? { newEmail } : {}),
        }),
      });
      const parsed = onboardingSignupRecoveryResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!parsed.success) {
        setMessage("O servidor devolveu uma resposta inválida. Tente novamente.");
        return;
      }
      if (!response.ok || !parsed.data.ok) {
        setMessage(parsed.data.message);
        return;
      }
      setMessage(parsed.data.message);
      if (action === "correct_email") onCorrected(parsed.data);
      else onCancelled(parsed.data);
    } catch {
      setMessage("Não foi possível alterar o cadastro agora. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  if (mode === "correct") {
    return (
      <div className="space-y-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-left">
        <label className="block text-[12px] font-light text-[var(--app-text-secondary)]" htmlFor="signup-corrected-email">
          Novo e-mail
        </label>
        <input
          id="signup-corrected-email"
          type="email"
          autoComplete="email"
          required
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          className="auth-login-field h-11 w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-[12px] outline-none"
        />
        {message ? <p className="text-[11px] font-light text-[var(--app-text-secondary)]">{message}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("idle")}
            disabled={pending}
            className="h-10 rounded-[6px] bg-[var(--app-surface-solid)] text-[11px] font-light"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => void submit("correct_email")}
            disabled={pending || !newEmail.trim() || newEmail.trim().toLowerCase() === currentEmail.toLowerCase()}
            className="auth-primary-action h-10 rounded-[6px] text-[11px] font-light disabled:opacity-50"
          >
            {pending ? "Corrigindo..." : "Corrigir e reenviar"}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "cancel") {
    return (
      <div className="space-y-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-left">
        <p className="text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
          O ambiente recém-criado será removido. Esta opção só funciona antes da confirmação do e-mail, de qualquer pagamento e da entrada de outro membro.
        </p>
        {message ? <p className="text-[11px] font-light text-[var(--app-text-secondary)]">{message}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode("idle")} disabled={pending} className="h-10 rounded-[6px] bg-[var(--app-surface-solid)] text-[11px] font-light">
            Manter cadastro
          </button>
          <button type="button" onClick={() => void submit("cancel_and_restart")} disabled={pending} className="h-10 rounded-[6px] bg-destructive/10 text-[11px] font-light text-destructive disabled:opacity-50">
            {pending ? "Cancelando..." : "Cancelar e recomeçar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => setMode("correct")} className="h-10 rounded-[6px] bg-[var(--app-surface-soft)] text-[11px] font-light text-[var(--app-text-secondary)]">
        E-mail incorreto?
      </button>
      <button type="button" onClick={() => setMode("cancel")} className="h-10 rounded-[6px] bg-[var(--app-surface-soft)] text-[11px] font-light text-[var(--app-text-secondary)]">
        Cancelar cadastro
      </button>
    </div>
  );
}
