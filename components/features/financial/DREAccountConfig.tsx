import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDREGroups, useDREMappings, useInitializeDREGroups } from '@/hooks/use-dre';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { financialAPI } from '@/lib/api/financial';
import { toast } from 'sonner';
import { Plus, Trash2, RefreshCw, Loader2, Settings2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
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

const GROUP_TYPE_LABELS: Record<string, string> = {
  revenue: 'Receita',
  deduction: 'Dedução',
  cost: 'Custo',
  expense: 'Despesa',
  financial_expense: 'Despesa Financeira',
  financial_revenue: 'Receita Financeira',
  tax: 'Imposto'
};

const GROUP_TYPE_COLORS: Record<string, string> = {
  revenue: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  deduction: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  cost: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  expense: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  financial_expense: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  financial_revenue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  tax: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
};

export function DREAccountConfig() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const queryClient = useQueryClient();
  const {
    data: groups,
    isLoading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
  } = useDREGroups();
  const {
    data: mappings,
    isLoading: mappingsLoading,
    error: mappingsError,
    refetch: refetchMappings,
  } = useDREMappings();
  const { initializeGroups } = useInitializeDREGroups();

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [mappingToDelete, setMappingToDelete] = useState<{ id: string; category: string } | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const addMappingMutation = useMutation({
    mutationFn: async ({ category, entryType, groupId }: { category: string; entryType: string; groupId: string }) => {
      if (!organizationId) throw new Error('Organização não encontrada.');
      await financialAPI.createDREMapping({
        category,
        entry_type: entryType,
        group_id: groupId
      }, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dre-mappings', organizationId] });
      toast.success('Mapeamento adicionado!');
      setSelectedCategory('');
      setSelectedType('');
      setSelectedGroup('');
    },
    onError: () => {
      toast.error('Erro ao adicionar mapeamento');
    }
  });

  const removeMappingMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      if (!organizationId) throw new Error('Organização não encontrada.');
      await financialAPI.deleteDREMapping(mappingId, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dre-mappings', organizationId] });
      toast.success('Mapeamento removido!');
    },
    onError: () => {
      toast.error('Erro ao remover mapeamento');
    }
  });

  const handleInitialize = async () => {
    setIsInitializing(true);
    try {
      await initializeGroups();
      await queryClient.invalidateQueries({ queryKey: ['dre-groups', organizationId] });
      toast.success('Grupos inicializados com sucesso!');
    } catch {
      toast.error('Erro ao inicializar grupos');
    } finally {
      setIsInitializing(false);
    }
  };

  const handleAddMapping = () => {
    if (!selectedCategory || !selectedType || !selectedGroup) {
      toast.error('Preencha todos os campos');
      return;
    }
    addMappingMutation.mutate({
      category: selectedCategory,
      entryType: selectedType,
      groupId: selectedGroup
    });
  };

  if (groupsLoading || mappingsLoading) {
    return (
      <Card className="app-card">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (groupsError || mappingsError) {
    return (
      <Card className="app-card">
        <CardContent className="flex flex-col items-center py-12 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="mt-3 text-[14px] font-normal">Não foi possível carregar a configuração</h3>
          <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
            Verifique sua conexão e tente novamente.
          </p>
          <Button
            className="mt-4 h-8 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
            onClick={() => void Promise.all([refetchGroups(), refetchMappings()])}
          >
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasGroups = groups && groups.length > 0;

  return (
    <div className="space-y-6">
      {/* Grupos do DRE */}
      <Card className="app-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Grupos Contábeis</CardTitle>
              <CardDescription>
                Estrutura de contas do DRE
              </CardDescription>
            </div>
            {!hasGroups && (
              <Button onClick={() => void handleInitialize()} disabled={isInitializing}>
                {isInitializing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {isInitializing ? 'Inicializando...' : 'Inicializar Grupos Padrão'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {hasGroups ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {groups.map(group => (
                <div
                  key={group.id}
                  className="app-card-soft p-3 transition-colors hover:bg-[var(--app-surface-hover)]"
                >
                  <Badge
                    variant="secondary"
                    className={cn('mb-2', GROUP_TYPE_COLORS[group.group_type] || '')}
                  >
                    {GROUP_TYPE_LABELS[group.group_type] || group.group_type}
                  </Badge>
                  <p className="font-medium text-sm">{group.name}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Settings2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Nenhum grupo configurado.</p>
              <p className="text-sm">Clique em &quot;Inicializar Grupos Padrão&quot; para começar.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mapeamento de Categorias */}
      <Card className="app-card">
        <CardHeader>
          <CardTitle>Mapeamento de Categorias</CardTitle>
          <CardDescription>
            Vincule as categorias dos lançamentos financeiros aos grupos do DRE
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Formulário de adição */}
          {hasGroups && (
            <div className="app-card-soft flex flex-wrap items-end gap-3 p-4">
              <div className="space-y-1 flex-1 min-w-[150px]">
                <label className="text-sm font-medium">Categoria</label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Vendas">Vendas</SelectItem>
                    <SelectItem value="Comissões">Comissões</SelectItem>
                    <SelectItem value="Locações">Locações</SelectItem>
                    <SelectItem value="Serviços">Serviços</SelectItem>
                    <SelectItem value="Impostos">Impostos</SelectItem>
                    <SelectItem value="Aluguel">Aluguel</SelectItem>
                    <SelectItem value="Folha">Folha de Pagamento</SelectItem>
                    <SelectItem value="Marketing">Marketing</SelectItem>
                    <SelectItem value="Administrativo">Administrativo</SelectItem>
                    <SelectItem value="Financeiras">Despesas Financeiras</SelectItem>
                    <SelectItem value="Taxas">Taxas Bancárias</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center text-muted-foreground">
                <ArrowRight className="h-4 w-4" />
              </div>

              <div className="space-y-1 flex-1 min-w-[120px]">
                <label className="text-sm font-medium">Tipo</label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receivable">A Receber</SelectItem>
                    <SelectItem value="payable">A Pagar</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center text-muted-foreground">
                <ArrowRight className="h-4 w-4" />
              </div>

              <div className="space-y-1 flex-1 min-w-[200px]">
                <label className="text-sm font-medium">Grupo DRE</label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {groups?.map(group => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleAddMapping}
                disabled={!selectedCategory || !selectedType || !selectedGroup || addMappingMutation.isPending}
              >
                {addMappingMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span className="ml-2">Adicionar</span>
              </Button>
            </div>
          )}

          {/* Lista de mapeamentos */}
          {mappings && mappings.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Grupo DRE</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map(mapping => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">{mapping.category}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {mapping.entry_type === 'receivable' ? 'A Receber' : 'A Pagar'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn(GROUP_TYPE_COLORS[mapping.group?.group_type || ''] || '')}>
                        {mapping.group?.name || '-'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover mapeamento de ${mapping.category}`}
                        onClick={() => setMappingToDelete({ id: mapping.id, category: mapping.category })}
                        disabled={removeMappingMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>Nenhum mapeamento configurado.</p>
              <p className="text-sm">Adicione mapeamentos para vincular suas categorias ao DRE.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={mappingToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !removeMappingMutation.isPending) setMappingToDelete(null);
        }}
      >
        <AlertDialogContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 shadow-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-normal">Remover mapeamento</AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
              A categoria “{mappingToDelete?.category ?? ''}” deixará de compor automaticamente o grupo atual do DRE.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMappingMutation.isPending} className="h-9 rounded-[6px] text-[12px] font-light">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!mappingToDelete || removeMappingMutation.isPending}
              className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!mappingToDelete) return;
                removeMappingMutation.mutate(mappingToDelete.id, {
                  onSuccess: () => setMappingToDelete(null),
                });
              }}
            >
              {removeMappingMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
