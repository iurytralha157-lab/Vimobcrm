"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Circle, Play, RotateCcw } from "lucide-react";

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
  Financeiro: "bg-cyan-600 text-white",
};

export function SetupGuideDialog() {
  const router = useRouter();
  const {
    completedCount,
    dismiss,
    guideReady,
    markComplete,
    markIncomplete,
    open,
    percent,
    progress,
    restart,
    setActiveStepId,
    setOpen,
    steps,
    totalCount,
  } = useSetupGuide();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (steps.length === 0) return undefined;
    return (
      steps.find((step) => step.id === selectedId) ||
      steps.find((step) => !progress[step.id]) ||
      steps[0]
    );
  }, [progress, selectedId, steps]);

  if (!guideReady || steps.length === 0 || !selected) return null;

  const selectedIndex = steps.findIndex((step) => step.id === selected.id);
  const previousStep = selectedIndex > 0 ? steps[selectedIndex - 1] : undefined;
  const nextStep = selectedIndex < steps.length - 1 ? steps[selectedIndex + 1] : undefined;
  const currentCompleted = !!progress[selected.id];

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
  };

  const openStep = (step: SetupStep) => {
    setActiveStepId(step.id);
    setSelectedId(null);
    setOpen(false);
    const separator = step.route.includes("?") ? "&" : "?";
    router.push(`${step.route}${separator}setupGuide=${step.id}`);
  };

  const completeAndAdvance = () => {
    markComplete(selected.id);
    if (nextStep) setSelectedId(nextStep.id);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid h-[min(720px,calc(100dvh-24px))] w-[min(980px,calc(100vw-24px))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:rounded-[10px] [&>button]:top-4">
        <DialogTitle className="sr-only">Guia de configuração</DialogTitle>
        <DialogDescription className="sr-only">
          Guia prático e personalizado para configurar e usar as áreas disponíveis no Vimob CRM.
        </DialogDescription>

        <header className="border-b border-[var(--app-border)] px-5 py-4 pr-14">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-light text-[var(--app-text-primary)]">
                Guia de configuração
              </p>
              <p className="mt-1 text-xs font-extralight text-[var(--app-text-secondary)]">
                {completedCount} de {totalCount} etapas concluídas
              </p>
            </div>
            <span className="text-xs font-light text-[var(--app-text-secondary)]">{percent}%</span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-[2px] bg-[var(--app-surface-soft)]">
            <div
              className="h-full bg-[#FF4529] transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </header>

        <div className="grid min-h-0 grid-rows-[minmax(0,210px)_minmax(0,1fr)] md:grid-cols-[306px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="min-h-0 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] md:border-b-0 md:border-r">
            <div className="scrollbar-hidden h-full overflow-y-auto overscroll-contain p-3">
              {steps.map((step, index) => {
                const startsSection = index === 0 || steps[index - 1]?.section !== step.section;
                return (
                  <div key={step.id} className={startsSection && index > 0 ? "mt-4" : undefined}>
                    {startsSection ? (
                      <p className="mb-1.5 px-2 text-[10px] font-light uppercase text-[var(--app-text-tertiary)]">
                        {step.section}
                      </p>
                    ) : null}
                    <GuideStepButton
                      completed={!!progress[step.id]}
                      index={index}
                      selected={selected.id === step.id}
                      step={step}
                      onSelect={() => setSelectedId(step.id)}
                    />
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="scrollbar-hidden min-h-0 overflow-y-auto overscroll-contain">
            <article className="space-y-5 p-5 font-extralight md:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-light uppercase text-[var(--app-text-tertiary)]">
                    Etapa {selectedIndex + 1} de {totalCount}
                  </p>
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-light text-[var(--app-text-primary)]">
                      {selected.title}
                    </h3>
                    <Badge className={cn("border-0 px-2 py-0.5 text-[10px] font-extralight", SECTION_COLORS[selected.section] || "bg-zinc-500 text-white")}>
                      {selected.badge}
                    </Badge>
                    {currentCompleted ? (
                      <Badge className="border-0 bg-emerald-500 px-2 py-0.5 text-[10px] font-extralight text-white">
                        Concluída
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs font-extralight text-[var(--app-text-secondary)]">
                    {selected.audience}
                  </p>
                </div>

                <Button
                  type="button"
                  className="h-9 shrink-0 gap-2 rounded-[6px] bg-[#FF4529] px-4 text-sm font-light text-white hover:bg-[#FF4529]/90"
                  onClick={() => openStep(selected)}
                >
                  <Play className="h-3.5 w-3.5" />
                  {selected.ctaLabel}
                </Button>
              </div>

              <p className="text-sm font-extralight leading-7 text-[var(--app-text-secondary)]">
                {selected.description}
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <GuideContentBlock title="O que você vai aprender">
                  <ul className="space-y-3">
                    {selected.details.map((detail) => (
                      <li key={detail} className="flex gap-3 text-sm font-extralight leading-6 text-[var(--app-text-secondary)]">
                        <Circle className="mt-2 h-1.5 w-1.5 shrink-0 fill-[#FF4529] text-[#FF4529]" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </GuideContentBlock>

                <GuideContentBlock title="Faça agora">
                  <ol className="space-y-3">
                    {selected.checklist.map((item, index) => (
                      <li key={item} className="flex gap-3 text-sm font-extralight leading-6 text-[var(--app-text-secondary)]">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--app-surface-soft)] text-[10px] text-[var(--app-text-primary)]">
                          {index + 1}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </GuideContentBlock>
              </div>

              <div className="flex flex-col gap-3 border-t border-[var(--app-border)] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!previousStep}
                    className="h-9 gap-2 rounded-[6px] px-3 text-sm font-light"
                    onClick={() => previousStep && setSelectedId(previousStep.id)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Anterior
                  </Button>

                  <div className="flex flex-wrap justify-end gap-2">
                    {currentCompleted ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-[6px] px-3 text-sm font-light text-[var(--app-text-secondary)]"
                        onClick={() => markIncomplete(selected.id)}
                      >
                        Marcar pendente
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="h-9 gap-2 rounded-[6px] bg-[#FF4529] px-4 text-sm font-light text-white hover:bg-[#FF4529]/90"
                      onClick={completeAndAdvance}
                    >
                      {currentCompleted ? "Próxima etapa" : "Concluir e avançar"}
                      {nextStep ? <ArrowRight className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 gap-2 rounded-[6px] px-2 text-xs font-light text-[var(--app-text-secondary)]"
                    onClick={restart}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reiniciar guia
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 rounded-[6px] px-2 text-xs font-light text-[var(--app-text-secondary)]"
                    onClick={dismiss}
                  >
                    Não mostrar automaticamente
                  </Button>
                </div>
              </div>
            </article>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GuideContentBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--app-surface)] p-4">
      <p className="text-sm font-light text-[var(--app-text-primary)]">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
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
        "flex w-full gap-3 rounded-[8px] p-3 text-left transition-colors",
        selected ? "bg-[var(--app-surface-solid)]" : "hover:bg-[var(--app-surface-hover)]",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-light",
          completed ? "bg-emerald-500 text-white" : "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]",
        )}
      >
        {completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
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
