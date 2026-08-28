import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Plus, 
  Trash2, 
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeleteUser, useDeleteUserImpact, useOrganizationUsers, useUpdateUser } from '@/hooks/use-users';
import { useCreateInvitation, useDeleteInvitation, useInvitations, useResendInvitation, type Invitation } from '@/hooks/use-invitations';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { canManageOrganization } from '@/lib/access/organization';
import { useUserPermissions } from '@/hooks/use-user-permissions';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

type OrganizationMemberRole = 'admin' | 'manager' | 'user';

export function TeamTab() {
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { hasPermission } = useUserPermissions();
  const roleLabel = (role: string) => {
    if (role === 'admin' || role === 'owner') return t.settings.users.admin;
    if (role === 'manager') return t.settings.users.manager;
    return t.settings.users.user;
  };
  
  const {
    data: users = [],
    isLoading: usersLoading,
    isError: usersFailed,
    refetch: refetchUsers,
  } = useOrganizationUsers();
  const {
    data: invitations = [],
    isLoading: invitationsLoading,
    isError: invitationsFailed,
    refetch: refetchInvitations,
  } = useInvitations();
  
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const deleteInvitation = useDeleteInvitation();
  const createInvitation = useCreateInvitation();
  const resendInvitation = useResendInvitation();

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [transferLeadsToUserId, setTransferLeadsToUserId] = useState<string>('');
  const [transferPropertiesToUserId, setTransferPropertiesToUserId] = useState<string>('');
  const [invitationToDelete, setInvitationToDelete] = useState<Invitation | null>(null);
  const [userToDeactivate, setUserToDeactivate] = useState<{ id: string; name: string } | null>(null);

  // Invitation state for new user
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<OrganizationMemberRole>('user');

  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  const canManageUsers = isAdmin || hasPermission('users_manage');
  const canManagePermissions = isAdmin || hasPermission('permissions_manage');
  const canManageAdminRole = isAdmin && canManagePermissions;
  const { data: deleteImpact, isLoading: deleteImpactLoading, isError: deleteImpactFailed } = useDeleteUserImpact(
    userToDelete?.id,
    deleteUserDialogOpen && !!userToDelete,
  );
  const transferCandidates = users.filter(
    (user) => user.id !== userToDelete?.id && user.is_active && user.role !== 'super_admin',
  );
  const impactLeads = deleteImpact?.leads ?? 0;
  const impactProperties = deleteImpact?.properties ?? 0;
  const impactWhatsAppSessions = deleteImpact?.whatsapp_sessions ?? 0;
  const requiresLeadTransfer = impactLeads > 0;
  const requiresPropertyTransfer = impactProperties > 0;
  const canConfirmDelete =
    !deleteImpactLoading &&
    !deleteImpactFailed &&
    !deletingUser &&
    (!requiresLeadTransfer || !!transferLeadsToUserId) &&
    (!requiresPropertyTransfer || !!transferPropertiesToUserId);
  const pendingInvitations = invitations.filter((invitation) => !invitation.used_at);
  const recentAcceptedInvitations = invitations
    .filter((invitation) => !!invitation.used_at)
    .slice(0, 5);
  const visibleInvitations = [...pendingInvitations, ...recentAcceptedInvitations];

  useEffect(() => {
    if (!canManageUsers) return;

    const handleMobileCreate = () => setUserDialogOpen(true);
    window.addEventListener('vimob:mobile-create-user', handleMobileCreate);
    return () => window.removeEventListener('vimob:mobile-create-user', handleMobileCreate);
  }, [canManageUsers]);

  // Helper para obter a função customizada de um usuário
  const handleToggleUserActive = async (userId: string, currentValue: boolean) => {
    try {
      await updateUser.mutateAsync({ id: userId, is_active: !currentValue });
    } catch {
      // The mutation already shows the API error and the controlled switch keeps its server state.
    }
  };

  const handleDeactivateUser = async () => {
    if (!userToDeactivate) return;
    try {
      await updateUser.mutateAsync({ id: userToDeactivate.id, is_active: false });
      setUserToDeactivate(null);
    } catch {
      // The mutation already shows the API error; keep the confirmation open for retry.
    }
  };

  const handleUpdateUserRole = async (userId: string, role: OrganizationMemberRole) => {
    if (role !== 'user' && !canManageAdminRole) {
      toast.error('Você não tem permissão para atribuir um papel privilegiado.');
      return;
    }
    await updateUser.mutateAsync({ id: userId, role });
    await queryClient.invalidateQueries({ queryKey: ['organization-users'] });
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    if (requiresLeadTransfer && !transferLeadsToUserId) {
      toast.error('Escolha para quem transferir os leads antes de excluir.');
      return;
    }
    if (requiresPropertyTransfer && !transferPropertiesToUserId) {
      toast.error('Escolha para quem transferir os imóveis antes de excluir.');
      return;
    }

    setDeletingUser(true);
    try {
      await deleteUser.mutateAsync({
        userId: userToDelete.id,
        transferLeadsToUserId: transferLeadsToUserId || null,
        transferPropertiesToUserId: transferPropertiesToUserId || null,
      });
      toast.success('Usuário excluído com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      setDeleteUserDialogOpen(false);
      setUserToDelete(null);
      setTransferLeadsToUserId('');
      setTransferPropertiesToUserId('');
    } catch (error: unknown) {
      toast.error('Erro ao excluir usuário: ' + getErrorMessage(error, 'Erro desconhecido'));
    } finally {
      setDeletingUser(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUserEmail.trim()) {
      toast.error('Informe o e-mail do convite');
      return;
    }
    if (newUserRole !== 'user' && !canManageAdminRole) {
      toast.error('Você não tem permissão para convidar um papel privilegiado.');
      return;
    }
    try {
      await createInvitation.mutateAsync({
        email: newUserEmail.trim(),
        role: newUserRole,
      });
      setUserDialogOpen(false);
      resetNewUserForm();
    } catch (error: unknown) {
      console.error('[TeamTab] invitation failed', error);
    }
  };

  const handleDeleteInvitation = async () => {
    if (!invitationToDelete) return;
    try {
      await deleteInvitation.mutateAsync(invitationToDelete.id);
      setInvitationToDelete(null);
    } catch {
      // The mutation already shows the API error; keep the dialog open for retry.
    }
  };

  const resetNewUserForm = () => {
    setNewUserEmail('');
    setNewUserRole('user');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        {/* LEFT: Users List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-[14px] font-normal text-foreground">{t.settings.users.title}</CardTitle>
              <CardDescription className="mt-0.5 text-sm text-muted-foreground">{t.settings.users.description}</CardDescription>
            </div>
            {canManageUsers && (
              <Sheet open={userDialogOpen} onOpenChange={(open) => {
                setUserDialogOpen(open);
                if (!open) resetNewUserForm();
              }}>
                <SheetTrigger asChild>
                  <Button 
                    data-tour="team-add-user" 
                    size="sm"
                    className="rounded-[6px] border-0 bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t.settings.users.newUser}
                  </Button>
                </SheetTrigger>
                <SheetContent data-tour="team-invite-dialog" side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>Convidar usuário</SheetTitle>
                    <SheetDescription className="sr-only">
                      Envie um convite para adicionar um usuário à organização.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t.common.email}</Label>
                        <Input 
                          type="email" 
                          placeholder="email@company.com" 
                          value={newUserEmail} 
                          onChange={e => setNewUserEmail(e.target.value)} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.settings.users.role}</Label>
                        <Select
                          value={canManageAdminRole ? newUserRole : 'user'}
                          onValueChange={v => setNewUserRole(v as OrganizationMemberRole)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {canManageAdminRole && (
                              <SelectItem value="admin">{t.settings.users.admin}</SelectItem>
                            )}
                            {canManageAdminRole && (
                              <SelectItem value="manager">{t.settings.users.manager}</SelectItem>
                            )}
                            <SelectItem value="user">{t.settings.users.user}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs text-foreground">
                        A pessoa receberá um <strong>convite por e-mail</strong> para criar o próprio acesso.
                        Nenhuma senha pronta será gerada ou compartilhada.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button variant="outline" onClick={() => setUserDialogOpen(false)} disabled={createInvitation.isPending}>
                        {t.common.cancel}
                      </Button>
                      <Button onClick={handleCreateUser} disabled={createInvitation.isPending || !newUserEmail.trim()}>
                        {createInvitation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Enviar convite
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </CardHeader>
          <CardContent className="px-4 md:px-6 pb-4">
            {usersLoading || invitationsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : usersFailed || invitationsFailed ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
                <p>Não foi possível carregar usuários e convites desta organização.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void Promise.all([refetchUsers(), refetchInvitations()])}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <div data-tour="team-users-list" className="space-y-3">
                {visibleInvitations.map((invitation) => {
                  const isAccepted = !!invitation.used_at;
                  const isExpired = invitation.is_expired === true;
                  const isResending = resendInvitation.isPending && resendInvitation.variables === invitation.id;
                  const isDeleting = deleteInvitation.isPending && deleteInvitation.variables === invitation.id;
                  const emailDeliveryLabel = (() => {
                    switch (invitation.email_status) {
                      case 'delivered':
                        return 'E-mail entregue';
                      case 'accepted':
                      case 'sent':
                        return 'E-mail aceito pelo provedor';
                      case 'delayed':
                        return 'Entrega do e-mail atrasada pelo provedor';
                      case 'failed':
                      case 'suppressed':
                      case 'bounced':
                        return 'Falha confirmada na entrega do e-mail';
                      case 'complained':
                        return 'E-mail entregue e marcado como spam';
                      case 'processing':
                        return 'Envio do e-mail em processamento';
                      default:
                        return 'Envio do e-mail sem confirmação';
                    }
                  })();

                  return (
                    <div
                      key={`invitation-${invitation.id}`}
                      className={isAccepted
                        ? 'flex min-w-0 items-center justify-between gap-2 rounded-[6px] border-0 bg-emerald-500/5 p-3'
                        : 'flex min-w-0 items-center justify-between gap-2 rounded-[6px] border-0 bg-amber-500/5 p-3'}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        <Avatar className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
                          <AvatarFallback className={isAccepted ? 'bg-emerald-500 text-white text-sm' : 'bg-amber-500 text-white text-sm'}>
                            <Mail className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                            <p className="truncate text-sm font-medium">{invitation.email || 'Convite sem e-mail'}</p>
                            <Badge
                              variant="secondary"
                              className={isAccepted
                                ? 'shrink-0 rounded-[6px] border-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                                : isExpired
                                ? 'shrink-0 rounded-[6px] border-0 bg-destructive/10 text-destructive'
                                : 'shrink-0 rounded-[6px] border-0 bg-amber-500/10 text-amber-700 dark:text-amber-200'}
                            >
                              {isAccepted ? 'Aceito' : isExpired ? 'Expirado' : 'Pendente'}
                            </Badge>
                          </div>
                          <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
                            Convite enviado como {roleLabel(invitation.role)}
                            {isAccepted
                              ? ` · aceito em ${new Intl.DateTimeFormat('pt-BR').format(new Date(invitation.used_at as string))}`
                              : !isExpired && ` · válido até ${new Intl.DateTimeFormat('pt-BR').format(new Date(invitation.expires_at))}`}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
                            {emailDeliveryLabel}
                          </p>
                        </div>
                      </div>
                      {canManageUsers && !isAccepted && (!['admin', 'manager'].includes(invitation.role) || canManageAdminRole) && (
                        <div className="ml-3 flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 gap-1.5 rounded-[6px] border-0 bg-background/80 p-0 shadow-none hover:bg-[var(--app-surface-hover)] sm:w-auto sm:px-3"
                            onClick={() => resendInvitation.mutate(invitation.id)}
                            disabled={resendInvitation.isPending || deleteInvitation.isPending || !invitation.email}
                            title="Gerar um novo link e renovar a validade por 7 dias"
                            aria-label={`Reenviar convite para ${invitation.email || 'usuário'}`}
                          >
                            {isResending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            <span className="hidden sm:inline">Reenviar</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-[6px] border-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setInvitationToDelete(invitation)}
                            disabled={deleteInvitation.isPending || resendInvitation.isPending}
                            aria-label="Cancelar convite"
                          >
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {users.filter(user => user.role !== 'super_admin').map(user => (
                  <div 
                    key={user.id} 
                    className="flex min-w-0 items-center gap-2 rounded-[6px] border-0 bg-muted/40 p-2.5 transition-colors hover:bg-muted/60 sm:gap-3 sm:p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                      <Avatar className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
                        <AvatarImage src={user.avatar_url || undefined} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                          {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                          <p className="truncate text-sm font-medium">{user.name}</p>
                          {!user.is_active && (
                            <Badge variant="secondary" className="hidden shrink-0 rounded-[6px] border-0 text-xs sm:inline-flex">
                              {t.common.inactive}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-[10px] leading-tight text-muted-foreground sm:text-xs sm:leading-normal">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center justify-end gap-0.5 sm:gap-2">
                      {canManageUsers && (!['admin', 'manager', 'owner'].includes(user.role) || canManageAdminRole) ? (
                        <>
                          {/* Tipo de usuÃ¡rio (admin/user) */}
                          {canManageAdminRole ? (
                            <Select
                              value={user.role ?? 'user'}
                              onValueChange={v => handleUpdateUserRole(user.id, v as OrganizationMemberRole)}
                              disabled={user.id === profile?.id}
                            >
                              <SelectTrigger data-tour="team-user-role" className="hidden h-8 w-24 text-xs sm:flex">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">{t.settings.users.admin}</SelectItem>
                                <SelectItem value="manager">{t.settings.users.manager}</SelectItem>
                                <SelectItem value="user">{t.settings.users.user}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary" className="hidden rounded-[6px] border-0 sm:inline-flex">
                              {roleLabel(user.role)}
                            </Badge>
                          )}
                          
                          {canManagePermissions && (
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 font-medium text-foreground shadow-none hover:bg-[var(--app-surface-hover)] sm:w-auto sm:px-3"
                              title="Editar permissões"
                            >
                              <Link href={`/settings/users/${user.id}`} aria-label={`Editar permissoes de ${user.name}`}>
                                <ShieldCheck className="h-4 w-4 sm:hidden" />
                                <span className="hidden text-xs sm:inline">Permissões</span>
                              </Link>
                            </Button>
                          )}
                          
                          <div className="-mx-1 flex shrink-0 sm:mx-0">
                            <Switch
                              data-tour="team-user-active"
                              className="scale-[0.85] sm:scale-100"
                              checked={user.is_active || false}
                              onCheckedChange={(checked) => {
                                if (!checked) {
                                  setUserToDeactivate({ id: user.id, name: user.name });
                                  return;
                                }
                                void handleToggleUserActive(user.id, false);
                              }}
                              disabled={user.id === profile?.id || updateUser.isPending}
                              aria-label={`${user.is_active ? 'Desativar' : 'Ativar'} ${user.name}`}
                            />
                          </div>
                          <Button
                            data-tour="team-user-delete"
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 rounded-[6px] border-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setUserToDelete({ id: user.id, name: user.name });
                              setTransferLeadsToUserId('');
                              setTransferPropertiesToUserId('');
                              setDeleteUserDialogOpen(true);
                            }} 
                            disabled={user.id === profile?.id}
                            aria-label={`Excluir ${user.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-0.5 sm:gap-2">
                          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="hidden rounded-[6px] border-0 sm:inline-flex">
                            {roleLabel(user.role)}
                          </Badge>
                          {canManagePermissions && (
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-0 font-medium text-foreground shadow-none hover:bg-[var(--app-surface-hover)] sm:w-auto sm:px-3"
                              title="Editar permissões"
                            >
                              <Link href={`/settings/users/${user.id}`} aria-label={`Editar permissoes de ${user.name}`}>
                                <ShieldCheck className="h-4 w-4 sm:hidden" />
                                <span className="hidden text-xs sm:inline">Permissões</span>
                              </Link>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: Roles (only for admins) */}
      </div>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog
        open={deleteUserDialogOpen}
        onOpenChange={(open) => {
          if (!open && deletingUser) return;
          setDeleteUserDialogOpen(open);
          if (!open) {
            setUserToDelete(null);
            setTransferLeadsToUserId('');
            setTransferPropertiesToUserId('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
            <AlertDialogDescription>
              Antes de excluir <strong>{userToDelete?.name}</strong>, revise o que precisa ser transferido. O
              histórico de leads e imóveis continua intacto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            {deleteImpactLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando impacto do usuário...
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Leads</p>
                  <p className="text-[20px] font-normal">{impactLeads}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Imóveis</p>
                  <p className="text-[20px] font-normal">{impactProperties}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">WhatsApp</p>
                  <p className="text-[20px] font-normal">{impactWhatsAppSessions}</p>
                </div>
              </div>
            )}

            {requiresLeadTransfer && (
              <div className="space-y-2">
                <Label>Transferir leads para</Label>
                <Select value={transferLeadsToUserId} onValueChange={setTransferLeadsToUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    {transferCandidates.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {requiresPropertyTransfer && (
              <div className="space-y-2">
                <Label>Transferir imóveis para</Label>
                <Select value={transferPropertiesToUserId} onValueChange={setTransferPropertiesToUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    {transferCandidates.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {(requiresLeadTransfer || requiresPropertyTransfer) && transferCandidates.length === 0 && (
              <p className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                Não há outro usuário ativo para receber leads ou imóveis. Ative ou crie um usuário antes de excluir.
              </p>
            )}

            {impactWhatsAppSessions > 0 && (
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-200">
                As conexões WhatsApp deste usuário serão desconectadas. Elas não serão transferidas.
              </p>
            )}
            {deleteImpactFailed && (
              <p className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                Não foi possível calcular o impacto deste usuário. Tente novamente antes de excluir.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingUser}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteUser();
              }}
              disabled={!canConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingUser && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!userToDeactivate}
        onOpenChange={(open) => !open && !updateUser.isPending && setUserToDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{userToDeactivate?.name}</strong> perderá o acesso ao CRM até ser ativado novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateUser.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeactivateUser();
              }}
              disabled={updateUser.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {updateUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desativar usuário
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!invitationToDelete} onOpenChange={(open) => !open && !deleteInvitation.isPending && setInvitationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite?</AlertDialogTitle>
            <AlertDialogDescription>
              O convite enviado para <strong>{invitationToDelete?.email || 'este usuário'}</strong> deixará de ser válido imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInvitation.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteInvitation();
              }}
              disabled={deleteInvitation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteInvitation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancelar convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
