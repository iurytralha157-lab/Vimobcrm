"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { publicSiteContactSchema } from "@/lib/validation";
import { submitContactForm } from "@/hooks/use-public-site";
import { cn } from "@/lib/utils";
import { createPublicSubmissionId, getPublicSiteAttribution } from "@/lib/public-site-attribution";

type FormState = {
  name: string;
  email: string;
  phone: string;
  message: string;
  bestTime: string;
  privacyAccepted: boolean;
};

const buildInitialState = (defaultMessage = ""): FormState => ({
  name: "",
  email: "",
  phone: "",
  message: defaultMessage,
  bestTime: "",
  privacyAccepted: false,
});

export function PublicContactForm({
  className,
  defaultMessage,
  organizationId,
  primaryColor,
  privacyHref,
  propertyCode,
  propertyId,
  siteTitle = "imobiliária",
}: Readonly<{
  className?: string;
  defaultMessage?: string;
  organizationId: string;
  primaryColor: string;
  privacyHref?: string;
  propertyCode?: string;
  propertyId?: string;
  siteTitle?: string;
}>) {
  const [formData, setFormData] = useState(() => buildInitialState(defaultMessage));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => createPublicSubmissionId());
  const [website, setWebsite] = useState("");
  const fieldClass = "w-full rounded-[10px] border-0 px-3 text-sm font-normal outline-none transition placeholder:text-current placeholder:opacity-55 focus:brightness-95";
  const fieldStyle = {
    backgroundColor: "color-mix(in srgb, var(--site-fg) 8%, var(--site-card))",
    color: "var(--site-fg)",
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const attribution = getPublicSiteAttribution();
    const payload = {
      organization_id: organizationId,
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      message: formData.message,
      best_time: formData.bestTime,
      privacy_accepted: formData.privacyAccepted,
      privacy_url: privacyHref,
      property_id: propertyId,
      property_code: propertyCode,
      submission_id: submissionId,
      website,
      ...attribution,
    };

    const parsed = publicSiteContactSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Revise os dados do formulário.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitContactForm<{ lead_id?: string; reentry?: boolean }>(parsed.data);
      void result;
      toast.success("Interesse enviado. Em breve entraremos em contato.");
      setFormData(buildInitialState(defaultMessage));
      setSubmissionId(createPublicSubmissionId());
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.issues[0]?.message
        : "Não foi possível enviar agora. Tente novamente em instantes.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      <label className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">Nome</span>
          <input
            required
            value={formData.name}
            onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
            className={`${fieldClass} h-11`}
            placeholder="Seu nome"
            style={fieldStyle}
          />
        </label>

        <label className="block">
          <span className="sr-only">Telefone</span>
          <input
            required
            value={formData.phone}
            onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))}
            className={`${fieldClass} h-11`}
            placeholder="(00) 00000-0000"
            style={fieldStyle}
          />
        </label>
      </div>

      <label className="block">
        <span className="sr-only">E-mail</span>
        <input
          type="email"
          value={formData.email}
          onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
          className={`${fieldClass} h-11`}
          placeholder="voce@email.com"
          style={fieldStyle}
        />
      </label>

      <label className="block">
        <span className="sr-only">Melhor horário para ligar</span>
        <select
          value={formData.bestTime}
          onChange={(event) => setFormData((current) => ({ ...current, bestTime: event.target.value }))}
          className={`${fieldClass} h-11 appearance-none`}
          style={fieldStyle}
        >
          <option value="">Selecione um horário</option>
          <option value="08h as 09h">08h às 09h</option>
          <option value="09h as 10h">09h às 10h</option>
          <option value="10h as 11h">10h às 11h</option>
          <option value="11h as 12h">11h às 12h</option>
          <option value="12h as 13h">12h às 13h</option>
          <option value="13h as 14h">13h às 14h</option>
          <option value="14h as 15h">14h às 15h</option>
          <option value="15h as 16h">15h às 16h</option>
          <option value="16h as 17h">16h às 17h</option>
          <option value="17h as 18h">17h às 18h</option>
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Mensagem</span>
        <textarea
          required
          minLength={2}
          value={formData.message}
          onChange={(event) => setFormData((current) => ({ ...current, message: event.target.value }))}
          className={`${fieldClass} min-h-32 py-3`}
          placeholder="Conte o que você procura"
          style={fieldStyle}
        />
      </label>

      <label className="flex items-start gap-3 text-xs leading-5 opacity-80">
        <input
          required
          type="checkbox"
          checked={formData.privacyAccepted}
          onChange={(event) => setFormData((current) => ({ ...current, privacyAccepted: event.target.checked }))}
          className="mt-1 h-4 w-4 rounded border-zinc-300 accent-[var(--site-primary)]"
        />
        <span>
          Li e concordo com a{" "}
          <a href={privacyHref || "/politica-de-privacidade"} className="font-medium underline underline-offset-4" style={{ color: primaryColor }} target="_blank" rel="noreferrer">
            Política de Privacidade
          </a>{" "}
          da {siteTitle}.
        </span>
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-normal text-white transition disabled:cursor-not-allowed disabled:opacity-70"
        style={{ backgroundColor: primaryColor }}
      >
        <Send className="h-4 w-4" />
        {isSubmitting ? "Enviando..." : "Solicitar atendimento"}
      </button>
    </form>
  );
}
