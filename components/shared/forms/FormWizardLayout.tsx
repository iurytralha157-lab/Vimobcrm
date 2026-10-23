"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Sparkles, type LucideIcon } from "lucide-react";

import { ProductUpdatesDialog } from "@/components/features/news";
import { Button } from "@/components/ui/button";
import { FORM_WIZARD_GRID_CLASS_NAME } from "@/config/form-wizard";
import { cn } from "@/lib/utils";

export type FormWizardStep = {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  buttonId?: string;
  panelId?: string;
  tourId?: string;
};

type FormWizardLayoutProps = {
  steps: readonly FormWizardStep[];
  activeStep: string;
  onStepChange: (id: string) => void;
  children: ReactNode;
  aside?: ReactNode;
  asideTitle?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  asideContentClassName?: string;
  newsButtonClassName?: string;
  showNews?: boolean;
  navTourId?: string;
  /** Move footer navigation into the new panel; tablist and consumer focus stay owned by their callers. */
  focusContentOnStepChange?: boolean;
};

/** Presentation only: each domain owns its state, validation and final action. */
export function FormWizardLayout({
  steps,
  activeStep,
  onStepChange,
  children,
  aside,
  asideTitle,
  footer,
  className,
  contentClassName,
  asideContentClassName,
  newsButtonClassName,
  showNews = true,
  navTourId,
  focusContentOnStepChange = false,
}: FormWizardLayoutProps) {
  const instanceId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const footerActivationRef = useRef<{ step: string; control: HTMLElement } | null>(null);
  const previousStepRef = useRef(activeStep);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const hasAside = aside !== undefined && aside !== null;

  useEffect(() => {
    if (previousStepRef.current === activeStep) return;
    const previousStep = previousStepRef.current;
    previousStepRef.current = activeStep;
    const activation = footerActivationRef.current;
    footerActivationRef.current = null;
    // Mobile scrolls the grid, while desktop scrolls only its content column.
    gridRef.current?.scrollTo({ top: 0 });
    contentRef.current?.scrollTo({ top: 0 });
    const focusedElement = document.activeElement;
    if (focusedElement instanceof HTMLElement && navigationRef.current?.contains(focusedElement)) {
      focusedElement.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    // Review may replace Next, and Back may become disabled before effects run.
    const lostFooterControl = focusedElement === document.body && activation?.step === previousStep &&
      (!activation.control.isConnected || activation.control.matches(":disabled"));
    if (!focusContentOnStepChange || (!footerRef.current?.contains(focusedElement) && !lostFooterControl)) return;
    const panel = contentRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    panel?.focus({ preventScroll: true });
    // A short mobile viewport may fit the tablist but none of the new panel.
    panel?.scrollIntoView({ block: "start", inline: "nearest" });
  }, [activeStep, focusContentOnStepChange]);

  const handleStepKeyDown = (event: KeyboardEvent<HTMLButtonElement>, stepId: string) => {
    const enabledSteps = steps.filter((step) => !step.disabled);
    const currentIndex = enabledSteps.findIndex((step) => step.id === stepId);
    if (currentIndex < 0 || enabledSteps.length === 0) return;

    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % enabledSteps.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + enabledSteps.length) % enabledSteps.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = enabledSteps.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextStep = enabledSteps[nextIndex];
    onStepChange(nextStep.id);
    const button = Array.from(navigationRef.current?.querySelectorAll<HTMLButtonElement>("[data-step-id]") || [])
      .find((item) => item.dataset.stepId === nextStep.id);
    button?.focus();
  };

  return (
    <div data-form-wizard className={cn("flex min-h-0 flex-1 flex-col text-[var(--app-text-primary)]", className)}>
      <div
        ref={gridRef}
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:overflow-hidden",
          hasAside ? FORM_WIZARD_GRID_CLASS_NAME : "lg:grid-cols-[176px_minmax(0,1fr)]",
        )}
      >
        <nav
          ref={navigationRef}
          data-tour={navTourId}
          aria-label="Etapas do formulário"
          role="tablist"
          className={cn("app-scrollbar flex shrink-0 flex-wrap content-start gap-1 px-3 pb-3 pt-2 lg:col-span-1 lg:flex-col lg:flex-nowrap lg:overflow-y-auto lg:px-3 lg:py-4", hasAside && "md:col-span-2")}
        >
          {steps.map((step) => {
            const Icon = step.icon;
            const selected = activeStep === step.id;
            return (
              <button
                key={step.id}
                id={step.buttonId || `${instanceId}-${step.id}`}
                data-step-id={step.id}
                data-tour={step.tourId}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={step.panelId}
                tabIndex={selected ? 0 : -1}
                disabled={step.disabled}
                onClick={() => onStepChange(step.id)}
                onKeyDown={(event) => handleStepKeyDown(event, step.id)}
                className={cn(
                  "flex min-h-10 min-w-0 items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[12px] font-light transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 disabled:pointer-events-none disabled:opacity-40 lg:w-full",
                  selected
                    ? "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]"
                    : "text-[var(--app-text-secondary)]",
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 break-words">{step.label}</span>
              </button>
            );
          })}
        </nav>

        <div
          ref={contentRef}
          data-form-wizard-content
          className={cn(
            "app-scrollbar min-w-0 bg-[var(--app-surface-muted)] px-4 py-5 md:min-h-0 md:overflow-y-auto sm:px-6",
            contentClassName,
          )}
        >
          {children}
        </div>

        {hasAside && (
          <aside className="flex min-w-0 flex-col bg-[var(--app-surface-soft)] md:min-h-0">
            {asideTitle && (
              <div className="shrink-0 px-4 pb-2 pt-5 text-[12px] font-normal text-[var(--app-text-primary)]">
                {asideTitle}
              </div>
            )}
            <div
              data-form-wizard-aside
              className={cn("app-scrollbar min-w-0 flex-1 px-4 pb-5 pt-2 md:min-h-0 md:overflow-y-auto", asideContentClassName)}
            >
              {aside}
            </div>
          </aside>
        )}
      </div>

      {footer && (
        <div
          ref={footerRef}
          onClickCapture={(event) => {
            const control = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
            footerActivationRef.current = control ? { step: activeStep, control } : null;
          }}
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-[var(--app-surface-solid)] px-4 py-4 sm:px-5"
        >
          {showNews && (
            <Button type="button" variant="ghost" onClick={() => setUpdatesOpen(true)} className={cn("h-9 gap-2 rounded-[6px] border-0 px-1 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]", newsButtonClassName)}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Novidades
            </Button>
          )}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{footer}</div>
        </div>
      )}
      {updatesOpen && <ProductUpdatesDialog open={updatesOpen} onOpenChange={setUpdatesOpen} />}
    </div>
  );
}
