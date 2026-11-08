"use client";

import { useState } from "react";
import { toast } from "sonner";

import { usePortfolioSettings, useUpdatePortfolioSettings } from "@/hooks/properties/use-portfolio-settings";
import { getErrorMessageOrFallback as getErrorMessage } from "@/lib/api/vimob-error";
import { isPropertySettingsConflict } from "@/lib/property-settings-concurrency";
import { portfolioSettingsUpdateInputSchema, type PortfolioSettings } from "@/lib/validation";

import { buildPortfolioSettingsPatch, type PortfolioGroupKey } from "./portfolio-settings-schema";

/** Draft on top of the server copy, with revision tracking and explicit 409 handling. */
export function usePortfolioSettingsForm() {
  const query = usePortfolioSettings();
  const mutation = useUpdatePortfolioSettings();
  const [draft, setDraft] = useState<PortfolioSettings | null>(null);
  const [conflict, setConflict] = useState(false);
  const saved = query.data?.settings ?? null;
  const values = draft ?? saved;
  const patch = saved && draft ? buildPortfolioSettingsPatch(saved, draft) : {};
  const hasChanges = Object.keys(patch).length > 0;

  const setValue = (group: PortfolioGroupKey, key: string, value: unknown) => {
    if (!values) return;
    setDraft({ ...values, [group]: { ...values[group], [key]: value } } as PortfolioSettings);
  };

  const save = async () => {
    if (!query.data || !hasChanges || conflict) return true;
    const input = { settings: patch, revision: query.data.revision };
    const parsed = portfolioSettingsUpdateInputSchema.safeParse(input);
    if (!parsed.success) {
      toast.error("Revise os valores: há campo vazio ou fora da faixa permitida.");
      return false;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      setDraft(null);
      return true;
    } catch (error) {
      if (isPropertySettingsConflict(error)) {
        setConflict(true);
        toast.error("Outra pessoa salvou estas preferências. Suas escolhas continuam na tela; recarregue antes de salvar.");
      } else {
        toast.error(getErrorMessage(error, "Não foi possível salvar as preferências da carteira."));
      }
      return false;
    }
  };

  const reload = async () => {
    await query.refetch();
    setDraft(null);
    setConflict(false);
  };

  return {
    values,
    loading: query.isLoading,
    loadFailed: query.isError && !query.data,
    retry: () => void query.refetch(),
    hasChanges,
    conflict,
    saving: mutation.isPending,
    setValue,
    save,
    reload,
  };
}
