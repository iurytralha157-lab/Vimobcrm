"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Star, Trash2 } from "lucide-react";

import { Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyWorkspaceAsset } from "@/lib/validation";

import { PROPERTY_SECONDARY_BUTTON_CLASS, PropertyFieldGrid, filledFields } from "../../property-ui";
import { getAssetPreviewSource } from "../property-asset-preview";
import { assetDisplayLabel, assetUsageLabel } from "./property-asset-labels";

/** One side panel holds every action, so the grid stays free of per-card buttons. */
export function PropertyMediaSelection({
  asset,
  position,
  total,
  canManage,
  pending,
  onSetPrimary,
  onMove,
  onEdit,
  onDelete,
}: {
  asset: PropertyWorkspaceAsset;
  position: number;
  total: number;
  canManage: boolean;
  pending: boolean;
  onSetPrimary: () => void;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const preview = getAssetPreviewSource(asset);
  const href = asset.access_url || asset.external_url;
  const label = assetDisplayLabel(asset, position);
  const fields = filledFields([
    { label: "Legenda", value: label },
    { label: "Categoria", value: asset.document_category },
    { label: "Uso", value: assetUsageLabel(asset) },
    { label: "Ordem", value: `${position} de ${total}` },
    { label: "Validade", value: asset.expires_at ? formatPropertyDate(asset.expires_at) : null },
  ]);

  return (
    <Panel title="Item selecionado" className="self-start">
      {preview && (
        <div className="relative mb-3 aspect-[16/9] overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
          <Image src={preview} alt={label} fill sizes="(max-width: 1024px) 100vw, 40vw" loading="lazy" className="object-cover" unoptimized referrerPolicy="no-referrer" />
        </div>
      )}
      <PropertyFieldGrid fields={fields} columns={2} />
      {asset.description && (
        <p className="mt-3 whitespace-pre-wrap text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">{asset.description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {href && (
          <Button asChild type="button" variant="ghost" className={PROPERTY_SECONDARY_BUTTON_CLASS}>
            <a href={href} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Abrir
            </a>
          </Button>
        )}
        {canManage && (
          <>
            {asset.asset_type === "photo" && !asset.is_primary && asset.visibility === "public" && (
              <Button type="button" variant="ghost" disabled={pending} className={PROPERTY_SECONDARY_BUTTON_CLASS} onClick={onSetPrimary}>
                <Star className="h-3.5 w-3.5" aria-hidden="true" />
                Definir como capa
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" aria-label="Mover para cima" title="Mover para cima" disabled={pending || position <= 1} className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)]" onClick={() => onMove(-1)}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Mover para baixo" title="Mover para baixo" disabled={pending || position >= total} className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)]" onClick={() => onMove(1)}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" disabled={pending} className={PROPERTY_SECONDARY_BUTTON_CLASS} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Editar
            </Button>
            <Button type="button" variant="ghost" disabled={pending} className={`${PROPERTY_SECONDARY_BUTTON_CLASS} text-destructive hover:text-destructive`} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remover
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}
