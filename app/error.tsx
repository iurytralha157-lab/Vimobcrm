"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportErrorEvent } from "@/lib/api/telemetry";
import { getTechnicalErrorMessage } from "@/lib/api/vimob-error";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
    void reportErrorEvent({
      source: "frontend",
      severity: "error",
      category: "react_error_boundary",
      message: getTechnicalErrorMessage(error, "Application error boundary triggered"),
      stack: error.stack,
      component: "app/error",
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
      <section className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-6 text-center shadow-none">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>

        <h1 className="text-[14px] font-normal">Algo deu errado</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Não foi possível carregar esta parte do Vimob. Tente novamente em alguns instantes.
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
