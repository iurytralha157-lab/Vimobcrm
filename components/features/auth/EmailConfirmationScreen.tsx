"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VimobLoader } from "@/components/shared/loading";
import { getValidatedEmailConfirmationURL } from "@/lib/auth/email-confirmation-link";

type ConfirmationState = "checking" | "ready" | "invalid";

export function EmailConfirmationScreen() {
  const [state, setState] = useState<ConfirmationState>("checking");
  const [confirmationURL, setConfirmationURL] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    const validatedURL = getValidatedEmailConfirmationURL(
      window.location.hash,
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      window.location.origin,
    );

    // The single-use credential lives only in memory after this point. It is
    // never copied to server logs, browser history or storage.
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    const updateFrame = window.requestAnimationFrame(() => {
      if (!validatedURL) {
        setState("invalid");
        return;
      }

      setConfirmationURL(validatedURL);
      setState("ready");
    });

    return () => window.cancelAnimationFrame(updateFrame);
  }, []);

  function confirmEmail() {
    if (!confirmationURL || isConfirming) return;
    setIsConfirming(true);
    window.location.assign(confirmationURL);
  }

  return (
    <div className="w-full max-w-[400px] text-left">
      <header className="mb-8 lg:mb-10">
        <h1 className="text-[20px] font-normal text-[var(--app-text-primary)]">
          Confirmar e-mail
        </h1>
        <p className="mt-1.5 text-[12px] font-light text-[var(--app-text-tertiary)]">
          Proteção da sua conta Vimob
        </p>
      </header>

      {state === "checking" ? (
        <div className="flex min-h-36 items-center justify-center">
          <VimobLoader size="sm" label="Validando link seguro..." />
        </div>
      ) : state === "ready" ? (
        <div className="space-y-6">
          <p className="text-[13px] font-light leading-6 text-[var(--app-text-secondary)]">
            Clique no botão abaixo para confirmar que este e-mail pertence a você. O acesso só será liberado depois dessa confirmação.
          </p>
          <button
            type="button"
            onClick={confirmEmail}
            disabled={isConfirming}
            className="auth-primary-action h-12 w-full rounded-[6px] text-[12px] font-light outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isConfirming ? "Confirmando..." : "Confirmar meu e-mail"}
          </button>
          <p className="text-center text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
            Esta segunda ação impede que ferramentas automáticas de segurança consumam sua confirmação antes de você.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-[13px] font-light leading-6 text-[var(--app-text-secondary)]">
            Este link é inválido, foi alterado ou expirou. Use o link original recebido no e-mail de cadastro.
          </p>
          <Link
            href="/login?emailConfirmation=required"
            className="auth-primary-action inline-flex h-12 w-full items-center justify-center rounded-[6px] text-[12px] font-light outline-none transition-colors"
          >
            Ir para login
          </Link>
        </div>
      )}
    </div>
  );
}

export default EmailConfirmationScreen;
