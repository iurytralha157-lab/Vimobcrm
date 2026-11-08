"use client";

import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from "@/config/form-wizard";
import { cn } from "@/lib/utils";
import { PropertyFormChecklist } from "./PropertyFormChecklist";
import { PropertyFormPreview } from "./PropertyFormPreview";
import { buildPropertyFormProgress } from "./property-form-portfolio";
import type { PropertyFormData } from "./property-form-model";

export function PropertyFormAside({ property, formData, validationIssues = [], onOpenHistory }: {
  property?: { title?: string | null; code: string; updated_at: string } | null;
  formData: PropertyFormData;
  validationIssues?: ReadonlyArray<{ tab: string }>;
  onOpenHistory: () => void;
}) {
  return property ? (
    <div className="space-y-4" data-testid="property-form-history">
      <div className="space-y-3 rounded-[6px] bg-[var(--app-surface-solid)] p-4">
        <p className="text-[12px] font-normal">{property.title || "Imóvel"}</p>
        <dl className="space-y-3 text-[11px]">
          <div><dt className="text-muted-foreground">Código</dt><dd className="mt-1 font-mono">{property.code}</dd></div>
          <div><dt className="text-muted-foreground">Última alteração salva</dt><dd className="mt-1">{new Date(property.updated_at).toLocaleString("pt-BR")}</dd></div>
        </dl>
      </div>
      <Button type="button" variant="ghost" className={cn(FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME, "w-full justify-start")} onClick={onOpenHistory}>
        <History className="mr-2 h-4 w-4" aria-hidden="true" />Ver histórico completo
      </Button>
    </div>
  ) : (
    <div className="space-y-4">
      <PropertyFormChecklist items={buildPropertyFormProgress(formData, validationIssues)} />
      <PropertyFormPreview formData={formData} />
    </div>
  );
}
