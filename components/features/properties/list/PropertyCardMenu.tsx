import {
  Building2,
  CheckCircle,
  Clock,
  ExternalLink,
  Eye,
  Globe,
  History,
  KeyRound,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Property } from "@/hooks/use-properties";
import { cn } from "@/lib/utils";

import type { PropertyStatusKind } from "../property-display";

const ITEM_CLASS =
  "h-8 gap-2 rounded-[6px] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]";
const ICON_CLASS = "h-3.5 w-3.5 shrink-0";

function isShareAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function PropertyCardMenu({
  property,
  propertyLabel,
  propertySiteUrl,
  statusKind,
  isSaleIntent,
  isRentalIntent,
  canEdit,
  canRunAvailabilityActions,
  canDelete,
  onEdit,
  onDelete,
  onPreview,
  onOpenDetails,
  onHistory,
  onChangeStatus,
  onOpenPublication,
}: {
  property: Property;
  propertyLabel: string;
  propertySiteUrl: string | null;
  statusKind: PropertyStatusKind;
  isSaleIntent: boolean;
  isRentalIntent: boolean;
  canEdit: boolean;
  canRunAvailabilityActions: boolean;
  canDelete: boolean;
  onEdit: (property: Property) => void;
  onDelete: (id: string) => void;
  onPreview: (property: Property) => void;
  onOpenDetails?: (property: Property) => void;
  onHistory?: (property: Property) => void;
  onChangeStatus?: (
    id: string,
    status: "ativo" | "reservado" | "vendido" | "alugado",
    expectedUpdatedAt: string,
  ) => void;
  onOpenPublication?: (id: string) => void;
}) {
  const hasStatusActions = canRunAvailabilityActions && Boolean(onChangeStatus);
  const hasPublicationAction = canRunAvailabilityActions && Boolean(onOpenPublication);
  const isUnavailable = ["sold", "rented", "reserved"].includes(statusKind);
  const isDormant = ["inactive", "draft", "archived"].includes(statusKind);

  const shareProperty = async () => {
    if (!propertySiteUrl) {
      toast.info("Publique o imóvel no site para compartilhar o link.");
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: property.title || property.code || "Imóvel", url: propertySiteUrl });
        return;
      } catch (error) {
        if (isShareAbortError(error)) return;
        // The platform refused the native sheet; fall back below.
      }
    }
    try {
      await navigator.clipboard.writeText(propertySiteUrl);
      toast.success("Link do imóvel copiado!");
    } catch {
      window.open(propertySiteUrl, "_blank", "noopener,noreferrer");
      toast.info("Abrimos o link do imóvel em uma nova aba.");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Ações de ${propertyLabel}`}
          title="Ações"
          className="h-7 w-7 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none"
      >
        {onOpenDetails && (
          <DropdownMenuItem className={ITEM_CLASS} onClick={() => onOpenDetails(property)}>
            <Building2 className={ICON_CLASS} />
            Abrir ficha 360°
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={ITEM_CLASS} onClick={() => onPreview(property)}>
          <Eye className={ICON_CLASS} />
          Visualização rápida
        </DropdownMenuItem>
        {onHistory && (
          <DropdownMenuItem className={ITEM_CLASS} onClick={() => onHistory(property)}>
            <History className={ICON_CLASS} />
            Histórico
          </DropdownMenuItem>
        )}

        {propertySiteUrl && (
          <>
            <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
            <DropdownMenuItem className={ITEM_CLASS} onClick={() => void shareProperty()}>
              <Share2 className={ICON_CLASS} />
              Compartilhar link
            </DropdownMenuItem>
            <DropdownMenuItem
              className={ITEM_CLASS}
              onClick={() => window.open(propertySiteUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className={ICON_CLASS} />
              Abrir no site
            </DropdownMenuItem>
          </>
        )}

        {(canEdit || hasStatusActions || hasPublicationAction) && (
          <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
        )}
        {canEdit && (
          <DropdownMenuItem className={ITEM_CLASS} onClick={() => onEdit(property)}>
            <Pencil className={ICON_CLASS} />
            Editar
          </DropdownMenuItem>
        )}
        {hasStatusActions && (
          <>
            {!isUnavailable && (
              <DropdownMenuItem
                className={ITEM_CLASS}
                onClick={() => onChangeStatus?.(property.id, "reservado", property.updated_at)}
              >
                <Clock className={ICON_CLASS} />
                Marcar como reservado
              </DropdownMenuItem>
            )}
            {isSaleIntent && statusKind !== "sold" && (
              <DropdownMenuItem
                className={ITEM_CLASS}
                onClick={() => onChangeStatus?.(property.id, "vendido", property.updated_at)}
              >
                <CheckCircle className={ICON_CLASS} />
                Marcar como vendido
              </DropdownMenuItem>
            )}
            {isRentalIntent && statusKind !== "rented" && (
              <DropdownMenuItem
                className={ITEM_CLASS}
                onClick={() => onChangeStatus?.(property.id, "alugado", property.updated_at)}
              >
                <KeyRound className={ICON_CLASS} />
                Marcar como alugado
              </DropdownMenuItem>
            )}
            {(isUnavailable || isDormant) && (
              <DropdownMenuItem
                className={ITEM_CLASS}
                onClick={() => onChangeStatus?.(property.id, "ativo", property.updated_at)}
              >
                <RotateCcw className={ICON_CLASS} />
                Voltar disponível
              </DropdownMenuItem>
            )}
          </>
        )}
        {hasPublicationAction && (
          <DropdownMenuItem className={ITEM_CLASS} onClick={() => onOpenPublication?.(property.id)}>
            <Globe className={ICON_CLASS} />
            Gerenciar publicação
          </DropdownMenuItem>
        )}

        {canDelete && (
          <>
            <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
            <DropdownMenuItem
              className={cn(ITEM_CLASS, "text-destructive focus:bg-destructive/10 focus:text-destructive")}
              onClick={() => onDelete(property.id)}
            >
              <Trash2 className={ICON_CLASS} />
              Excluir
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
