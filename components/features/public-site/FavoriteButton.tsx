"use client";

import { useSyncExternalStore } from "react";
import { Heart } from "lucide-react";

import { cn } from "@/lib/utils";

function getStorageKey(organizationId: string) {
  return `vimob_public_favorites_${organizationId}`;
}

function readFavorites(organizationId: string) {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getStorageKey(organizationId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(organizationId: string, values: string[]) {
  window.localStorage.setItem(getStorageKey(organizationId), JSON.stringify(values));
  window.dispatchEvent(new CustomEvent("vimob:favorites-changed", { detail: values }));
}

export function getPublicFavoriteIds(organizationId: string) {
  return readFavorites(organizationId);
}

export function FavoriteButton({
  className,
  organizationId,
  propertyId,
}: Readonly<{
  className?: string;
  organizationId: string;
  propertyId: string;
}>) {
  const isFavorited = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("vimob:favorites-changed", onStoreChange);
      window.addEventListener("storage", onStoreChange);
      return () => {
        window.removeEventListener("vimob:favorites-changed", onStoreChange);
        window.removeEventListener("storage", onStoreChange);
      };
    },
    () => readFavorites(organizationId).includes(propertyId),
    () => false,
  );

  return (
    <button
      type="button"
      aria-label={isFavorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = readFavorites(organizationId);
        const next = current.includes(propertyId)
          ? current.filter((id) => id !== propertyId)
          : [...current, propertyId];
        writeFavorites(organizationId, next);
      }}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/92 text-slate-700 shadow-sm transition hover:scale-105 hover:bg-white",
        className,
      )}
    >
      <Heart className={cn("h-4 w-4", isFavorited && "fill-red-500 text-red-500")} />
    </button>
  );
}
