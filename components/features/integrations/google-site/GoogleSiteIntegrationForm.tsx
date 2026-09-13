"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, ExternalLink, Loader2, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GoogleSiteIntegrationFormProps = Readonly<{
  currentValue?: string | null;
  description: string;
  documentationUrl: string;
  instructions: readonly string[];
  inputId: string;
  isConfigured?: boolean;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  label: string;
  onSave: (value: string | null) => Promise<void>;
  placeholder: string;
  siteActive?: boolean;
  siteUrl?: string | null;
  title: string;
}>;

export function GoogleSiteIntegrationForm({
  currentValue,
  description,
  documentationUrl,
  instructions,
  inputId,
  isConfigured,
  isError,
  isLoading,
  isPending,
  label,
  onSave,
  placeholder,
  siteActive,
  siteUrl,
  title,
}: GoogleSiteIntegrationFormProps) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const value = draftValue ?? currentValue ?? "";
  const configured = isConfigured ?? Boolean(currentValue);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await onSave(value.trim() || null);
      setDraftValue(null);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Não foi possível salvar a integração.",
      );
    }
  };

  const disconnect = async () => {
    setFormError(null);
    try {
      await onSave(null);
      setDraftValue("");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Não foi possível remover a integração.",
      );
    }
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="max-w-2xl text-xs font-light leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <Badge variant={configured ? "default" : "outline"}>
          {configured
            ? "Configurado"
            : currentValue
              ? "Atualização necessária"
              : "Não configurado"}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando configuração...
        </div>
      ) : null}

      {isError ? (
        <p className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Não foi possível consultar a configuração atual.
        </p>
      ) : null}

      {currentValue && !configured ? (
        <p className="rounded-[6px] bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          A configuração salva é legada. Substitua o valor pelo identificador atual indicado abaixo.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={inputId}>{label}</Label>
        <Input
          id={inputId}
          autoComplete="off"
          disabled={isLoading || isPending}
          onChange={(event) => setDraftValue(event.target.value)}
          placeholder={placeholder}
          value={value}
        />
        {siteUrl ? (
          <p className="text-xs text-muted-foreground">
            Site:{" "}
            <a
              className="text-primary hover:underline"
              href={siteUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {siteUrl}
            </a>{" "}
            {siteActive === false ? "(site pausado)" : ""}
          </p>
        ) : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Configure um subdomínio ou valide o domínio para obter uma URL pública antes de concluir no Google.
          </p>
        )}
      </div>

      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
        <p className="mb-2 text-xs font-medium">Como concluir no Google</p>
        <ol className="list-decimal space-y-1 pl-4 text-xs font-light leading-5 text-muted-foreground">
          {instructions.map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ol>
        <a
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          href={documentationUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Abrir documentação oficial <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {formError ? (
        <p className="rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {currentValue ? (
          <Button
            disabled={isPending}
            onClick={disconnect}
            type="button"
            variant="outline"
          >
            <Unplug className="h-4 w-4" />
            Remover configuração
          </Button>
        ) : null}
        <Button disabled={isLoading || isPending || !value.trim()} type="submit">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Salvar configuração
        </Button>
      </div>
    </form>
  );
}
