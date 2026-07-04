"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { publicSiteContactSchema } from "@/lib/validation";
import { submitContactForm } from "@/hooks/use-public-site";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  email: string;
  phone: string;
  message: string;
};

const initialState: FormState = {
  name: "",
  email: "",
  phone: "",
  message: "",
};

export function PublicContactForm({
  className,
  organizationId,
  primaryColor,
  propertyCode,
  propertyId,
}: Readonly<{
  className?: string;
  organizationId: string;
  primaryColor: string;
  propertyCode?: string;
  propertyId?: string;
}>) {
  const [formData, setFormData] = useState(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fieldClass = "mt-1 w-full rounded-[10px] border-0 bg-zinc-100 px-3 text-sm font-normal text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:bg-zinc-50";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      organization_id: organizationId,
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      message: formData.message,
      property_id: propertyId,
      property_code: propertyCode,
    };

    const parsed = publicSiteContactSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Revise os dados do formulario.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitContactForm(parsed.data);
      toast.success("Mensagem enviada. Em breve entraremos em contato.");
      setFormData(initialState);
    } catch (error) {
      const message = error instanceof z.ZodError
        ? error.issues[0]?.message
        : "Nao foi possivel enviar agora. Tente novamente em instantes.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-normal">
          Nome
          <input
            required
            value={formData.name}
            onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
            className={`${fieldClass} h-11`}
            placeholder="Seu nome"
          />
        </label>

        <label className="space-y-2 text-sm font-normal">
          Telefone
          <input
            required
            value={formData.phone}
            onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))}
            className={`${fieldClass} h-11`}
            placeholder="(00) 00000-0000"
          />
        </label>
      </div>

      <label className="block space-y-2 text-sm font-normal">
        E-mail
        <input
          type="email"
          value={formData.email}
          onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
          className={`${fieldClass} h-11`}
          placeholder="voce@email.com"
        />
      </label>

      <label className="block space-y-2 text-sm font-normal">
        Mensagem
        <textarea
          value={formData.message}
          onChange={(event) => setFormData((current) => ({ ...current, message: event.target.value }))}
          className={`${fieldClass} min-h-32 py-3`}
          placeholder="Conte o que voce procura"
        />
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-normal text-white transition disabled:cursor-not-allowed disabled:opacity-70"
        style={{ backgroundColor: primaryColor }}
      >
        <Send className="h-4 w-4" />
        {isSubmitting ? "Enviando..." : "Enviar mensagem"}
      </button>
    </form>
  );
}
