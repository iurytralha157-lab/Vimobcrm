"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { buildSetupGuideHref } from "@/lib/setup-guide/navigation";
import { useSetupGuide, type SetupStep } from "@/hooks/use-setup-guide";

const SECTION_COLORS: Record<string, string> = {
  "Primeiros passos": "bg-primary/10 text-primary",
  CRM: "bg-chart-2/10 text-chart-2",
  Atendimento: "bg-success/10 text-success",
  Rotina: "bg-chart-3/10 text-chart-3",
  Conta: "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
  Integrações: "bg-chart-2/10 text-chart-2",
  Gestão: "bg-warning/10 text-warning",
  Imóveis: "bg-success/10 text-success",
  Avançado: "bg-chart-3/10 text-chart-3",
  Performance: "bg-primary/10 text-primary",
  Financeiro: "bg-chart-2/10 text-chart-2",
};

const DEFAULT_SECTION_COLOR = "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]";

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
    retryLoad,
    retrySave,
    restart,
    setActiveStepId,
    setOpen,
    loadWarning,
    steps,
    syncStatus,
    totalCount,
  } = useSetupGuide();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);

  const selected = useMemo(() => {
    if (steps.length === 0) return undefined;
    return (
      steps.find((step) => step.id === selectedId) ||
      steps.find((step) => !progress[step.id]) ||
      steps[0]
    );
  }, [progress, selectedId, steps]);

  const selectedIndex = selected ? steps.findIndex((step) => step.id === selected.id) : -1;
  const previousStep = selectedIndex > 0 ? steps[selectedIndex - 1] : undefined;
  const nextStep = selectedIndex >= 0 && selectedIndex < steps.length - 1
    ? steps[selectedIndex + 1]
    : undefined;
  const currentCompleted = selected ? !!progress[selected.id] : false;
  const hasGuideContent = guideReady && !!selected && steps.length > 0;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
  };

  const openStep = (step: SetupStep) => {
    setActiveStepId(step.id);
    setSelectedId(null);
    setOpen(false);
    router.push(buildSetupGuideHref(step.route, step.id));
  };

  const selectStep = (step: SetupStep) => {
    setSelectedId(step.id);
    requestAnimationFrame(() => contentRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  };

  const completeAndAdvance = () => {
    if (!selected) return;
    markComplete(selected.id);
    if (nextStep) {
      selectStep(nextStep);
      return;
    }
    setOpen(false);
  };

  const restartGuide = () => {
    restart();
    if (steps[0]) selectStep(steps[0]);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn(
        "grid w-[min(980px,calc(100vw-16px))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-0 !shadow-none ![backdrop-filter:none] !duration-0 data-[state=closed]:!animate-none data-[state=open]:!animate-none sm:rounded-[8px] [&>button]:right-3 [&>button]:top-3 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center",
        hasGuideContent
          ? "h-[min(720px,calc(100dvh-16px))]"
          : "h-auto min-h-[260px] max-h-[calc(100dvh-16px)]",
      )}>
        <DialogTitle className="sr-only">Guia de configuração</DialogTitle>
        <DialogDescription className="sr-only">
          Guia prático e personalizado para configurar e usar as áreas disponíveis no Vimob CRM.
        </DialogDescription>

        {!guideReady ? (
          <GuideDialogState
            icon={<LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
            title="Carregando seu guia"
            description="Estamos preparando as etapas disponíveis para o seu perfil."
            status
          />
        ) : !selected || steps.length === 0 ? (
          <GuideDialogState
            icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}
            title="Nenhuma etapa disponível"
            description="Não encontramos etapas compatíveis com o seu acesso atual."
            actionLabel="Fechar"
            onAction={() => setOpen(false)}
          />
        ) : (
          <>
            <header className="border-b border-[var(--app-border)] px-4 py-4 pr-12 sm:px-5 sm:pr-14">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
                    Guia de configuração
                  </p>
                  <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
                    {completedCount} de {totalCount} etapas concluídas
                  </p>
                </div>
                <span className="text-[12px] font-light text-[var(--app-text-secondary)]">{percent}%</span>
              </div>
              <div
                className="mt-3 h-1 overflow-hidden rounded-[2px] bg-[var(--app-surface-soft)]"
                role="progressbar"
                aria-label="Progresso do guia de configuração"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${completedCount} de ${totalCount} etapas concluídas`}
              >
                <div
                  className="h-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                  style={{ width: `${percent}%` }}
                />
              </div>

              {loadWarning ? (
                <div
                  role="alert"
                  className="mt-3 flex flex-col gap-2 rounded-[6px] bg-warning/10 px-3 py-2.5 text-[12px] font-light text-[var(--app-text-secondary)] sm:flex-row sm:items-center"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{loadWarning}</span>
                  <button
                    type="button"
                    className="h-8 shrink-0 rounded-[6px] px-2.5 text-[12px] font-light text-warning transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning/35"
                    onClick={retryLoad}
                  >
                    Tentar sincronizar
                  </button>
                </div>
              ) : null}
            </header>

            <div className="grid min-h-0 grid-rows-[minmax(120px,30dvh)_minmax(0,1fr)] md:grid-cols-[minmax(250px,306px)_minmax(0,1fr)] md:grid-rows-1">
              <aside className="min-h-0 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] md:border-b-0 md:border-r">
                <nav
                  className="scrollbar-hidden h-full overflow-y-auto overscroll-contain p-2.5 sm:p-3"
                  aria-label="Etapas do guia de configuração"
                >
                  {steps.map((step, index) => {
                    const startsSection = index === 0 || steps[index - 1]?.section !== step.section;
                    return (
                      <div key={step.id} className={startsSection && index > 0 ? "mt-4" : undefined}>
                        {startsSection ? (
                          <p className="mb-1.5 px-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            {step.section}
                          </p>
                        ) : null}
                        <GuideStepButton
                          completed={!!progress[step.id]}
                          index={index}
                          selected={selected.id === step.id}
                          step={step}
                          onSelect={() => selectStep(step)}
                        />
                      </div>
                    );
                  })}
                </nav>
              </aside>

              <section
                ref={contentRef}
                className="scrollbar-hidden min-h-0 overflow-y-auto overscroll-contain"
                aria-labelledby="setup-guide-selected-step-title"
              >
                <article className="space-y-5 p-4 sm:p-5 md:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                        Etapa {selectedIndex + 1} de {totalCount}
                      </p>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                        <h3
                          id="setup-guide-selected-step-title"
                          className="text-[20px] font-normal leading-6 text-[var(--app-text-primary)]"
                        >
                          {selected.title}
                        </h3>
                        <Badge className={cn(
                          "rounded-[4px] border-0 px-2 py-0.5 text-[10px] font-light",
                          SECTION_COLORS[selected.section] || DEFAULT_SECTION_COLOR,
                        )}>
                          {selected.badge}
                        </Badge>
                        {currentCompleted ? (
                          <Badge className="rounded-[4px] border-0 bg-success/10 px-2 py-0.5 text-[10px] font-light text-success">
                            Concluída
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[12px] font-light text-[var(--app-text-secondary)]">
                        {selected.audience}
                      </p>
                    </div>

                    <Button
                      type="button"
                      className="h-9 w-full shrink-0 gap-2 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/35 sm:w-auto"
                      onClick={() => openStep(selected)}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      {selected.ctaLabel}
                    </Button>
                  </div>

                  <p className="text-[13px] font-light leading-6 text-[var(--app-text-secondary)]">
                    {selected.description}
                  </p>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <GuideContentBlock title="O que você vai aprender">
                      <ul className="space-y-3">
                        {selected.details.map((detail) => (
                          <li key={detail} className="flex gap-3 text-[13px] font-light leading-6 text-[var(--app-text-secondary)]">
                            <Circle className="mt-2 h-1.5 w-1.5 shrink-0 fill-primary text-primary" aria-hidden="true" />
                            <span>{detail}</span>
                          </li>
                        ))}
                      </ul>
                    </GuideContentBlock>

                    <GuideContentBlock title="Faça agora">
                      <ol className="space-y-3">
                        {selected.checklist.map((item, index) => (
                          <li key={item} className="flex gap-3 text-[13px] font-light leading-6 text-[var(--app-text-secondary)]">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--app-surface-hover)] text-[10px] font-normal text-[var(--app-text-primary)]">
                              {index + 1}
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ol>
                    </GuideContentBlock>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-[var(--app-border)] pt-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!previousStep}
                        className="h-9 w-fit gap-2 rounded-[6px] px-3 text-[12px] font-light shadow-none"
                        onClick={() => previousStep && selectStep(previousStep)}
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Anterior
                      </Button>

                      <div className="flex w-full flex-col-reverse gap-2 min-[420px]:flex-row min-[420px]:justify-end sm:w-auto">
                        {currentCompleted ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 rounded-[6px] px-3 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
                            onClick={() => markIncomplete(selected.id)}
                          >
                            Marcar pendente
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          className="h-9 gap-2 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/35"
                          onClick={completeAndAdvance}
                        >
                          {nextStep
                            ? currentCompleted ? "Próxima etapa" : "Concluir e avançar"
                            : currentCompleted ? "Fechar guia" : "Concluir guia"}
                          {nextStep ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                      </div>
                    </div>

                    <GuideSyncStatus status={syncStatus} onRetry={retrySave} />

                    <div className="flex flex-col gap-1 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-fit gap-2 rounded-[6px] px-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
                        onClick={restartGuide}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reiniciar guia
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-fit rounded-[6px] px-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
                        onClick={dismiss}
                      >
                        Não mostrar automaticamente
                      </Button>
                    </div>
                  </div>
                </article>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GuideContentBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
      <p className="text-[14px] font-normal text-[var(--app-text-primary)]">{title}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function GuideDialogState({
  actionLabel,
  description,
  icon,
  onAction,
  status = false,
  title,
}: {
  actionLabel?: string;
  description: string;
  icon: ReactNode;
  onAction?: () => void;
  status?: boolean;
  title: string;
}) {
  return (
    <div
      className="row-span-2 flex min-h-[260px] flex-col items-center justify-center px-5 py-10 text-center"
      role={status ? "status" : "region"}
      aria-live={status ? "polite" : undefined}
      aria-label={title}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        {icon}
      </span>
      <p className="mt-3 text-[14px] font-normal text-[var(--app-text-primary)]">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
        {description}
      </p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-4 h-9 rounded-[6px] px-4 text-[12px] font-light shadow-none"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

type GuideSyncStatusValue = "idle" | "pending" | "saving" | "saved" | "error";

function GuideSyncStatus({
  onRetry,
  status,
}: {
  onRetry: () => void;
  status: GuideSyncStatusValue;
}) {
  if (status === "idle") return null;

  const isBusy = status === "pending" || status === "saving";
  const isError = status === "error";
  const label = isBusy
    ? status === "pending" ? "Alterações aguardando sincronização" : "Salvando alterações"
    : isError ? "Não foi possível salvar as alterações" : "Alterações salvas";

  return (
    <div
      className={cn(
        "flex min-h-8 flex-wrap items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[11px] font-light",
        isError
          ? "bg-destructive/10 text-destructive"
          : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {isBusy ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{label}</span>
      {isError ? (
        <button
          type="button"
          className="ml-auto h-7 rounded-[6px] px-2 text-[11px] font-light transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/35"
          onClick={onRetry}
        >
          Tentar novamente
        </button>
      ) : null}
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
      aria-current={selected ? "step" : undefined}
      aria-label={`${step.title}. ${completed ? "Etapa concluída" : "Etapa pendente"}.`}
      className={cn(
        "flex w-full gap-3 rounded-[6px] p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35",
        selected ? "bg-[var(--app-surface-hover)]" : "hover:bg-[var(--app-surface-soft)]",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-light",
          completed ? "bg-success/10 text-success" : "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]",
        )}
      >
        {completed ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-light text-[var(--app-text-primary)]">{step.title}</span>
          <Badge className={cn(
            "max-w-[96px] shrink-0 truncate rounded-[4px] border-0 px-2 py-0 text-[10px] font-light",
            SECTION_COLORS[step.section] || DEFAULT_SECTION_COLOR,
          )}>
            {step.badge}
          </Badge>
        </span>
        <span className="mt-1 block truncate text-[12px] font-light text-[var(--app-text-secondary)]">{step.subtitle}</span>
      </span>
    </button>
  );
}
