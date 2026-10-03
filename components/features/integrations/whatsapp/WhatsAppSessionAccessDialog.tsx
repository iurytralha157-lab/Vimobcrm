"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrganizationUsers } from "@/hooks/use-users";
import {
  useGrantSessionAccess, useRevokeSessionAccess, useSessionAccess,
  type WhatsAppSession,
} from "@/hooks/use-whatsapp-sessions";
import {
  canShareOwnWhatsAppSession,
  eligibleWhatsAppAccessRecipients,
} from "@/lib/access/whatsapp-session-sharing";
import { getPublicErrorMessage } from "@/lib/api/vimob-error";

type SharingActor = {
  userId: string;
  memberRole?: string | null;
  isSuperAdmin: boolean;
  isTeamLeader: boolean;
  ledUserIds: readonly string[];
};

export function WhatsAppSessionAccessDialog({
  session,
  actor,
  open,
  onOpenChange,
}: {
  session: WhatsAppSession | null;
  actor: SharingActor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [actionError, setActionError] = useState("");
  const canManageAccess = Boolean(session && canShareOwnWhatsAppSession({
    ownerUserId: session.owner_user_id,
    currentUserId: actor.userId,
    memberRole: actor.memberRole,
    isSuperAdmin: actor.isSuperAdmin,
    isTeamLeader: actor.isTeamLeader,
  }));
  const usersQuery = useOrganizationUsers({ enabled: open && canManageAccess });
  const accessQuery = useSessionAccess(open && canManageAccess ? session?.id ?? null : null);
  const grantAccess = useGrantSessionAccess();
  const revokeAccess = useRevokeSessionAccess();
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUserId("");
      setActionError("");
    }
    onOpenChange(nextOpen);
  };

  const availableUsers = useMemo(() => {
    const recipients = eligibleWhatsAppAccessRecipients(usersQuery.data || [], {
      currentUserId: actor.userId,
      memberRole: actor.memberRole,
      isSuperAdmin: actor.isSuperAdmin,
      isTeamLeader: actor.isTeamLeader,
      ledUserIds: actor.ledUserIds,
    });
    const grantedIds = new Set((accessQuery.data || []).map((access) => access.user_id));
    return recipients.filter((user) => !grantedIds.has(user.id));
  }, [accessQuery.data, actor, usersQuery.data]);

  const handleGrant = async () => {
    if (!session || !canManageAccess || !selectedUserId
      || !availableUsers.some((user) => user.id === selectedUserId)) return;
    setActionError("");
    try {
      await grantAccess.mutateAsync({ sessionId: session.id, userId: selectedUserId });
      setSelectedUserId("");
    } catch (error) {
      setActionError(getPublicErrorMessage(error, "Não foi possível conceder acesso."));
    }
  };

  const handleRevoke = async (userId: string) => {
    if (!session || !canManageAccess) return;
    setActionError("");
    try {
      await revokeAccess.mutateAsync({ sessionId: session.id, userId });
    } catch (error) {
      setActionError(getPublicErrorMessage(error, "Não foi possível revogar acesso."));
    }
  };

  return (
    <Dialog open={open && canManageAccess} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartilhar meu WhatsApp</DialogTitle>
          <DialogDescription>
            Quem receber acesso poderá ver e atender apenas os leads sob sua responsabilidade.
            Transferir um lead não compartilha este número.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Pessoas com acesso</p>
            {accessQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando acessos...</p>
            ) : accessQuery.isError ? (
              <p role="alert" className="text-sm text-destructive">Não foi possível consultar os acessos.</p>
            ) : (accessQuery.data || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Este número ainda não foi compartilhado.</p>
            ) : (
              <div className="max-h-44 space-y-2 overflow-y-auto">
                {(accessQuery.data || []).map((access) => (
                  <div key={access.user_id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <span className="min-w-0 truncate text-sm">{access.user?.name || access.user_id}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={revokeAccess.isPending}
                      onClick={() => void handleRevoke(access.user_id)}
                      aria-label={`Revogar acesso de ${access.user?.name || access.user_id}`}
                    >
                      Revogar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Conceder acesso</p>
            {usersQuery.isError ? (
              <p role="alert" className="text-sm text-destructive">Não foi possível carregar os usuários.</p>
            ) : usersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando usuários...</p>
            ) : availableUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma pessoa disponível para conceder acesso.</p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger aria-label="Pessoa que receberá acesso" className="min-w-0 flex-1">
                    <SelectValue placeholder="Selecione uma pessoa" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  disabled={!selectedUserId || grantAccess.isPending}
                  onClick={() => void handleGrant()}
                >
                  {grantAccess.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Conceder"}
                </Button>
              </div>
            )}
          </div>
          {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
