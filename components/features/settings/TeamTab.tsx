import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  Minus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeleteUser, useDeleteUserImpact, useOrganizationUsers, useUpdateUser } from '@/hooks/use-users';
import { useCreateInvitations, useDeleteInvitation, useInvitations, useResendInvitation, useUpdateInvitation, type Invitation } from '@/hooks/use-invitations';
import { toast } from 'sonner';
import { canManageOrganization } from '@/lib/access/organization';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import {
  MAX_ORGANIZATION_INVITATIONS_PER_BATCH,
  organizationInvitationBatchSchema,
} from '@/lib/validation';
import { getOrganizationMemberRoleLabel } from '@/lib/user-display';
import { normalizeSearchText } from '@/lib/search-text';
import { getErrorMessageOrFallback as getErrorMessage } from '@/lib/api/vimob-error';

type OrganizationMemberRole = 'admin' | 'manager' | 'user';

interface InvitationDraft {
  id: number;
  email: string;
  role: OrganizationMemberRole;
}

const createInvitationDraft = (id: number): InvitationDraft => ({
  id,
  email: '',
  role: 'user',
});

export function TeamTab({ search = '' }: { search?: string }) {
  const { activeOrganization, profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const { hasPermission } = useUserPermissions();
  const activeOrganizationId = activeOrganization.organizationId;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  const canManageUsers = isAdmin || hasPermission('users_manage');
  const canManagePermissions = isAdmin || hasPermission('permissions_manage');
  const canManageAdminRole = isAdmin && canManagePermissions;
  const roleLabel = (role: string) => {
    if (role === 'owner') return getOrganizationMemberRoleLabel(role);
    if (role === 'admin') return t.settings.users.admin;
    if (role === 'manager') return t.settings.users.manager;
    return t.settings.users.user;
  };
  
  const {
    data: invitations = [],
    isLoading: invitationsLoading,
    isError: invitationsFailed,
    refetch: refetchInvitations,
  } = useInvitations({ enabled: canManageUsers });
  
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const deleteInvitation = useDeleteInvitation();
  const createInvitations = useCreateInvitations();
  const resendInvitation = useResendInvitation();
  const updateInvitation = useUpdateInvitation();

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [transferLeadsToUserId, setTransferLeadsToUserId] = useState<string>('');
  const [transferPropertiesToUserId, setTransferPropertiesToUserId] = useState<string>('');
  const [invitationToDelete, setInvitationToDelete] = useState<Invitation | null>(null);
  const [userToDeactivate, setUserToDeactivate] = useState<{ id: string; name: string } | null>(null);

  const nextInvitationDraftId = useRef(1);
  const [invitationDrafts, setInvitationDrafts] = useState<InvitationDraft[]>([
    createInvitationDraft(0),
  ]);
  const [invitationErrors, setInvitationErrors] = useState<Record<number, string>>({});

  const {
    data: users = [],
    isLoading: usersLoading,
    isError: usersFailed,
    refetch: refetchUsers,
  } = useOrganizationUsers({
    scope: canManageUsers ? 'management' : 'active',
  });
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
  const normalizedSearch = normalizeSearchText(search);
  const pendingInvitations = canManageUsers
    ? invitations.filter((invitation) => {
        if (invitation.used_at || invitation.is_expired === true) return false;
        if (!normalizedSearch) return true;
        return normalizeSearchText([
          invitation.email ?? '',
          roleLabel(invitation.role),
          'pendente',
        ].join(' ')).includes(normalizedSearch);
      })
    : [];
  const visibleUsers = users.filter((user) => {
    if (user.role === 'super_admin') return false;
    if (!normalizedSearch) return true;
    return normalizeSearchText([
      user.name,
      user.email ?? '',
      roleLabel(user.role),
      user.is_active ? 'ativo' : 'inativo desativado',
    ].join(' ')).includes(normalizedSearch);
  });
  const hasManagedUsersOrInvitations =
    users.some((user) => user.role !== 'super_admin') ||
    (canManageUsers && invitations.some(
      (invitation) => !invitation.used_at && invitation.is_expired !== true,
    ));

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

  const handleCreateInvitations = async () => {
    const parsedInvitations = organizationInvitationBatchSchema.safeParse(
      invitationDrafts.map((draft) => ({
        email: draft.email,
        role: draft.role,
      })),
    );

    if (!parsedInvitations.success) {
      const errors: Record<number, string> = {};
      parsedInvitations.error.issues.forEach((issue) => {
        const draftIndex = typeof issue.path[0] === 'number' ? issue.path[0] : null;
        const draft = draftIndex === null ? null : invitationDrafts[draftIndex];
        if (draft && !errors[draft.id]) errors[draft.id] = issue.message;
      });
      setInvitationErrors(errors);
      toast.error(parsedInvitations.error.issues[0]?.message || 'Revise os convites antes de enviar.');
      return;
    }

    if (
      parsedInvitations.data.some((invitation) => invitation.role !== 'user') &&
      !canManageAdminRole
    ) {
      toast.error('Você não tem permissão para convidar um papel privilegiado.');
      return;
    }

    setInvitationErrors({});
    try {
      const result = await createInvitations.mutateAsync(parsedInvitations.data);

      if (result.failures.length > 0) {
        const failuresByEmail = new Map(
          result.failures.map((failure) => [
            failure.input.email.toLowerCase(),
            failure.message,
          ]),
        );
        const failedDrafts = invitationDrafts.filter((draft) =>
          failuresByEmail.has(draft.email.trim().toLowerCase()),
        );
        setInvitationDrafts(failedDrafts);
        setInvitationErrors(Object.fromEntries(
          failedDrafts.map((draft) => [
            draft.id,
            failuresByEmail.get(draft.email.trim().toLowerCase()) ||
              'Não foi possível criar este convite.',
          ]),
        ));
        return;
      }

      setUserDialogOpen(false);
      resetNewUserForm();
    } catch (error: unknown) {
      console.error('[TeamTab] invitation batch failed', error);
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
    nextInvitationDraftId.current = 1;
    setInvitationDrafts([createInvitationDraft(0)]);
    setInvitationErrors({});
  };

  const updateInvitationDraft = (
    draftId: number,
    changes: Partial<Pick<InvitationDraft, 'email' | 'role'>>,
  ) => {
    setInvitationDrafts((current) => current.map((draft) => (
      draft.id === draftId ? { ...draft, ...changes } : draft
    )));
    setInvitationErrors((current) => {
      if (!current[draftId]) return current;
      const next = { ...current };
      delete next[draftId];
      return next;
    });
  };

  const addInvitationDraft = () => {
    setInvitationDrafts((current) => {
      if (current.length >= MAX_ORGANIZATION_INVITATIONS_PER_BATCH) return current;
      const nextDraft = createInvitationDraft(nextInvitationDraftId.current);
      nextInvitationDraftId.current += 1;
      return [...current, nextDraft];
    });
  };

  const removeInvitationDraft = (draftId: number) => {
    setInvitationDrafts((current) => current.filter((draft) => draft.id !== draftId));
    setInvitationErrors((current) => {
      if (!current[draftId]) return current;
      const next = { ...current };
      delete next[draftId];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        {/* LEFT: Users List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-[14px] font-normal text-foreground">{t.settings.users.title}</CardTitle>
            {canManageUsers && (
              <Dialog
                open={userDialogOpen}
                onOpenChange={(open) => {
                  if (!open && createInvitations.isPending) return;
                  setUserDialogOpen(open);
                  if (!open) resetNewUserForm();
                }}
              >
                <DialogTrigger asChild>
                  <Button 
                    data-tour="team-add-user" 
                    size="sm"
                    className="rounded-[6px] border-0 bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t.settings.users.newUser}
                  </Button>
                </DialogTrigger>
                <DialogContent
                  data-tour="team-invite-dialog"
                  className="max-h-[90vh] w-[calc(100%_-_2rem)] max-w-[640px] overflow-y-auto rounded-[8px]"
                >
                  <DialogHeader>
                    <DialogTitle>Convidar usuário</DialogTitle>
                    <DialogDescription>
                      Adicione uma ou mais pessoas e escolha o perfil inicial de cada uma.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="space-y-4"
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleCreateInvitations();
                    }}
                  >
                    <div className="max-h-[min(52vh,430px)] space-y-3 overflow-y-auto pr-1">
                      {invitationDrafts.map((draft, index) => {
                        const emailInputId = `team-invite-email-${draft.id}`;
                        const roleInputId = `team-invite-role-${draft.id}`;
                        const errorId = `team-invite-error-${draft.id}`;

                        return (
                          <div
                            key={draft.id}
                            className="rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-3"
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-xs font-medium text-foreground">
                                Convite {index + 1}
                              </p>
                              {invitationDrafts.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 rounded-[6px] text-muted-foreground hover:bg-background hover:text-foreground"
                                  onClick={() => removeInvitationDraft(draft.id)}
                                  disabled={createInvitations.isPending}
                                  aria-label={`Remover convite ${index + 1}`}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                              <div className="space-y-2">
                                <Label htmlFor={emailInputId}>E-mail {index + 1}</Label>
                                <Input
                                  id={emailInputId}
                                  type="email"
                                  autoComplete="off"
                                  placeholder="email@empresa.com"
                                  value={draft.email}
                                  onChange={(event) => updateInvitationDraft(draft.id, {
                                    email: event.target.value,
                                  })}
                                  disabled={createInvitations.isPending}
                                  aria-invalid={Boolean(invitationErrors[draft.id])}
                                  aria-describedby={invitationErrors[draft.id] ? errorId : undefined}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={roleInputId}>{t.settings.users.role}</Label>
                                <Select
                                  value={canManageAdminRole ? draft.role : 'user'}
                                  onValueChange={(value) => updateInvitationDraft(draft.id, {
                                    role: value as OrganizationMemberRole,
                                  })}
                                  disabled={createInvitations.isPending}
                                >
                                  <SelectTrigger id={roleInputId}>
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
                            {invitationErrors[draft.id] && (
                              <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">
                                {invitationErrors[draft.id]}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-[6px] bg-[var(--app-surface-soft)] text-xs shadow-none hover:bg-[var(--app-surface-hover)]"
                        onClick={addInvitationDraft}
                        disabled={
                          createInvitations.isPending ||
                          invitationDrafts.length >= MAX_ORGANIZATION_INVITATIONS_PER_BATCH
                        }
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Adicionar outro usuário
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {invitationDrafts.length}/{MAX_ORGANIZATION_INVITATIONS_PER_BATCH} convites
                      </span>
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs text-foreground">
                        Cada pessoa receberá um <strong>convite por e-mail</strong> para criar o próprio acesso.
                        Nenhuma senha pronta será gerada ou compartilhada.
                      </p>
                    </div>
                    <DialogFooter className="gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-10 min-w-28 rounded-[6px] bg-[var(--app-surface-soft)] text-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                        onClick={() => {
                          setUserDialogOpen(false);
                          resetNewUserForm();
                        }}
                        disabled={createInvitations.isPending}
                      >
                        {t.common.cancel}
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          createInvitations.isPending ||
                          invitationDrafts.some((draft) => !draft.email.trim())
                        }
                      >
                        {createInvitations.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {createInvitations.isPending
                          ? 'Enviando convites...'
                          : invitationDrafts.length === 1
                            ? 'Enviar convite'
                            : `Enviar ${invitationDrafts.length} convites`}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent className="px-4 md:px-6 pb-4">
            {usersLoading || (canManageUsers && invitationsLoading) ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : usersFailed || (canManageUsers && invitationsFailed) ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
                <p>Não foi possível carregar usuários e convites desta organização.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void (
                    canManageUsers
                      ? Promise.all([refetchUsers(), refetchInvitations()])
                      : refetchUsers()
                  )}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <section
                data-tour="team-users-list"
                aria-label="Usuários e convites pendentes da organização"
                className="space-y-3"
              >
                  {visibleUsers.length === 0 && pendingInvitations.length === 0 ? (
                    <div className="rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-8 text-center text-sm text-muted-foreground">
                      {normalizedSearch && hasManagedUsersOrInvitations
                        ? 'Nenhum usuário ou convite encontrado para esta busca.'
                        : 'Nenhum usuário vinculado a esta organização.'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {pendingInvitations.map((invitation) => {
                        const isResending =
                          resendInvitation.isPending &&
                          resendInvitation.variables === invitation.id;
                        const isDeleting =
                          deleteInvitation.isPending &&
                          deleteInvitation.variables === invitation.id;
                        const canManageInvitation =
                          canManageUsers &&
                          (!['admin', 'manager'].includes(invitation.role) || canManageAdminRole);

                        return (
                          <article
                            key={`invitation-${invitation.id}`}
                            className="flex min-h-[180px] min-w-0 flex-col rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-4 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
                          >
                            <div className="flex min-w-0 items-start gap-3">
                              <Avatar className="h-12 w-12 shrink-0 rounded-[8px] bg-[var(--app-surface-soft)]">
                                <AvatarFallback className="rounded-[8px] bg-amber-500 text-sm text-white">
                                  <Mail className="h-4 w-4" />
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {invitation.email || 'Convite sem e-mail'}
                                </p>
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  Válido até{' '}
                                  {new Intl.DateTimeFormat('pt-BR').format(
                                    new Date(invitation.expires_at),
                                  )}
                                </p>
                              </div>
                              <Badge
                                variant="secondary"
                                className="shrink-0 rounded-[6px] border-0 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-200"
                              >
                                Pendente
                              </Badge>
                            </div>

                            <div className="mt-4">
                              {canManageAdminRole ? (
                                <Select
                                  value={invitation.role}
                                  onValueChange={(value) => updateInvitation.mutate({
                                    id: invitation.id,
                                    role: value as OrganizationMemberRole,
                                  })}
                                  disabled={
                                    updateInvitation.isPending ||
                                    resendInvitation.isPending ||
                                    deleteInvitation.isPending
                                  }
                                >
                                  <SelectTrigger
                                    className="h-9 w-full rounded-[6px] text-xs"
                                    aria-label={`Perfil do convite para ${invitation.email || 'usuário'}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-[8px]">
                                    <SelectItem className="mb-1 rounded-[6px]" value="admin">
                                      {t.settings.users.admin}
                                    </SelectItem>
                                    <SelectItem className="mb-1 rounded-[6px]" value="manager">
                                      {t.settings.users.manager}
                                    </SelectItem>
                                    <SelectItem className="rounded-[6px]" value="user">
                                      {t.settings.users.user}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge variant="secondary" className="rounded-[6px] border-0">
                                  {roleLabel(invitation.role)}
                                </Badge>
                              )}
                            </div>

                            {canManageInvitation && (
                              <div className="mt-auto flex items-center gap-2 pt-4">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-9 min-w-0 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-xs font-medium text-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                                  onClick={() => resendInvitation.mutate(invitation.id)}
                                  disabled={
                                    updateInvitation.isPending ||
                                    resendInvitation.isPending ||
                                    deleteInvitation.isPending ||
                                    !invitation.email
                                  }
                                  title="Gerar um novo link e renovar a validade por 7 dias"
                                  aria-label={`Reenviar convite para ${invitation.email || 'usuário'}`}
                                >
                                  {isResending ? (
                                    <Loader2 className="mr-1.5 h-4 w-4 shrink-0 animate-spin" />
                                  ) : (
                                    <RefreshCw className="mr-1.5 h-4 w-4 shrink-0" />
                                  )}
                                  <span className="truncate">Reenviar</span>
                                </Button>

                                <div
                                  className="flex h-9 min-w-0 flex-1 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-muted-foreground"
                                  title="O acesso só pode ser ativado depois que o convite for aceito"
                                >
                                  <span className="truncate text-xs">Aguardando aceite</span>
                                </div>

                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="h-9 w-9 shrink-0 rounded-[6px] border-0 bg-destructive text-white shadow-none hover:bg-destructive/90 hover:text-white"
                                  onClick={() => setInvitationToDelete(invitation)}
                                  disabled={
                                    updateInvitation.isPending ||
                                    deleteInvitation.isPending ||
                                    resendInvitation.isPending
                                  }
                                  aria-label={`Cancelar convite para ${invitation.email || 'usuário'}`}
                                >
                                  {isDeleting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </article>
                        );
                      })}

                      {visibleUsers.map((user) => {
                        const targetHasPrivilegedRole = ['admin', 'manager', 'owner'].includes(user.role);
                        const actorCanManageTargetRole =
                          isSuperAdmin ||
                          activeMemberRole === 'owner' ||
                          (activeMemberRole === 'admin' && user.role !== 'owner');
                        const canManageUserAccess =
                          canManageUsers &&
                          (!targetHasPrivilegedRole ||
                            (canManagePermissions && actorCanManageTargetRole));

                        return (
                          <article
                            key={user.id}
                            className="flex min-h-[180px] min-w-0 flex-col rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-4 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
                          >
                            <div className="flex min-w-0 items-start gap-3">
                              <Avatar className="h-12 w-12 shrink-0 rounded-[8px] bg-[var(--app-surface-soft)]">
                                <AvatarImage
                                  src={user.avatar_url || undefined}
                                  className="rounded-[8px] object-cover"
                                />
                                <AvatarFallback className="rounded-[8px] bg-primary/50 text-sm text-primary-foreground">
                                  {user.name
                                    .split(' ')
                                    .map((name) => name[0])
                                    .join('')
                                    .slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {user.name}
                                </p>
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  {user.email}
                                </p>
                              </div>
                              <Badge
                                variant="secondary"
                                className={
                                  user.is_active
                                    ? 'shrink-0 rounded-[6px] border-0 bg-emerald-700 text-[10px] text-white dark:bg-emerald-600 dark:text-white'
                                    : 'shrink-0 rounded-[6px] border-0 bg-muted text-[10px] text-muted-foreground'
                                }
                              >
                                {user.is_active ? 'Ativo' : t.common.inactive}
                              </Badge>
                            </div>

                            <div className="mt-4">
                              {user.role !== 'owner' && canManageUserAccess && canManageAdminRole ? (
                                <Select
                                  value={user.role ?? 'user'}
                                  onValueChange={(value) =>
                                    void handleUpdateUserRole(
                                      user.id,
                                      value as OrganizationMemberRole,
                                    )
                                  }
                                  disabled={user.id === profile?.id || updateUser.isPending}
                                >
                                  <SelectTrigger
                                    data-tour="team-user-role"
                                    className="h-9 w-full rounded-[6px] text-xs"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">
                                      {t.settings.users.admin}
                                    </SelectItem>
                                    <SelectItem value="manager">
                                      {t.settings.users.manager}
                                    </SelectItem>
                                    <SelectItem value="user">
                                      {t.settings.users.user}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge
                                  variant={
                                    user.role === 'admin' || user.role === 'owner'
                                      ? 'default'
                                      : 'secondary'
                                  }
                                  className="rounded-[6px] border-0"
                                >
                                  {roleLabel(user.role)}
                                </Badge>
                              )}
                            </div>

                            {(canManagePermissions || canManageUserAccess) && (
                              <div className="mt-auto flex items-center gap-2 pt-4">
                                {canManagePermissions && (
                                  <Button
                                    asChild
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 min-w-0 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-xs font-medium text-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                                    title="Editar permissões"
                                  >
                                    <Link
                                      href={`/settings/users/${user.id}`}
                                      aria-label={`Editar permissoes de ${user.name}`}
                                    >
                                      <ShieldCheck className="mr-1.5 h-4 w-4 shrink-0" />
                                      <span className="truncate">Permissões</span>
                                    </Link>
                                  </Button>
                                )}

                                {canManageUserAccess && (
                                  <div className="flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-muted-foreground transition-colors">
                                    <span className="truncate text-xs">
                                      {user.is_active ? 'Acesso ativo' : 'Sem acesso'}
                                    </span>
                                    <Switch
                                      data-tour="team-user-active"
                                      className="shrink-0 scale-90 data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--app-border)]"
                                      checked={user.is_active || false}
                                      onCheckedChange={(checked) => {
                                        if (!checked) {
                                          setUserToDeactivate({
                                            id: user.id,
                                            name: user.name,
                                          });
                                          return;
                                        }
                                        void handleToggleUserActive(user.id, false);
                                      }}
                                      disabled={
                                        user.id === profile?.id || updateUser.isPending
                                      }
                                      aria-label={`${user.is_active ? 'Desativar' : 'Ativar'} ${user.name}`}
                                    />
                                  </div>
                                )}

                                {canManageUserAccess && (
                                  <Button
                                    data-tour="team-user-delete"
                                    variant="destructive"
                                    size="icon"
                                    className="h-9 w-9 shrink-0 rounded-[6px] border-0 bg-destructive text-white shadow-none hover:bg-destructive/90 hover:text-white"
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
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
              </section>
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
            <AlertDialogTitle>Desativar acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{userToDeactivate?.name}</strong> perderá o acesso a esta organização até ser ativado novamente.
              O login continuará existindo; sem outra organização ativa, a pessoa verá a tela de acesso indisponível.
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
              Desativar acesso
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
