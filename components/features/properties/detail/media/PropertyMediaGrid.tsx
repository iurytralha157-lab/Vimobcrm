"use client";

import { useState, type DragEvent } from "react";
import Image from "next/image";
import { FileText, GripVertical, ImageIcon, Link2, Lock, Play } from "lucide-react";

import { formatPropertyDate } from "@/lib/property-display-utils";
import type { PropertyWorkspaceAsset } from "@/lib/validation";
import { cn } from "@/lib/utils";

import { PropertyChip } from "../../property-ui";
import { getAssetPreviewSource } from "../property-asset-preview";
import { assetDisplayLabel } from "./property-asset-labels";

function PhotoThumb({ asset, label }: { asset: PropertyWorkspaceAsset; label: string }) {
  const source = getAssetPreviewSource(asset);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!source || failedSource === source) {
    return (
      <span className="flex h-full w-full items-center justify-center text-[var(--app-text-tertiary)]">
        <ImageIcon className="h-5 w-5 opacity-50" aria-hidden="true" />
      </span>
    );
  }
  return (
    <Image
      src={source}
      alt={label}
      fill
      sizes="(max-width: 640px) 45vw, 160px"
      loading="lazy"
      className="object-cover"
      unoptimized
      referrerPolicy="no-referrer"
      onError={() => setFailedSource(source)}
    />
  );
}

export function PropertyPhotoGrid({
  assets,
  selectedId,
  canReorder,
  onSelect,
  onMove,
}: {
  assets: PropertyWorkspaceAsset[];
  selectedId: string | null;
  canReorder: boolean;
  onSelect: (asset: PropertyWorkspaceAsset) => void;
  onMove: (asset: PropertyWorkspaceAsset, targetIndex: number) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const drop = (event: DragEvent, targetIndex: number) => {
    event.preventDefault();
    const dragged = assets.find((item) => item.id === draggingId);
    setDraggingId(null);
    if (dragged) onMove(dragged, targetIndex);
  };

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {assets.map((asset, index) => {
        const label = assetDisplayLabel(asset, index + 1);
        const selected = asset.id === selectedId;
        return (
          <li
            key={asset.id}
            draggable={canReorder}
            onDragStart={() => setDraggingId(asset.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => { if (draggingId) event.preventDefault(); }}
            onDrop={(event) => drop(event, index)}
            className={cn("min-w-0", draggingId === asset.id && "opacity-50")}
          >
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`Selecionar ${label}`}
              onClick={() => onSelect(asset)}
              className={cn(
                "group relative block aspect-[4/3] w-full overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)] outline-none ring-offset-2 ring-offset-[var(--app-surface-solid)]",
                selected ? "ring-2 ring-primary" : "focus-visible:ring-2 focus-visible:ring-primary/40",
              )}
            >
              <PhotoThumb asset={asset} label={label} />
              {asset.is_primary && <PropertyChip tone="surface" className="absolute left-1.5 top-1.5">Capa</PropertyChip>}
              {canReorder && (
                <span className="absolute right-1.5 top-1.5 hidden rounded-[4px] bg-[var(--app-surface-solid)] p-0.5 text-[var(--app-text-secondary)] sm:block">
                  <GripVertical className="h-3 w-3" aria-hidden="true" />
                </span>
              )}
            </button>
            <p className="mt-1 flex items-baseline justify-between gap-2 px-0.5 text-[12px] font-light">
              <span className="min-w-0 truncate text-[var(--app-text-primary)]">{label}</span>
              <span className="shrink-0 tabular-nums text-[11px] text-[var(--app-text-tertiary)]">{index + 1}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const ROW_ICONS = { video: Play, virtual_tour: Link2, floor_plan: ImageIcon, document: FileText, photo: ImageIcon } as const;

function expiryChip(asset: PropertyWorkspaceAsset) {
  if (!asset.expires_at) return null;
  const expired = Date.parse(asset.expires_at) < Date.now();
  return (
    <PropertyChip tone={expired ? "danger" : "neutral"}>
      {expired ? "Venceu" : "Vence"} {formatPropertyDate(asset.expires_at)}
    </PropertyChip>
  );
}

export function PropertyAssetRows({
  assets,
  selectedId,
  onSelect,
}: {
  assets: PropertyWorkspaceAsset[];
  selectedId: string | null;
  onSelect: (asset: PropertyWorkspaceAsset) => void;
}) {
  return (
    <ul className="divide-y divide-[var(--app-border)]">
      {assets.map((asset, index) => {
        const Icon = ROW_ICONS[asset.asset_type];
        const label = assetDisplayLabel(asset, index + 1);
        const selected = asset.id === selectedId;
        return (
          <li key={asset.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(asset)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)]",
                selected && "bg-[var(--app-surface-soft)]",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-light text-[var(--app-text-primary)]">{label}</span>
              {asset.visibility !== "public" && <Lock className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" aria-label="Não vai para o site" />}
              {expiryChip(asset)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
