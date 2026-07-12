"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
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
  defaultMessage = "Ola, vim pelo site e gostaria de receber mais informacoes.",
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(getTriggerClassName(variant), className)}
        style={variant === "button" ? { backgroundColor: primaryColor } : undefined}
        aria-label={triggerLabel}
      >
        <WhatsAppIcon
          className={variant === "floating" ? "h-7 w-7" : "h-4 w-4"}
          style={variant === "contact-line" || variant === "footer-line" ? { color: primaryColor } : undefined}
        />
        {variant !== "floating" ? <span>{triggerLabel}</span> : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/58 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl overflow-hidden rounded-[14px] bg-[var(--site-card)] text-[var(--site-fg)]">
            <div
              className="flex items-start justify-between gap-4 border-b px-5 py-4"
              style={{ borderColor: "color-mix(in srgb, var(--site-fg) 12%, transparent)" }}
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: primaryColor }}>
                  Atendimento
                </p>
                <h2 className="mt-1 text-xl font-semibold">Fale com a {siteTitle}</h2>
                <p className="mt-1 text-sm opacity-65">Preencha seus dados para a equipe retornar pelo WhatsApp.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] opacity-65 transition hover:bg-white/10 hover:opacity-100"
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
      return "fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white transition hover:scale-105";
    case "footer-line":
      return "flex items-center gap-2 text-left text-white/64 transition hover:text-white";
    case "contact-line":
      return "flex w-full items-start gap-3 rounded-[12px] bg-[var(--site-card)] p-4 text-left text-[var(--site-fg)] transition hover:brightness-105";
    default:
      return "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-semibold text-white transition hover:brightness-110";
  }
}
