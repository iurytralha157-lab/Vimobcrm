import NextImage from "next/image";
import { createPortal } from "react-dom";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export const PWA_INSTALL_PROMPT_VISIBILITY_EVENT =
  "vimob:pwa-install-prompt-visibility";

interface PwaActionPromptProps {
  title: string;
  description: string;
  actionLabel: string;
  actionIcon: LucideIcon;
  onAction: () => void;
  onDismiss: () => void;
  actionDisabled?: boolean;
  dismissDisabled?: boolean;
  ariaLabel: string;
  promptKind: "install" | "notifications";
}

export function PwaActionPrompt({
  title,
  description,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  onDismiss,
  actionDisabled = false,
  dismissDisabled = false,
  ariaLabel,
  promptKind,
}: PwaActionPromptProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setPortalTarget(document.body);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!portalTarget || promptKind !== "install") return;
    const publishVisibility = (visible: boolean) => {
      window.dispatchEvent(new CustomEvent(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, { detail: { visible } }));
    };
    publishVisibility(true);
    return () => publishVisibility(false);
  }, [portalTarget, promptKind]);

  if (!portalTarget) return null;

  return createPortal(
    <div
      data-pwa-prompt={promptKind}
      className="pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 mx-auto max-w-lg animate-in slide-in-from-bottom duration-300 md:bottom-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <section
        aria-label={ariaLabel}
        aria-live="polite"
        aria-atomic="true"
        className="vimob-popover-content app-header-popover pointer-events-auto flex w-full items-center gap-2.5 rounded-[8px] border-0 p-2.5"
        role="region"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-primary/10">
          <NextImage
            src="/icons/favicon-laranja.png"
            alt=""
            aria-hidden="true"
            width={24}
            height={24}
            className="h-6 w-6 object-contain"
          />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-light leading-[18px] text-foreground">
            {title}
          </h3>
          <p className="line-clamp-2 text-[12px] font-light leading-[15px] text-muted-foreground sm:line-clamp-1">
            {description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
            onClick={onDismiss}
            disabled={dismissDisabled}
            aria-label={`Fechar ${ariaLabel.toLowerCase()}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground hover:bg-primary focus-visible:bg-primary"
            onClick={onAction}
            disabled={actionDisabled}
          >
            <ActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {actionLabel}
          </Button>
        </div>
      </section>
    </div>,
    portalTarget,
  );
}
