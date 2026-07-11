import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Sheet,
  SheetContent,
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
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeleteUser, useDeleteUserImpact, useOrganizationUsers, useUpdateUser } from '@/hooks/use-users';
import { 
  useOrganizationRoles, 
  useUserOrganizationRoles, 
  useAssignUserRole,
  OrganizationRole
} from '@/hooks/use-organization-roles';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { RolesTab } from './RolesTab';
import { canManageOrganization } from '@/lib/access/organization';

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

export function TeamTab() {
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const { data: users = [], isLoading: usersLoading } = useOrganizationUsers();
  const { data: organizationRoles = [] } = useOrganizationRoles();
  const { data: userOrgRoles = [] } = useUserOrganizationRoles();
  
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const assignUserRole = useAssignUserRole();

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [transferLeadsToUserId, setTransferLeadsToUserId] = useState<string>('');
  const [transferPropertiesToUserId, setTransferPropertiesToUserId] = useState<string>('');
  const [creatingUser, setCreatingUser] = useState(false);

  // Form state for new user
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserEndereco, setNewUserEndereco] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin = canManageOrganization({
    isSuperAdmin,
    profileRole: profile?.role,
    memberRole: activeMemberRole,
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

  // Helper para obter a função customizada de um usuário
  const getUserCustomRole = (userId: string): OrganizationRole | undefined => {
    const assignment = userOrgRoles.find(uor => uor.user_id === userId);
    if (!assignment) return undefined;
    return organizationRoles.find(r => r.id === assignment.organization_role_id);
  };

  const handleAssignRole = async (userId: string, roleId: string | null) => {
    await assignUserRole.mutateAsync({ userId, roleId });
  };

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
    if (!newUserName.trim() || !newUserEmail.trim()) {
      toast.error('Preencha nome e email');
      return;
    }
    if (!newUserPhone.trim()) {
      toast.error('Informe o WhatsApp para envio das credenciais de acesso');
      return;
    }
    setCreatingUser(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        toast.error('Sua sessão expirou. Por favor, faça login novamente.');
        window.location.assign('/login');
        return;
      }
      const { data: result, error } = await supabase.functions.invoke('create-user', {
        body: {
          name: newUserName.trim(),
          email: newUserEmail.trim(),
          phone: newUserPhone.trim() || undefined,
          whatsapp: newUserPhone.trim() || undefined,
          endereco: newUserEndereco.trim() || undefined,
          role: newUserRole
        }
      });
      if (error) throw new Error(error.message || 'Erro ao criar usuário');

      if (result.wasMultiOrg || result.wasOrphan) {
        toast.success(result.message || 'Usuário vinculado à organização! Acesso com senha existente.');
      } else if (result.whatsappSent) {
        toast.success('Usuário criado! Credenciais de acesso enviadas via WhatsApp.');
      } else {
        toast.success(
          `Usuário criado! Senha gerada: ${result.generatedPassword}. WhatsApp não enviado; copie a senha agora.`,
          { duration: 15000 }
        );
      }
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      setUserDialogOpen(false);
      resetNewUserForm();
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'Erro ao criar usuário');
      if (errorMessage.includes('SESSION_EXPIRED') || errorMessage.includes('Unauthorized')) {
        toast.error('Sua sessão expirou. Por favor, faça login novamente.');
        window.location.assign('/login');
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setCreatingUser(false);
    }
  };

  const resetNewUserForm = () => {
    setNewUserName('');
    setNewUserEmail('');
    setNewUserPhone('');
    setNewUserEndereco('');
    setNewUserRole('user');
  };

  return (
    <div className="space-y-6">
      <div className={`grid gap-6 ${isAdmin ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* LEFT: Users List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl font-semibold text-foreground">{t.settings.users.title}</CardTitle>
              <CardDescription className="mt-0.5 text-sm text-muted-foreground">{t.settings.users.description}</CardDescription>
            </div>
            {isAdmin && (
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
                <SheetContent side="right" className="w-[90%] sm:w-[650px] sm:max-w-[650px] p-6 flex flex-col overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>{t.settings.users.createUser}</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t.common.name}</Label>
                        <Input 
                          placeholder={t.common.name} 
                          value={newUserName} 
                          onChange={e => setNewUserName(e.target.value)} 
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.common.email}</Label>
                        <Input 
                          type="email" 
                          placeholder="email@company.com" 
                          value={newUserEmail} 
                          onChange={e => setNewUserEmail(e.target.value)} 
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>WhatsApp <span className="text-destructive">*</span></Label>
                        <PhoneInput value={newUserPhone} onChange={setNewUserPhone} />
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
                    <div className="space-y-2">
                      <Label>{t.common.address}</Label>
                      <Input
                        placeholder="Endereço completo"
                        value={newUserEndereco}
                        onChange={e => setNewUserEndereco(e.target.value)}
                      />
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs text-foreground">
                        Uma <strong>senha aleatória segura</strong> será gerada automaticamente e enviada
                        ao novo usuário via <strong>WhatsApp</strong>, junto com o link de acesso e o login.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button variant="outline" onClick={() => setUserDialogOpen(false)} disabled={creatingUser}>
                        {t.common.cancel}
                      </Button>
                      <Button onClick={handleCreateUser} disabled={creatingUser || !newUserName.trim() || !newUserEmail.trim()}>
                        {creatingUser && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {t.settings.users.createUser}
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </CardHeader>
          <CardContent className="px-4 md:px-6 pb-4">
            {usersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
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
                          <p className="font-medium text-sm">{user.name}</p>
                          {!user.is_active && (
                            <Badge variant="secondary" className="text-xs">{t.common.inactive}</Badge>
                          )}
                          {/* Mostrar função customizada */}
                          {user.role !== 'admin' && getUserCustomRole(user.id) && (
                            <Badge 
                              variant="outline" 
                              className="text-xs"
                              style={{
                                borderColor: getUserCustomRole(user.id)?.color,
                                color: getUserCustomRole(user.id)?.color
                              }}
                            >
                              {getUserCustomRole(user.id)?.name}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {isAdmin ? (
                        <>
                          {/* Tipo de usuÃ¡rio (admin/user) */}
                          <Select 
                            value={user.role ?? 'user'} 
                            onValueChange={v => handleUpdateUserRole(user.id, v as 'admin' | 'user')} 
                            disabled={user.id === profile?.id}
                          >
                            <SelectTrigger className="w-24 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">{t.settings.users.admin}</SelectItem>
                              <SelectItem value="user">{t.settings.users.user}</SelectItem>
                            </SelectContent>
                          </Select>
                          
                          {/* Função customizada (apenas para não-admins) */}
                          {user.role !== 'admin' && organizationRoles.length > 0 && (
                            <Select 
                              value={getUserCustomRole(user.id)?.id || 'none'} 
                              onValueChange={v => handleAssignRole(user.id, v === 'none' ? null : v)} 
                              disabled={user.id === profile?.id}
                            >
                              <SelectTrigger className="w-28 h-8 text-xs">
                                <SelectValue placeholder="Função..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Sem função</SelectItem>
                                {organizationRoles.map(role => (
                                  <SelectItem key={role.id} value={role.id}>
                                    <div className="flex items-center gap-2">
                                      <div 
                                        className="w-2 h-2 rounded-full" 
                                        style={{ backgroundColor: role.color }} 
                                      />
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
                          {user.role !== 'admin' && getUserCustomRole(user.id) && (
                            <Badge 
                              variant="outline"
                              style={{
                                borderColor: getUserCustomRole(user.id)?.color,
                                color: getUserCustomRole(user.id)?.color
                              }}
                            >
                              {getUserCustomRole(user.id)?.name}
                            </Badge>
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
        {isAdmin && <RolesTab />}
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
