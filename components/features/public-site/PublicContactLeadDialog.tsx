"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PublicContactForm } from "./PublicContactForm";

type PublicContactLeadDialogProps = {
  organizationId: string;
  primaryColor: string;
  defaultMessage?: string;
  privacyHref?: string;
  siteTitle: string;
  propertyCode?: string;
  propertyId?: string;
  triggerLabel?: string;
  variant?: "floating" | "footer-line" | "contact-line" | "button";
  className?: string;
};

export function PublicContactLeadDialog({
  className,
  defaultMessage = "Olá, vim pelo site e gostaria de receber mais informações.",
  organizationId,
  primaryColor,
  privacyHref,
  propertyCode,
  propertyId,
  siteTitle,
  triggerLabel = "WhatsApp",
  variant = "button",
}: Readonly<PublicContactLeadDialogProps>) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  function closeDialog() {
    setOpen(false);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (activeElement === dialogRef.current || !dialogRef.current?.contains(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={cn(getTriggerClassName(variant), className)}
        style={variant === "button" ? { backgroundColor: primaryColor } : undefined}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <WhatsAppIcon
          className={variant === "floating" ? "h-7 w-7" : "h-4 w-4"}
          style={variant === "contact-line" || variant === "footer-line" ? { color: primaryColor } : undefined}
        />
        {variant !== "floating" ? <span>{triggerLabel}</span> : null}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--site-modal-overlay)] px-4 py-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            aria-modal="true"
            className="max-h-full w-full max-w-xl overflow-y-auto rounded-[8px] bg-[var(--site-card)] text-[var(--site-card-fg)] outline-none"
            onKeyDown={handleDialogKeyDown}
            role="dialog"
            tabIndex={-1}
          >
            <div
              className="flex items-start justify-between gap-4 border-b px-5 py-4"
              style={{ borderColor: "color-mix(in srgb, var(--site-card-fg) 12%, transparent)" }}
            >
              <div>
                <p className="text-[12px] font-light" style={{ color: primaryColor }}>
                  Atendimento
                </p>
                <h2 className="mt-1 text-[14px] font-normal" id={titleId}>Fale com a {siteTitle}</h2>
                <p className="mt-1 text-[12px] font-light opacity-70" id={descriptionId}>Preencha seus dados para a equipe retornar pelo WhatsApp.</p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[color-mix(in_srgb,var(--site-card-fg)_6%,transparent)] opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-5">
              <PublicContactForm
                defaultMessage={defaultMessage}
                organizationId={organizationId}
                primaryColor={primaryColor}
                privacyHref={privacyHref}
                propertyCode={propertyCode}
                propertyId={propertyId}
                siteTitle={siteTitle}
                onSuccess={closeDialog}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function WhatsAppIcon({ className, style }: Readonly<{ className?: string; style?: CSSProperties }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      style={style}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M16.02 3.2c-7.05 0-12.78 5.62-12.78 12.55 0 2.22.6 4.39 1.74 6.29L3.2 28.8l6.96-1.72a12.9 12.9 0 0 0 5.86 1.42c7.05 0 12.78-5.62 12.78-12.55S23.07 3.2 16.02 3.2Zm0 22.98c-1.86 0-3.68-.49-5.27-1.41l-.38-.22-4.13 1.02 1.06-3.97-.25-.41a10.22 10.22 0 0 1-1.49-5.44c0-5.65 4.7-10.24 10.46-10.24 5.77 0 10.46 4.59 10.46 10.24s-4.69 10.43-10.46 10.43Z" />
      <path d="M21.94 18.55c-.32-.16-1.89-.92-2.18-1.03-.29-.1-.5-.16-.71.16-.21.31-.82 1.02-1 1.23-.18.21-.37.24-.69.08-.32-.16-1.34-.49-2.55-1.55-.94-.83-1.58-1.86-1.76-2.17-.18-.31-.02-.48.14-.64.14-.14.32-.37.48-.55.16-.18.21-.31.32-.52.1-.21.05-.39-.03-.55-.08-.16-.71-1.69-.97-2.32-.26-.61-.52-.53-.71-.54h-.6c-.21 0-.55.08-.84.39-.29.31-1.1 1.07-1.1 2.61s1.13 3.03 1.29 3.24c.16.21 2.22 3.34 5.38 4.68.75.32 1.34.51 1.8.65.76.24 1.45.2 2 .12.61-.09 1.89-.76 2.16-1.5.26-.73.26-1.36.18-1.5-.08-.13-.29-.21-.61-.37Z" />
    </svg>
  );
}

function getTriggerClassName(variant: NonNullable<PublicContactLeadDialogProps["variant"]>) {
  switch (variant) {
    case "floating":
      return "fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--site-whatsapp)] text-[var(--site-whatsapp-fg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--site-whatsapp)] focus-visible:ring-offset-2";
    case "footer-line":
      return "flex items-center gap-2 rounded-[4px] text-left font-light outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current";
    case "contact-line":
      return "flex w-full items-start gap-3 rounded-[8px] bg-[var(--site-card)] p-4 text-left text-[var(--site-card-fg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]";
    default:
      return "inline-flex h-11 items-center justify-center gap-2 rounded-[6px] px-5 text-[12px] font-light text-[var(--site-primary-fg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]";
  }
}
