"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PublicContactForm } from "./PublicContactForm";

type PublicContactLeadDialogProps = {
  organizationId: string;
  primaryColor: string;
  siteTitle: string;
  propertyCode?: string;
  propertyId?: string;
  triggerLabel?: string;
  variant?: "floating" | "footer-line" | "contact-line" | "button";
  className?: string;
};

export function PublicContactLeadDialog({
  className,
  organizationId,
  primaryColor,
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
        <MessageCircle className={variant === "floating" ? "h-7 w-7" : "h-4 w-4"} />
        {variant !== "floating" ? <span>{triggerLabel}</span> : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/58 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl overflow-hidden rounded-[14px] bg-white text-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: primaryColor }}>
                  Atendimento
                </p>
                <h2 className="mt-1 text-xl font-semibold">Fale com a {siteTitle}</h2>
                <p className="mt-1 text-sm text-zinc-500">Preencha seus dados para a equipe retornar pelo WhatsApp.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-5">
              <PublicContactForm
                organizationId={organizationId}
                primaryColor={primaryColor}
                propertyCode={propertyCode}
                propertyId={propertyId}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function getTriggerClassName(variant: NonNullable<PublicContactLeadDialogProps["variant"]>) {
  switch (variant) {
    case "floating":
      return "fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl transition hover:scale-105";
    case "footer-line":
      return "flex items-center gap-2 text-left text-white/64 transition hover:text-white";
    case "contact-line":
      return "flex w-full items-start gap-3 rounded-[12px] bg-[var(--site-card)] p-4 text-left text-[var(--site-fg)] transition hover:brightness-105";
    default:
      return "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-semibold text-white transition hover:brightness-110";
  }
}
