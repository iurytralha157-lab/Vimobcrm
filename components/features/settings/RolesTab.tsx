import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Plus,
  Pencil,
  Trash2,
  Shield,
  Users,
  LayoutDashboard,
  Settings,
  Loader2,
  Check
} from 'lucide-react';
import {
  useOrganizationRoles,
  useAvailablePermissions,
  useRolePermissions,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useUpdateRolePermissions,
  type OrganizationRole,
  type AvailablePermission
} from '@/hooks/use-organization-roles';

// Mapeamento de categorias para labels bonitos e ícones
const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; order: number }> = {
  modules: { label: 'Módulos', icon: LayoutDashboard, order: 1 },
  leads: { label: 'Leads & Pipeline', icon: Users, order: 2 },
  data: { label: 'Dados & Clientes', icon: Shield, order: 3 },
  settings: { label: 'Configurações', icon: Settings, order: 4 },
};

// Agrupamento semântico de permissões por área funcional
const PERMISSION_GROUPS: Record<string, { label: string; keys: string[] }> = {
  // Dentro de "modules"
  dashboard: { label: 'Dashboard', keys: ['dashboard_view'] },
  pipeline: { label: 'Pipeline', keys: ['pipeline_view', 'pipeline_edit'] },
  conversations: { label: 'Conversas', keys: ['conversations_view', 'conversations_edit'] },
  financial: { label: 'Financeiro', keys: ['financial_view', 'financial_edit'] },
  properties: { label: 'Imóveis', keys: ['properties_view', 'properties_edit'] },
  agenda: { label: 'Agenda', keys: ['agenda_view', 'agenda_edit'] },
  automations: { label: 'Automações', keys: ['automations_view', 'automations_edit'] },
  reports: { label: 'Relatórios', keys: ['reports_view'] },
  // Dentro de "leads"
  lead_visibility: { label: 'Visibilidade de Leads', keys: ['lead_view_all', 'lead_view_own', 'lead_view_team'] },
  lead_actions: { label: 'Ações em Leads', keys: ['lead_edit', 'lead_delete', 'lead_assign', 'lead_transfer', 'pipeline_lock'] },
  // Dentro de "data"
  customers: { label: 'Clientes', keys: ['customers_view_all', 'customers_view_own', 'customers_edit'] },
  data_export: { label: 'Exportação', keys: ['data_export'] },
  // Dentro de "settings"
  org_settings: { label: 'Configurações', keys: ['settings_view', 'settings_edit'] },
  team_management: { label: 'Gestão de Equipes', keys: ['team_view', 'team_edit'] },
  user_management: { label: 'Gestão de Usuários', keys: ['user_invite', 'user_edit'] },
};

const COLOR_OPTIONS = [
  '#6B7280', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6'
];

export function RolesTab() {
  const { data: roles = [], isLoading: rolesLoading } = useOrganizationRoles();
  const { data: allPermissions = [] } = useAvailablePermissions();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<OrganizationRole | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<OrganizationRole | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState('#6B7280');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const updatePermissions = useUpdateRolePermissions();

  // Quando abrir para edição, carregar permissões da função
  const { data: rolePermissions = [] } = useRolePermissions(editingRole?.id || null);

  useEffect(() => {
    if (!editingRole) return;

    const permissionKeys = rolePermissions.map(p => p.permission_key);
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setSelectedPermissions(permissionKeys);
    });

    return () => {
      cancelled = true;
    };
  }, [editingRole, rolePermissions]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormColor('#6B7280');
    setSelectedPermissions([]);
    setEditingRole(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setCreateDialogOpen(true);
  };

  const handleOpenEdit = (role: OrganizationRole) => {
    setFormName(role.name);
    setFormDescription(role.description || '');
    setFormColor(role.color);
    setEditingRole(role);
    setCreateDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;

    if (editingRole) {
      // Atualizar função existente
      await updateRole.mutateAsync({
        id: editingRole.id,
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        color: formColor,
      });
      // Atualizar permissões
      await updatePermissions.mutateAsync({
        roleId: editingRole.id,
        permissions: selectedPermissions,
      });
    } else {
      // Criar nova função
      await createRole.mutateAsync({
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        color: formColor,
        permissions: selectedPermissions,
      });
    }

    setCreateDialogOpen(false);
    resetForm();
  };

  const handleDelete = async () => {
    if (!roleToDelete) return;
    await deleteRole.mutateAsync(roleToDelete.id);
    setDeleteDialogOpen(false);
    setRoleToDelete(null);
  };

  const togglePermission = (key: string) => {
    setSelectedPermissions(prev =>
      prev.includes(key)
        ? prev.filter(p => p !== key)
        : [...prev, key]
    );
  };

  const toggleCategoryPermissions = (category: string, enabled: boolean) => {
    const categoryKeys = allPermissions
      .filter(p => p.category === category)
      .map(p => p.key);

    setSelectedPermissions(prev => {
      if (enabled) {
        return [...new Set([...prev, ...categoryKeys])];
      } else {
        return prev.filter(p => !categoryKeys.includes(p));
      }
    });
  };

  const isCategoryFullySelected = (category: string) => {
    const categoryKeys = allPermissions
      .filter(p => p.category === category)
      .map(p => p.key);
    return categoryKeys.every(k => selectedPermissions.includes(k));
  };

  const isCategoryPartiallySelected = (category: string) => {
    const categoryKeys = allPermissions
      .filter(p => p.category === category)
      .map(p => p.key);
    const selectedCount = categoryKeys.filter(k => selectedPermissions.includes(k)).length;
    return selectedCount > 0 && selectedCount < categoryKeys.length;
  };

  // Agrupar permissões por categoria
  const permissionsByCategory = allPermissions.reduce((acc, perm) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, AvailablePermission[]>);

  const sortedCategories = Object.keys(permissionsByCategory).sort(
    (a, b) => (CATEGORY_CONFIG[a]?.order || 99) - (CATEGORY_CONFIG[b]?.order || 99)
  );

  const isLoading = createRole.isPending || updateRole.isPending || updatePermissions.isPending;

  return (
    <Card className="app-card border-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl font-semibold text-foreground">Funções e Permissões</CardTitle>
          <CardDescription className="mt-0.5 text-sm text-muted-foreground">Crie funções personalizadas e defina o que cada cargo pode acessar</CardDescription>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Função
            </Button>
          </DialogTrigger>
          <DialogContent className="app-card flex max-h-[86vh] w-[92vw] max-w-[720px] flex-col p-6">
            <DialogHeader>
              <DialogTitle>
                {editingRole ? 'Editar Função' : 'Nova Função'}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-6 py-4">
              {/* Informações básicas */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nome da Função *</Label>
                    <Input
                      placeholder="Ex: Gerente, Supervisor, Vendedor..."
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cor</Label>
                    <div className="flex gap-2 flex-wrap">
                      {COLOR_OPTIONS.map(color => (
                        <button
                          key={color}
                          type="button"
                          className={`w-8 h-8 rounded-full border-2 transition-all ${
                            formColor === color
                              ? 'border-foreground scale-110'
                              : 'border-transparent hover:scale-105'
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => setFormColor(color)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea
                    placeholder="Descreva as responsabilidades dessa função..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <Separator />

              {/* Permissões */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Permissões</Label>
                  <span className="text-sm text-muted-foreground">
                    {selectedPermissions.length} selecionadas
                  </span>
                </div>

                <Accordion type="multiple" className="w-full" defaultValue={sortedCategories}>
                  {sortedCategories.map(category => {
                    const config = CATEGORY_CONFIG[category] || { label: category, icon: Shield, order: 99 };
                    const Icon = config.icon;
                    const isFullySelected = isCategoryFullySelected(category);
                    const isPartiallySelected = isCategoryPartiallySelected(category);

                    return (
                      <AccordionItem key={category} value={category}>
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-3 flex-1">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{config.label}</span>
                            <div className="flex items-center gap-2 ml-auto mr-4">
                              {isFullySelected && (
                                <Badge variant="secondary" className="text-xs">
                                  Todas
                                </Badge>
                              )}
                              {isPartiallySelected && (
                                <Badge variant="outline" className="text-xs">
                                  Parcial
                                </Badge>
                              )}
                              <Switch
                                checked={isFullySelected}
                                onCheckedChange={(checked) => toggleCategoryPermissions(category, checked)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-4 pt-2">
                            {/* Agrupar permissões por área funcional dentro da categoria */}
                            {(() => {
                              // Encontrar grupos que têm permissões nesta categoria
                              const categoryPermKeys = permissionsByCategory[category]?.map(p => p.key) || [];
                              const relevantGroups = Object.entries(PERMISSION_GROUPS).filter(([, group]) =>
                                group.keys.some(k => categoryPermKeys.includes(k))
                              );

                              // Permissões que não estão em nenhum grupo
                              const groupedKeys = relevantGroups.flatMap(([, g]) => g.keys);
                              const ungroupedPerms = (permissionsByCategory[category] || []).filter(
                                p => !groupedKeys.includes(p.key)
                              );

                              return (
                                <>
                                  {relevantGroups.map(([groupKey, group]) => {
                                    const groupPerms = (permissionsByCategory[category] || []).filter(p =>
                                      group.keys.includes(p.key)
                                    );
                                    if (groupPerms.length === 0) return null;

                                    return (
                                      <div key={groupKey} className="space-y-2">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                                          {group.label}
                                        </p>
                                        <div className="space-y-2">
                                          {groupPerms.map(permission => (
                                            <div
                                              key={permission.key}
                                              className="app-card-soft flex items-start gap-3 p-3 transition-colors cursor-pointer hover:bg-white/[0.055]"
                                              onClick={() => togglePermission(permission.key)}
                                            >
                                              <div className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center transition-colors ${
                                                selectedPermissions.includes(permission.key)
                                                  ? 'bg-primary border-primary text-primary-foreground'
                                                  : 'border-input'
                                              }`}>
                                                {selectedPermissions.includes(permission.key) && (
                                                  <Check className="h-3 w-3" />
                                                )}
                                              </div>
                                              <div className="flex-1">
                                                <p className="font-medium text-sm">{permission.name}</p>
                                                <p className="text-xs text-muted-foreground">{permission.description}</p>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {/* Permissões não agrupadas */}
                                  {ungroupedPerms.length > 0 && (
                                    <div className="space-y-2">
                                      {relevantGroups.length > 0 && (
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                                          Outras
                                        </p>
                                      )}
                                      {ungroupedPerms.map(permission => (
                                        <div
                                          key={permission.key}
                                          className="app-card-soft flex items-start gap-3 p-3 transition-colors cursor-pointer hover:bg-white/[0.055]"
                                          onClick={() => togglePermission(permission.key)}
                                        >
                                          <div className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center transition-colors ${
                                            selectedPermissions.includes(permission.key)
                                              ? 'bg-primary border-primary text-primary-foreground'
                                              : 'border-input'
                                          }`}>
                                            {selectedPermissions.includes(permission.key) && (
                                              <Check className="h-3 w-3" />
                                            )}
                                          </div>
                                          <div className="flex-1">
                                            <p className="font-medium text-sm">{permission.name}</p>
                                            <p className="text-xs text-muted-foreground">{permission.description}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-white/[0.055]">
              <Button variant="secondary" className="w-[40%]" onClick={() => setCreateDialogOpen(false)} disabled={isLoading}>
                Cancelar
              </Button>
              <Button className="w-[60%]" onClick={handleSave} disabled={!formName.trim() || isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingRole ? 'Salvar Alterações' : 'Criar Função'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="px-4 md:px-6 pb-5">
        {rolesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : roles.length === 0 ? (
          <div className="app-card-soft text-center py-12">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-lg mb-2">Nenhuma função criada</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Crie funções personalizadas para controlar o acesso dos seus usuários
            </p>
            <Button onClick={handleOpenCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeira Função
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roles.map(role => (
              <Card key={role.id} className="app-card-soft relative overflow-hidden">
                <div
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{ backgroundColor: role.color }}
                />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: role.color }}
                      />
                      <CardTitle className="text-lg">{role.name}</CardTitle>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenEdit(role)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!role.is_system && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            setRoleToDelete(role);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {role.description && (
                    <CardDescription className="text-xs line-clamp-2">
                      {role.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <RolePermissionsSummary roleId={role.id} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir função?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a função &quot;{roleToDelete?.name}&quot;?
              Usuários com esta função perderão suas permissões associadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRole.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// Componente auxiliar para mostrar resumo de permissões
function RolePermissionsSummary({ roleId }: { roleId: string }) {
  const { data: permissions = [], isLoading } = useRolePermissions(roleId);
  const { data: allPermissions = [] } = useAvailablePermissions();

  if (isLoading) {
    return <div className="h-8 flex items-center">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>;
  }

  if (permissions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Nenhuma permissão configurada
      </p>
    );
  }

  // Agrupar por categoria
  const categoryCounts: Record<string, number> = {};
  permissions.forEach(p => {
    const perm = allPermissions.find(ap => ap.key === p.permission_key);
    if (perm) {
      categoryCounts[perm.category] = (categoryCounts[perm.category] || 0) + 1;
    }
  });

  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(categoryCounts).map(([category, count]) => {
        const config = CATEGORY_CONFIG[category];
        return (
          <Badge key={category} variant="secondary" className="text-xs">
            {config?.label || category}: {count}
          </Badge>
        );
      })}
    </div>
  );
}
