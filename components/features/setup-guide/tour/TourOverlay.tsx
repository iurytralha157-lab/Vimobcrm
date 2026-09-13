import type {
  KeyboardEventHandler,
  RefObject,
} from "react";

import { cn } from "@/lib/utils";

import { formatGuideText, type TourItem } from "./model";
import type { TourTargetRect, TourTooltipStyle } from "./positioning";

type TourOverlayProps = {
  currentIndex: number;
  currentItem: TourItem | undefined;
  isResolving: boolean;
  itemCount: number;
  onClose: () => void;
  onDialogKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onNavigate: () => void;
  onNext: () => void;
  onPrevious: () => void;
  routeMatches: boolean;
  targetRect: TourTargetRect | null;
  tooltipStyle: TourTooltipStyle;
  tourDialogRef: RefObject<HTMLDivElement | null>;
};

export function TourOverlay({
  currentIndex,
  currentItem,
  isResolving,
  itemCount,
  onClose,
  onDialogKeyDown,
  onNavigate,
  onNext,
  onPrevious,
  routeMatches,
  targetRect,
  tooltipStyle,
  tourDialogRef,
}: TourOverlayProps) {
  if (!routeMatches) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--app-overlay)] px-4">
        <div
          ref={tourDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-guide-route-title"
          aria-describedby="setup-guide-route-description"
          tabIndex={-1}
          onKeyDown={onDialogKeyDown}
          className="app-header-popover pointer-events-auto max-h-[calc(100dvh-32px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)]"
        >
          <p id="setup-guide-route-title" className="text-[14px] font-normal">
            Abrindo a área do guia
          </p>
          <p
            id="setup-guide-route-description"
            className="mt-2 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]"
          >
            Vou levar você para a tela certa e apontar os pontos principais por
            lá.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="h-8 rounded-[6px] px-3 text-[12px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35"
              onClick={onClose}
            >
              Fechar
            </button>
            <button
              type="button"
              className="h-8 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35"
              onClick={onNavigate}
            >
              Ir para tela
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isResolving) {
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--app-overlay-soft)] px-4">
        <div
          ref={tourDialogRef}
          role="status"
          aria-live="polite"
          aria-label="Preparando o ponto atual do guia"
          tabIndex={-1}
          onKeyDown={onDialogKeyDown}
          className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-3 text-[12px] font-light text-[var(--app-text-primary)] outline-none"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none"
          />
          Preparando este ponto...
        </div>
      </div>
    );
  }

  const hasTarget = !!currentItem && !!targetRect;
  const title = hasTarget
    ? currentItem?.title
    : currentItem?.missingTitle ||
      currentItem?.title ||
      "Não encontrei esse ponto na tela";
  const body = hasTarget
    ? currentItem?.body
    : currentItem?.missingBody ||
      currentItem?.body ||
      "Essa área pode estar indisponível para o perfil atual ou ainda carregando. Você pode fechar e abrir o guia novamente depois.";

  return (
    <div className="fixed inset-0 z-[1000]">
      {hasTarget ? (
        <>
          <svg
            className="pointer-events-none fixed inset-0 h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <mask id="setup-guide-spotlight-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={targetRect.left - 6}
                  y={targetRect.top - 6}
                  width={targetRect.width + 12}
                  height={targetRect.height + 12}
                  rx="8"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgb(0 0 0 / 0.45)"
              mask="url(#setup-guide-spotlight-mask)"
            />
          </svg>
          <div
            data-tour="setup-guide-highlight"
            aria-hidden="true"
            className="pointer-events-none fixed rounded-[8px] border-2 border-primary transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
            style={{
              left: targetRect.left - 6,
              top: targetRect.top - 6,
              width: targetRect.width + 12,
              height: targetRect.height + 12,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-[var(--app-overlay)]" />
      )}

      <div
        ref={tourDialogRef}
        data-tour="setup-guide-tooltip"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-guide-tooltip-title"
        aria-describedby="setup-guide-tooltip-body"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="app-header-popover pointer-events-auto fixed max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-[var(--app-text-primary)]"
        style={tooltipStyle}
      >
        {hasTarget ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute h-3 w-3 rotate-45 border border-[var(--app-border)] bg-[var(--app-surface-solid)]",
              tooltipStyle["--tour-arrow-position"] === "bottom"
                ? "-bottom-1.5 border-l-0 border-t-0"
                : "-top-1.5 border-b-0 border-r-0",
            )}
            style={{ left: "calc(50% - 6px)" }}
          />
        ) : null}

        <p className="text-[11px] font-light text-primary">
          Guia de configuração
        </p>
        <h3
          id="setup-guide-tooltip-title"
          data-tour="setup-guide-tooltip-title"
          className="mt-2 text-[14px] font-normal leading-5"
        >
          {formatGuideText(title)}
        </h3>
        <p
          id="setup-guide-tooltip-body"
          data-tour="setup-guide-tooltip-body"
          className="mt-2 text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]"
        >
          {formatGuideText(body)}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
            {itemCount > 0 ? String(currentIndex + 1) + "/" + itemCount : "0/0"}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="h-8 rounded-[6px] px-3 text-[12px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35"
              onClick={onClose}
            >
              Fechar
            </button>
            <button
              type="button"
              className="h-8 rounded-[6px] px-3 text-[12px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 disabled:opacity-40"
              disabled={currentIndex === 0}
              onClick={onPrevious}
            >
              Anterior
            </button>
            <button
              type="button"
              className="h-8 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35"
              onClick={onNext}
            >
              {currentIndex >= itemCount - 1 ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
