"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportErrorEvent } from "@/lib/api/telemetry";

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
      message: error.message || "Protected application error boundary triggered",
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
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg rounded-lg border border-white/10 bg-[var(--app-surface)] p-6 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Não foi possível carregar esta área</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          O painel encontrou um erro inesperado. Seus dados continuam protegidos; tente recarregar a area.
        </p>

        {error.digest ? (
          <p className="mt-4 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
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
