"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSetupGuide, type SetupStep } from "@/hooks/use-setup-guide";

const SECTION_COLORS: Record<string, string> = {
  "Primeiros passos": "bg-[#FF4529] text-white",
  CRM: "bg-sky-500 text-white",
  Atendimento: "bg-emerald-500 text-white",
  Rotina: "bg-violet-500 text-white",
  Conta: "bg-zinc-500 text-white",
  Integrações: "bg-blue-500 text-white",
  Gestão: "bg-amber-500 text-white",
  Imóveis: "bg-teal-500 text-white",
  Avançado: "bg-indigo-500 text-white",
  Performance: "bg-fuchsia-500 text-white",
};

export function SetupGuideDialog() {
  const router = useRouter();
  const {
    dismiss,
    markComplete,
    markIncomplete,
    open,
    progress,
    restart,
    setActiveStepId,
    setOpen,
    steps,
  } = useSetupGuide();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (steps.length === 0) return undefined;
    return steps.find((step) => step.id === selectedId) || steps[0];
  }, [selectedId, steps]);

  if (steps.length === 0 || !selected) return null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    dismiss();
  };

  const openStep = (step: SetupStep) => {
    setActiveStepId(step.id);
    setOpen(false);
    const separator = step.route.includes("?") ? "&" : "?";
    router.push(`${step.route}${separator}setupGuide=${step.id}`);
  };

  const currentCompleted = !!progress[selected.id];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid h-[min(680px,calc(100dvh-32px))] w-[min(900px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:rounded-[14px] [&>button]:top-4">
        <DialogTitle className="sr-only">Guia de configuração</DialogTitle>
        <DialogDescription className="sr-only">
          Guia inicial para entender e configurar as principais áreas do Vimob CRM.
        </DialogDescription>

        <header className="border-b border-[var(--app-border)] px-5 py-4 pr-14">
          <div className="flex items-center">
            <div className="min-w-0">
              <p className="text-sm font-light tracking-normal text-[var(--app-text-primary)]">
                Guia de configuração
              </p>
              <h2 className="sr-only">
                Guia de configuraÃ§Ã£o
              </h2>
              <p className="sr-only">
                Guia inicial do Vimob CRM.
              </p>
            </div>
            <div className="hidden" aria-hidden="true" />
          </div>
          <div className="hidden" aria-hidden="true" />
        </header>

        <div className="grid min-h-0 md:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] md:border-b-0 md:border-r">
            <div className="scrollbar-thin h-full space-y-2 overflow-y-auto p-3">
              {steps.map((step, index) => (
                <GuideStepButton
                  key={step.id}
                  completed={!!progress[step.id]}
                  index={index}
                  selected={selected.id === step.id}
                  step={step}
                  onSelect={() => setSelectedId(step.id)}
                />
              ))}
            </div>
          </aside>

          <section className="scrollbar-thin min-h-0 overflow-y-auto">
            <article className="space-y-5 p-5 font-extralight md:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-light tracking-normal text-[var(--app-text-primary)]">
                      {selected.title}
                    </h3>
                    <Badge className={cn("border-0 px-2 py-0.5 text-[10px] font-extralight", SECTION_COLORS[selected.section] || "bg-zinc-500 text-white")}>
                      {selected.badge}
                    </Badge>
                    {currentCompleted ? (
                      <Badge className="border-0 bg-emerald-500 px-2 py-0.5 text-[10px] font-extralight text-white">
                        Concluído
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs font-extralight text-[var(--app-text-secondary)]">
                    {selected.section} · {selected.audience}
                  </p>
                </div>

                <Button
                  type="button"
                  className="h-9 shrink-0 rounded-[8px] bg-[#FF4529] px-4 text-sm font-light text-white hover:bg-[#FF4529]/90"
                  onClick={() => openStep(selected)}
                >
                  {selected.ctaLabel}
                </Button>
              </div>

              <p className="text-sm font-extralight leading-7 text-[var(--app-text-secondary)]">
                {selected.description}
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[8px] bg-[var(--app-surface)] p-4">
                  <p className="text-sm font-light text-[var(--app-text-primary)]">O que essa área faz</p>
                  <div className="mt-3 space-y-3">
                    {selected.details.map((detail) => (
                      <p key={detail} className="text-sm font-extralight leading-6 text-[var(--app-text-secondary)]">
                        {detail}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-[8px] bg-[var(--app-surface)] p-4">
                  <p className="text-sm font-light text-[var(--app-text-primary)]">Como configurar ou usar</p>
                  <ol className="mt-3 space-y-3">
                    {selected.checklist.map((item, index) => (
                      <li key={item} className="flex gap-3 text-sm font-extralight leading-6 text-[var(--app-text-secondary)]">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--app-surface-soft)] text-[10px] text-[var(--app-text-primary)]">
                          {index + 1}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-[var(--app-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-[8px] border-0 bg-[var(--app-surface-soft)] text-sm font-light"
                    onClick={() => currentCompleted ? markIncomplete(selected.id) : markComplete(selected.id)}
                  >
                    {currentCompleted ? "Marcar pendente" : "Marcar concluído"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-[8px] border-0 bg-[var(--app-surface-soft)] text-sm font-light"
                    onClick={restart}
                  >
                    Reiniciar guia
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 rounded-[8px] px-3 text-sm font-light text-[var(--app-text-secondary)]"
                  onClick={dismiss}
                >
                  Não mostrar automaticamente
                </Button>
              </div>
            </article>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GuideStepButton({
  completed,
  index,
  onSelect,
  selected,
  step,
}: {
  completed: boolean;
  index: number;
  onSelect: () => void;
  selected: boolean;
  step: SetupStep;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 rounded-[8px] border border-transparent p-3 text-left transition-colors",
        selected
          ? "border-[#FF4529]/35 bg-[var(--app-surface-solid)]"
          : "hover:bg-[var(--app-surface-hover)]",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-light",
          completed ? "bg-emerald-500 text-white" : "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]",
        )}
      >
        {completed ? "✓" : index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-light text-[var(--app-text-primary)]">{step.title}</span>
          <Badge className={cn("shrink-0 border-0 px-2 py-0 text-[10px] font-extralight", SECTION_COLORS[step.section] || "bg-zinc-500 text-white")}>
            {step.badge}
          </Badge>
        </span>
        <span className="mt-1 block truncate text-xs font-extralight text-[var(--app-text-secondary)]">{step.subtitle}</span>
      </span>
    </button>
  );
}
