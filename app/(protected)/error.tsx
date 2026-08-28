"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportErrorEvent } from "@/lib/api/telemetry";
import { getTechnicalErrorMessage } from "@/lib/api/vimob-error";

export default function ProtectedError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app/(protected)/error]", error);
    void reportErrorEvent({
      source: "frontend",
      severity: "error",
      category: "react_error_boundary",
      message: getTechnicalErrorMessage(error, "Protected application error boundary triggered"),
      stack: error.stack,
      component: "app/(protected)/error",
      fingerprint: error.digest || undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      browserContext: {
        pathname: window.location.pathname,
        search: window.location.search,
      },
      metadata: {
        digest: error.digest,
      },
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-lg rounded-[8px] border-0 bg-[var(--app-surface)] p-6 text-center shadow-none">
        <div className="mx-auto mb-4 flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
        </div>

        <h1 className="text-[14px] font-normal">Não foi possível carregar esta área</h1>
        <p className="mt-2 text-[12px] font-light leading-5 text-muted-foreground">
          O painel encontrou um erro inesperado. Seus dados continuam protegidos; tente recarregar a área.
        </p>

        {error.digest ? (
          <p className="mt-4 rounded-[6px] bg-muted px-3 py-2 font-mono text-[11px] font-light text-muted-foreground">
            ID do erro: {error.digest}
          </p>
        ) : null}

        <Button className="mt-6 w-full" onClick={() => unstable_retry()}>
          <RefreshCcw className="h-4 w-4" aria-hidden="true" />
          Tentar novamente
        </Button>
      </section>
    </main>
  );
}
