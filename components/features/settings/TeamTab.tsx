import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDeleteUser, useOrganizationUsers, useUpdateUser } from "@/hooks/use-users";
import { useAdminInvitations } from "@/hooks/use-admin-invitations";
import {
  OrganizationRole,
  useAssignUserRole,
  useOrganizationRoles,
  useUserOrganizationRoles,
} from "@/hooks/use-organization-roles";
import { RolesTab } from "./RolesTab";

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const roleLabel = (role: string | null | undefined) => {
  if (role === "admin") return "Administrador";
  return "Usuario";
};

export function TeamTab() {
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const activeOrganizationId = organization?.id || profile?.organization_id || undefined;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin =
    isSuperAdmin ||
    profile?.role === "admin" ||
    activeMemberRole === "admin" ||
    activeMemberRole === "owner";

  const { data: users = [], isLoading: usersLoading } = useOrganizationUsers();
  const { data: organizationRoles = [] } = useOrganizationRoles();
  const { data: userOrgRoles = [] } = useUserOrganizationRoles();
  const { invitations = [], createInvitation, deleteInvitation } = useAdminInvitations(activeOrganizationId);

  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const assignUserRole = useAssignUserRole();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "user">("user");

  const creatingInvite = createInvitation.isPending;

  const getUserCustomRole = (userId: string): OrganizationRole | undefined => {
    const assignment = userOrgRoles.find((uor) => uor.user_id === userId);
    if (!assignment) return undefined;
    return organizationRoles.find((role) => role.id === assignment.organization_role_id);
  };

  const resetInviteForm = () => {
    setInviteEmail("");
    setInviteRole("user");
  };

  const handleAssignRole = async (userId: string, roleId: string | null) => {
    await assignUserRole.mutateAsync({ userId, roleId });
  };

  const handleToggleUserActive = async (userId: string, currentValue: boolean) => {
    await updateUser.mutateAsync({ id: userId, is_active: !currentValue });
  };

  const handleUpdateUserRole = async (userId: string, role: "admin" | "user") => {
    await updateUser.mutateAsync({ id: userId, role });
    await queryClient.invalidateQueries({ queryKey: ["organization-users"] });
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingUser(true);
    try {
      await deleteUser.mutateAsync(userToDelete.id);
      toast.success("Usuario excluido com sucesso!");
      await queryClient.invalidateQueries({ queryKey: ["organization-users"] });
      setDeleteUserDialogOpen(false);
      setUserToDelete(null);
    } catch (error: unknown) {
      toast.error("Erro ao excluir usuario: " + getErrorMessage(error, "Erro desconhecido"));
    } finally {
      setDeletingUser(false);
    }
  };

  const handleInviteUser = async () => {
    if (!activeOrganizationId) {
      toast.error("Selecione uma organizacao para convidar usuarios.");
      return;
    }
    if (!inviteEmail.trim()) {
      toast.error("Informe o e-mail do usuario.");
      return;
    }

    try {
      const invitation = await createInvitation.mutateAsync({
        email: inviteEmail.trim(),
        role: inviteRole,
        organizationId: activeOrganizationId,
      });

      if ("email_sent" in invitation && invitation.email_sent === false) {
        toast.warning("Convite criado, mas o e-mail nao foi enviado. Verifique a configuracao do Resend.");
      } else {
        toast.success("Convite enviado por e-mail.");
      }

      await queryClient.invalidateQueries({ queryKey: ["organization-users"] });
      setInviteDialogOpen(false);
      resetInviteForm();
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Erro ao enviar convite.");
      if (message.includes("SESSION_EXPIRED") || message.includes("Unauthorized")) {
        toast.error("Sua sessao expirou. Faca login novamente.");
        window.location.assign("/login");
      } else {
        toast.error(message);
      }
    }
  };

  const visibleUsers = users.filter((user) => user.role !== "super_admin");

  return (
    <div className="space-y-6">
      <div className={`grid gap-6 ${isAdmin ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        <Card className="app-card border-0 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-medium text-foreground">{t.settings.users.title}</CardTitle>
              <CardDescription className="mt-0.5 text-sm text-muted-foreground">
                {t.settings.users.description}
              </CardDescription>
            </div>
            {isAdmin && (
              <Dialog
                open={inviteDialogOpen}
                onOpenChange={(open) => {
                  setInviteDialogOpen(open);
                  if (!open) resetInviteForm();
                }}
              >
                <DialogTrigger asChild>
                  <Button data-tour="team-add-user" size="sm" className="shrink-0">
                    <Plus className="mr-2 h-4 w-4" />
                    Novo Corretor
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[92vw] max-w-[460px] rounded-[8px] p-6">
                  <DialogHeader>
                    <DialogTitle>Convidar usuario</DialogTitle>
                    <DialogDescription>
                      Envie um convite para o e-mail do corretor. Ele finaliza o cadastro pelo link.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input
                        type="email"
                        placeholder="email@empresa.com"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Funcao</Label>
                      <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as "admin" | "user")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">Usuario</SelectItem>
                          <SelectItem value="admin">Administrador</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-xs leading-5 text-muted-foreground">
                      O usuario fica como pendente ate aceitar o convite e concordar com os termos.
                    </div>
                  </div>

                  <DialogFooter className="gap-2 pt-2 sm:space-x-0">
                    <Button variant="secondary" onClick={() => setInviteDialogOpen(false)} disabled={creatingInvite}>
                      Cancelar
                    </Button>
                    <Button onClick={handleInviteUser} disabled={creatingInvite || !inviteEmail.trim()}>
                      {creatingInvite && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Enviar convite
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>

          <CardContent className="px-4 pb-4 md:px-6">
            {usersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {visibleUsers.map((user) => {
                  const customRole = getUserCustomRole(user.id);
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 transition-colors hover:bg-[var(--app-surface-hover)]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback className="bg-primary text-sm text-primary-foreground">
                            {user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{user.name}</p>
                            {!user.is_active && (
                              <Badge variant="secondary" className="text-xs">
                                {t.common.inactive}
                              </Badge>
                            )}
                            {user.role !== "admin" && customRole && (
                              <Badge
                                variant="outline"
                                className="border-0 text-xs"
                                style={{
                                  backgroundColor: `${customRole.color}22`,
                                  color: customRole.color,
                                }}
                              >
                                {customRole.name}
                              </Badge>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {isAdmin ? (
                          <>
                            <Select
                              value={user.role ?? "user"}
                              onValueChange={(value) => handleUpdateUserRole(user.id, value as "admin" | "user")}
                              disabled={user.id === profile?.id}
                            >
                              <SelectTrigger className="h-8 w-24 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">{t.settings.users.admin}</SelectItem>
                                <SelectItem value="user">{t.settings.users.user}</SelectItem>
                              </SelectContent>
                            </Select>

                            {user.role !== "admin" && organizationRoles.length > 0 && (
                              <Select
                                value={customRole?.id || "none"}
                                onValueChange={(value) => handleAssignRole(user.id, value === "none" ? null : value)}
                                disabled={user.id === profile?.id}
                              >
                                <SelectTrigger className="h-8 w-28 text-xs">
                                  <SelectValue placeholder="Funcao..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Sem funcao</SelectItem>
                                  {organizationRoles.map((role) => (
                                    <SelectItem key={role.id} value={role.id}>
                                      <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: role.color }} />
                                        {role.name}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}

                            <Switch
                              checked={user.is_active || false}
                              onCheckedChange={() => handleToggleUserActive(user.id, user.is_active || false)}
                              disabled={user.id === profile?.id}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setUserToDelete({ id: user.id, name: user.name });
                                setDeleteUserDialogOpen(true);
                              }}
                              disabled={user.id === profile?.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                            {roleLabel(user.role)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}

                {isAdmin &&
                  invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="flex items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3 opacity-85"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{invitation.email || "Convite sem e-mail"}</p>
                          <Badge variant="secondary" className="border-0 bg-primary/10 text-xs text-primary">
                            Pendente
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {roleLabel(invitation.role)} - expira em {new Date(invitation.expires_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => deleteInvitation.mutate(invitation.id)}
                        disabled={deleteInvitation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {isAdmin && <RolesTab />}
      </div>

      <AlertDialog open={deleteUserDialogOpen} onOpenChange={setDeleteUserDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuario</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o usuario <strong>{userToDelete?.name}</strong>? Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingUser}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deletingUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
