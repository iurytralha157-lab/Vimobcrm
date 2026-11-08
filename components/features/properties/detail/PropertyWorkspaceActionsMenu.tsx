"use client";

import {
  CheckCircle,
  Clock3,
  ExternalLink,
  Globe2,
  KeyRound,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { PropertyStatusKind } from "../property-display";

const ITEM_CLASS =
  "h-8 gap-2 rounded-[6px] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]";
const ICON_CLASS = "h-3.5 w-3.5 shrink-0";

export function PropertyWorkspaceActionsMenu({
  label,
  canManage,
  hasSiteUrl,
  statusKind,
  isSaleIntent,
  isRentalIntent,
  pending,
  onOpenSite,
  onChangeStatus,
  onOpenPublication,
}: {
  label: string;
  canManage: boolean;
  hasSiteUrl: boolean;
  statusKind: PropertyStatusKind;
  isSaleIntent: boolean;
  isRentalIntent: boolean;
  pending: boolean;
  onOpenSite: () => void;
  onChangeStatus: (status: "ativo" | "reservado" | "vendido" | "alugado") => void;
  onOpenPublication: () => void;
}) {
  const isUnavailable = ["sold", "rented", "reserved"].includes(statusKind);
  const isDormant = ["inactive", "draft", "archived"].includes(statusKind);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          title="Mais ações"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none"
      >
        {hasSiteUrl && (
          <DropdownMenuItem className={ITEM_CLASS} onSelect={onOpenSite}>
            <ExternalLink className={ICON_CLASS} />
            Abrir no site
          </DropdownMenuItem>
        )}
        {hasSiteUrl && canManage && <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />}
        {canManage && (
          <>
            {!isUnavailable && (
              <DropdownMenuItem disabled={pending} className={ITEM_CLASS} onSelect={() => onChangeStatus("reservado")}>
                <Clock3 className={ICON_CLASS} />
                Marcar como reservado
              </DropdownMenuItem>
            )}
            {isSaleIntent && statusKind !== "sold" && (
              <DropdownMenuItem disabled={pending} className={ITEM_CLASS} onSelect={() => onChangeStatus("vendido")}>
                <CheckCircle className={ICON_CLASS} />
                Marcar como vendido
              </DropdownMenuItem>
            )}
            {isRentalIntent && statusKind !== "rented" && (
              <DropdownMenuItem disabled={pending} className={ITEM_CLASS} onSelect={() => onChangeStatus("alugado")}>
                <KeyRound className={ICON_CLASS} />
                Marcar como alugado
              </DropdownMenuItem>
            )}
            {(isUnavailable || isDormant) && (
              <DropdownMenuItem disabled={pending} className={ITEM_CLASS} onSelect={() => onChangeStatus("ativo")}>
                <RotateCcw className={ICON_CLASS} />
                Voltar disponível
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={ITEM_CLASS} onSelect={onOpenPublication}>
              <Globe2 className={ICON_CLASS} />
              Gerenciar publicação
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
