"use client";

import { useState } from "react";
import { Bath, BedDouble, Car, ImageIcon, MapPin, Monitor, Ruler, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatFixedBRLCurrency } from "@/lib/utils/formatting";
import type { PropertyFormData } from "@/components/features/properties/property-form/property-form-model";
import { buildPropertyFormPublicPreview } from "@/components/features/properties/property-form/property-form-preview";

export function PropertyFormPreview({ formData }: { formData: PropertyFormData }) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const preview = buildPropertyFormPublicPreview(formData);
  const metrics = [
    { label: "Quartos", value: preview.bedrooms, icon: BedDouble },
    { label: "Banheiros", value: preview.bathrooms, icon: Bath },
    { label: "Vagas", value: preview.parkingSpaces, icon: Car },
    { label: "Área", value: preview.area ? `${preview.area} m²` : "", icon: Ruler },
  ].filter((metric) => metric.value);

  return (
    <div className="space-y-4" data-testid="property-form-public-preview">
      <div className="flex items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] p-1" aria-label="Formato da prévia">
        {([
          ["mobile", "Mobile", Smartphone],
          ["desktop", "Desktop", Monitor],
        ] as const).map(([value, label, Icon]) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={device === value}
            onClick={() => setDevice(value)}
            className={cn("h-8 flex-1 gap-1.5 text-[11px]", device === value && "bg-[var(--app-surface-solid)] shadow-sm")}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>

      <article className={cn(
        "overflow-hidden border border-[var(--app-border)] bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
        device === "mobile" ? "mx-auto max-w-[280px] rounded-[18px]" : "rounded-[6px]",
      )}>
        {device === "desktop" && (
          <div className="flex gap-1 border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] p-2" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-text-tertiary)]/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-text-tertiary)]/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-text-tertiary)]/40" />
          </div>
        )}
        <div className={cn("relative bg-[var(--app-surface-soft)]", device === "mobile" ? "aspect-[4/3]" : "aspect-[16/9]")}>
          {preview.images[0] ? (
            // Drafts can include local blob URLs; no public page or upload is opened.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.images[0]} alt={preview.title || "Foto do imóvel"} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-10 w-10 opacity-40" aria-hidden="true" /></div>
          )}
          <span className="absolute left-3 top-3 rounded-[4px] bg-black/65 px-2 py-1 text-[10px] text-white">{preview.dealType || "Modalidade"}</span>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <p className="text-[10px] text-muted-foreground">{preview.propertyType || "Tipo de imóvel"}</p>
            <h3 className="mt-1 text-[14px] font-normal leading-5">{preview.title || "Título do imóvel"}</h3>
          </div>
          <div className="space-y-1 text-[14px] font-normal">
            {preview.salePrice !== null && <p>{formatFixedBRLCurrency(preview.salePrice)}</p>}
            {preview.rentalPrice !== null && <p>{formatFixedBRLCurrency(preview.rentalPrice)} <span className="text-[10px] text-muted-foreground">/ mês</span></p>}
            {preview.salePrice === null && preview.rentalPrice === null && <p className="text-[12px] text-muted-foreground">Valor do imóvel</p>}
          </div>
          {preview.address && <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{preview.address}</p>}
          {metrics.length > 0 && (
            <div className="grid grid-cols-2 gap-2 border-y border-[var(--app-border)] py-3">
              {metrics.map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-1.5 text-[10px]"><Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><span>{value} {label === "Área" ? "" : label.toLowerCase()}</span></div>)}
            </div>
          )}
          <div><p className="mb-1 text-[11px] font-normal">Descrição</p><p className="whitespace-pre-line break-words text-[11px] leading-5 text-muted-foreground">{preview.description || "A descrição pública aparecerá aqui."}</p></div>
        </div>
      </article>
    </div>
  );
}
