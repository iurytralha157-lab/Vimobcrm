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
import { useCreateUser, useDeleteUser, useOrganizationUsers, useUpdateUser } from '@/hooks/use-users';
import {
  useOrganizationRoles,
  useUserOrganizationRoles,
  useAssignUserRole,
  OrganizationRole
} from '@/hooks/use-organization-roles';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { RolesTab } from './RolesTab';

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
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const assignUserRole = useAssignUserRole();

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  // Form state for new user
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserEndereco, setNewUserEndereco] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin =
    isSuperAdmin ||
    profile?.role === 'admin' ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';

  // Helper para obter a funÃ§Ã£o customizada de um usuÃ¡rio
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
    setDeletingUser(true);
    try {
      await deleteUser.mutateAsync(userToDelete.id);
      toast.success('UsuÃ¡rio excluÃ­do com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      setDeleteUserDialogOpen(false);
      setUserToDelete(null);
    } catch (error: unknown) {
      toast.error('Erro ao excluir usuÃ¡rio: ' + getErrorMessage(error, 'Erro desconhecido'));
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
      const result = await createUser.mutateAsync({
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        phone: newUserPhone.trim() || undefined,
        whatsapp: newUserPhone.trim() || undefined,
        endereco: newUserEndereco.trim() || undefined,
        role: newUserRole,
      });

      if (result.wasMultiOrg || result.wasOrphan) {
        toast.success(result.message || 'UsuÃ¡rio vinculado Ã  organizaÃ§Ã£o! Acesso com senha existente.');
      } else if (result.whatsappSent) {
        toast.success('UsuÃ¡rio criado! Credenciais de acesso enviadas via WhatsApp.');
      } else {
        toast.success(
          `UsuÃ¡rio criado! Senha gerada: ${result.generatedPassword}. âš ï¸ WhatsApp nÃ£o enviado â€” copie a senha agora.`,
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
                    className="bg-primary hover:bg-primary/90 text-primary-foreground border-2 border-primary/20 hover:scale-105 transition-all duration-200"
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
                        placeholder="EndereÃ§o completo"
                        value={newUserEndereco}
                        onChange={e => setNewUserEndereco(e.target.value)}
                      />
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs text-foreground">
                        ðŸ” Uma <strong>senha aleatÃ³ria segura</strong> serÃ¡ gerada automaticamente e enviada
                        ao novo usuÃ¡rio via <strong>WhatsApp</strong>, junto com o link de acesso e o login.
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
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
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
                          {/* Mostrar funÃ§Ã£o customizada */}
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

                          {/* FunÃ§Ã£o customizada (apenas para nÃ£o-admins) */}
                          {user.role !== 'admin' && organizationRoles.length > 0 && (
                            <Select
                              value={getUserCustomRole(user.id)?.id || 'none'}
                              onValueChange={v => handleAssignRole(user.id, v === 'none' ? null : v)}
                              disabled={user.id === profile?.id}
                            >
                              <SelectTrigger className="w-28 h-8 text-xs">
                                <SelectValue placeholder="FunÃ§Ã£o..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Sem funÃ§Ã£o</SelectItem>
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
      <AlertDialog open={deleteUserDialogOpen} onOpenChange={setDeleteUserDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuÃ¡rio</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o usuÃ¡rio <strong>{userToDelete?.name}</strong>?
              Esta aÃ§Ã£o nÃ£o pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingUser}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deletingUser}
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
