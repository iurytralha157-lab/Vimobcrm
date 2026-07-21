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
import { useCreateInvitation, useDeleteInvitation, useInvitations, useResendInvitation } from '@/hooks/use-invitations';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { canManageOrganization } from '@/lib/access/organization';
import { useUserPermissions } from '@/hooks/use-user-permissions';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

export function TeamTab() {
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { hasPermission } = useUserPermissions();
  
  const { data: users = [], isLoading: usersLoading } = useOrganizationUsers();
  const { data: invitations = [], isLoading: invitationsLoading } = useInvitations();
  
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

  // Invitation state for new user
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  const canManageUsers = isAdmin || hasPermission('users_manage');
  const canManagePermissions = isAdmin || hasPermission('permissions_manage');
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

  useEffect(() => {
    if (!canManageUsers) return;

    const handleMobileCreate = () => setUserDialogOpen(true);
    window.addEventListener('vimob:mobile-create-user', handleMobileCreate);
    return () => window.removeEventListener('vimob:mobile-create-user', handleMobileCreate);
  }, [canManageUsers]);

  // Helper para obter a função customizada de um usuário
  const handleToggleUserActive = async (userId: string, currentValue: boolean) => {
    await updateUser.mutateAsync({ id: userId, is_active: !currentValue });
  };

  const handleUpdateUserRole = async (userId: string, role: 'admin' | 'user') => {
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
              <CardTitle className="text-xl font-semibold text-foreground">{t.settings.users.title}</CardTitle>
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
                    className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-none border-2 border-primary/20 hover:scale-105 transition-all duration-200"
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
                        <Select value={newUserRole} onValueChange={v => setNewUserRole(v as 'admin' | 'user')}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">{t.settings.users.admin}</SelectItem>
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
            ) : (
              <div data-tour="team-users-list" className="space-y-3">
                {pendingInvitations.map((invitation) => {
                  const isExpired = invitation.is_expired === true;
                  const isResending = resendInvitation.isPending && resendInvitation.variables === invitation.id;
                  const isDeleting = deleteInvitation.isPending && deleteInvitation.variables === invitation.id;

                  return (
                    <div
                      key={`invitation-${invitation.id}`}
                      className="flex items-center justify-between p-3 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-amber-500 text-white text-sm">
                            <Mail className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="truncate text-sm font-medium">{invitation.email || 'Convite sem e-mail'}</p>
                            <Badge
                              variant="outline"
                              className={isExpired
                                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'}
                            >
                              {isExpired ? 'Expirado' : 'Pendente'}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Convite enviado como {invitation.role === 'admin' ? t.settings.users.admin : t.settings.users.user}
                            {!isExpired && ` · válido até ${new Intl.DateTimeFormat('pt-BR').format(new Date(invitation.expires_at))}`}
                          </p>
                        </div>
                      </div>
                      {canManageUsers && (
                        <div className="ml-3 flex shrink-0 items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5"
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
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => deleteInvitation.mutate(invitation.id)}
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
                    className="flex items-center justify-between p-3 rounded-lg border-0 bg-muted/40 hover:bg-muted/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={user.avatar_url || undefined} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                          {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {canManagePermissions ? (
                            <Link href={`/settings/users/${user.id}`} className="text-sm font-medium hover:underline">
                              {user.name}
                            </Link>
                          ) : (
                            <p className="text-sm font-medium">{user.name}</p>
                          )}
                          {!user.is_active && (
                            <Badge variant="secondary" className="text-xs">{t.common.inactive}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {canManageUsers ? (
                        <>
                          {/* Tipo de usuÃ¡rio (admin/user) */}
                          <Select 
                            value={user.role ?? 'user'} 
                            onValueChange={v => handleUpdateUserRole(user.id, v as 'admin' | 'user')} 
                            disabled={user.id === profile?.id}
                          >
                            <SelectTrigger data-tour="team-user-role" className="w-24 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">{t.settings.users.admin}</SelectItem>
                              <SelectItem value="user">{t.settings.users.user}</SelectItem>
                            </SelectContent>
                          </Select>
                          
                          {canManagePermissions && (
                            <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Editar permissoes">
                              <Link href={`/settings/users/${user.id}`} aria-label={`Editar permissoes de ${user.name}`}>
                                <ShieldCheck className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                          
                          <Switch
                            data-tour="team-user-active"
                            checked={user.is_active || false} 
                            onCheckedChange={() => handleToggleUserActive(user.id, user.is_active || false)} 
                            disabled={user.id === profile?.id} 
                          />
                          <Button
                            data-tour="team-user-delete"
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" 
                            onClick={() => {
                              setUserToDelete({ id: user.id, name: user.name });
                              setTransferLeadsToUserId('');
                              setTransferPropertiesToUserId('');
                              setDeleteUserDialogOpen(true);
                            }} 
                            disabled={user.id === profile?.id}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                            {user.role === 'admin' ? t.settings.users.admin : t.settings.users.user}
                          </Badge>
                          {canManagePermissions && (
                            <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Editar permissoes">
                              <Link href={`/settings/users/${user.id}`} aria-label={`Editar permissoes de ${user.name}`}>
                                <ShieldCheck className="h-4 w-4" />
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
                  <p className="text-lg font-semibold">{impactLeads}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Imóveis</p>
                  <p className="text-lg font-semibold">{impactProperties}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">WhatsApp</p>
                  <p className="text-lg font-semibold">{impactWhatsAppSessions}</p>
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
              onClick={handleDeleteUser}
              disabled={!canConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingUser && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
