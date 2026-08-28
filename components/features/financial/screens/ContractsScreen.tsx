'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ContractStatusBadge } from '@/components/features/financial/ContractStatusBadge';
import { ContractForm } from '@/components/features/financial/ContractForm';
import { FinancialDrawer } from '@/components/features/financial/FinancialDrawer';
import { FinancialConfirmationDialog } from '@/components/features/financial/FinancialConfirmationDialog';

import { useContracts, useActivateContract, useDeleteContract, useRegenerateCommissions, Contract } from '@/hooks/use-contracts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { formatCurrency, formatDate, exportToExcel, prepareContractsExport } from '@/lib/export-financial';
import { normalizeSearchText } from '@/lib/search-text';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Download,
  PlayCircle,
  Building2,
  User,
  Calendar,
  SlidersHorizontal,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

// Mobile Contract Card - Melhorado para mobile
function ContractCard({ contract, onActivate, onEdit, onDelete, canManage, activationPending }: {
  contract: Contract;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
  activationPending: boolean;
}) {
  const router = useRouter();
  const getTypeLabel = (type: string | null) => {
    if (!type) return '-';
    const types: Record<string, string> = {
      sale: 'Venda',
      rent: 'Locação',
      rental: 'Locação',
      service: 'Serviço',
    };
    return types[type] || type;
  };

  return (
    <Card
      className="app-card-soft mb-2 cursor-pointer transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mb-3"
      role="link"
      tabIndex={0}
      aria-label={`Abrir contrato ${contract.contract_number || contract.id.slice(0, 8)}`}
      onClick={() => router.push(`/financeiro/contratos/${contract.id}`)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          router.push(`/financeiro/contratos/${contract.id}`);
        }
      }}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2 mb-2 sm:mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Badge variant="outline" className="text-[10px] sm:text-xs h-5 shrink-0">
                {contract.contract_number || contract.id.slice(0, 8)}
              </Badge>
              <Badge variant="secondary" className="text-[10px] sm:text-xs h-5">
                {getTypeLabel(contract.contract_type)}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium text-xs sm:text-sm truncate">
                {contract.client_name || contract.lead?.name || 'Sem cliente'}
              </span>
            </div>
          </div>
          <ContractStatusBadge status={contract.status || 'draft'} />
        </div>

        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 flex-wrap">
          {contract.property?.code && (
            <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              {contract.property.code}
            </div>
          )}
          {contract.signing_date && (
            <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(contract.signing_date)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 sm:pt-3">
          <p className="text-sm font-normal text-primary sm:text-base">{formatCurrency(contract.value)}</p>
          {canManage && contract.status === 'draft' && <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onActivate} disabled={activationPending}>
              <PlayCircle className="h-3.5 w-3.5 mr-1" />
              Ativar
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              <span className="sr-only">Editar contrato</span>
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Excluir contrato</span>
            </Button>
          </div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Contracts() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { hasPermission } = useUserPermissions();
  const canManage = hasPermission('financial_manage');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [formPending, setFormPending] = useState(false);
  const [noBrokersContract, setNoBrokersContract] = useState<Contract | null>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: 'delete' | 'regenerate';
    contract: Contract;
  } | null>(null);

  const { data: contracts, isLoading, error, refetch } = useContracts({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    // Rental records exist with both the legacy `rent` and canonical `rental` values.
    type:
      typeFilter !== 'all' && typeFilter !== 'rental'
        ? typeFilter
        : undefined,
  });

  const activateContract = useActivateContract();
  const deleteContract = useDeleteContract();
  const regenerateCommissions = useRegenerateCommissions();

  const filteredContracts = contracts?.filter(contract => {
    const leadName = normalizeSearchText(contract.lead?.name);
    const clientName = normalizeSearchText(contract.client_name);
    const contractNumber = normalizeSearchText(contract.contract_number);
    const propertyCode = normalizeSearchText(contract.property?.code);
    const propertyTitle = normalizeSearchText(contract.property?.title);
    const query = normalizeSearchText(searchQuery);
    const matchesType =
      typeFilter === 'all' ||
      (typeFilter === 'rental'
        ? contract.contract_type === 'rental' || contract.contract_type === 'rent'
        : contract.contract_type === typeFilter);
    return matchesType && (
      leadName.includes(query) ||
      clientName.includes(query) ||
      contractNumber.includes(query) ||
      propertyCode.includes(query) ||
      propertyTitle.includes(query)
    );
  }) || [];

  const handleExport = () => {
    if (!filteredContracts.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    const data = prepareContractsExport(filteredContracts);
    exportToExcel(data, `contratos-${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success('Arquivo exportado com sucesso');
  };

  const handleActivate = (contract: Contract, skipCommissions = false) => {
    if (
      !skipCommissions &&
      !contract.brokers?.some((broker) => Boolean(broker.user_id))
    ) {
      setNoBrokersContract(contract);
      return;
    }
    activateContract.mutate(
      { contractId: contract.id, skipCommissions },
      {
        onSuccess: () => {
          if (skipCommissions) setNoBrokersContract(null);
        },
        onError: (activationError: unknown) => {
          if (
            !skipCommissions &&
            activationError instanceof Error &&
            activationError.message === 'NO_BROKERS'
          ) {
            setNoBrokersContract(contract);
          }
        },
      },
    );
  };

  const handleRegenerateCommissions = (contract: Contract) =>
    setConfirmation({ kind: 'regenerate', contract });

  const handleDelete = (contract: Contract) =>
    setConfirmation({ kind: 'delete', contract });

  const handleEdit = (contract: Contract) => {
    setEditingContract(contract);
    setIsFormOpen(true);
  };

  const handleFormSuccess = () => {
    setFormPending(false);
    setIsFormOpen(false);
    setEditingContract(null);
  };

  const getTypeLabel = (type: string | null) => {
    if (!type) return '-';
    const types: Record<string, string> = {
      sale: 'Venda',
      rent: 'Locação',
      rental: 'Locação',
      service: 'Serviço',
    };
    return types[type] || type;
  };

  const activeFilterCount = (typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);

  return (
    <AppLayout title="Contratos">
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Gerencie seus contratos de venda e locação</p>
          <div className="flex gap-2">
            <Button variant="outline" size={isMobile ? "sm" : "default"} onClick={handleExport}>
              <Download className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Exportar</span>
            </Button>
            {canManage && <Button size={isMobile ? "sm" : "default"} onClick={() => setIsFormOpen(true)}>
              <Plus className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Novo Contrato</span>
              <span className="sm:hidden">Novo</span>
            </Button>}
          </div>
        </div>

        <Card className="app-card">
          <CardContent className="p-3 md:p-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {isMobile ? (
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                  className="w-full sm:w-auto"
                >
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Filtros
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="ml-2">{activeFilterCount}</Badge>
                  )}
                </Button>
              ) : (
                <>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="sale">Venda</SelectItem>
                      <SelectItem value="rental">Locação</SelectItem>
                      <SelectItem value="service">Serviço</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="draft">Rascunho</SelectItem>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="finished">Encerrado</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {isMobile && showFilters && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="sale">Venda</SelectItem>
                    <SelectItem value="rental">Locação</SelectItem>
                    <SelectItem value="service">Serviço</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">Todos status</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="finished">Encerrado</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {error && contracts && (
          <div className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground" role="alert">
            <span>Os contratos podem estar desatualizados.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              Atualizar novamente
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 md:h-12" />)}
          </div>
        ) : error && !contracts ? (
          <div className="app-card flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
            <p className="text-sm text-destructive">Não foi possível carregar os contratos.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : isMobile ? (
          <div>
            {filteredContracts.length === 0 ? (
              <Card className="app-card">
                <CardContent className="py-8 text-center text-muted-foreground">
                  Nenhum contrato encontrado
                </CardContent>
              </Card>
            ) : (
              filteredContracts.map((contract) => (
                <ContractCard
                  key={contract.id}
                  contract={contract}
                  canManage={canManage}
                  activationPending={activateContract.isPending}
                  onActivate={() => handleActivate(contract)}
                  onEdit={() => handleEdit(contract)}
                  onDelete={() => handleDelete(contract)}
                />
              ))
            )}
          </div>
        ) : (
          <Card className="app-card">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Imóvel</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data Assinatura</TableHead>
                    {canManage && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canManage ? 8 : 7} className="text-center py-8 text-muted-foreground">
                        Nenhum contrato encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredContracts.map((contract) => (
                      <TableRow
                        key={contract.id}
                        className="cursor-pointer transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        role="link"
                        tabIndex={0}
                        aria-label={`Abrir contrato ${contract.contract_number || contract.id.slice(0, 8)}`}
                        onClick={() => router.push(`/financeiro/contratos/${contract.id}`)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            router.push(`/financeiro/contratos/${contract.id}`);
                          }
                        }}
                      >
                        <TableCell className="font-medium">
                          {contract.contract_number || contract.id.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{contract.lead?.name || '-'}</p>
                        </TableCell>
                        <TableCell>{getTypeLabel(contract.contract_type)}</TableCell>
                        <TableCell>
                          {contract.property?.code || '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(contract.value)}
                        </TableCell>
                        <TableCell>
                          <ContractStatusBadge status={contract.status || 'draft'} />
                        </TableCell>
                        <TableCell>{formatDate(contract.signing_date)}</TableCell>
                        {canManage && <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Ações do contrato ${contract.contract_number || contract.id.slice(0, 8)}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover">
                              {contract.status === 'draft' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleActivate(contract)} disabled={activateContract.isPending}>
                                    <PlayCircle className="h-4 w-4 mr-2" />
                                    Ativar Contrato
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {contract.status === 'active' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleRegenerateCommissions(contract)}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Regenerar Comissões
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {contract.status === 'draft' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleEdit(contract)}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => handleDelete(contract)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Excluir
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <FinancialDrawer
          open={isFormOpen}
          onOpenChange={(open) => {
            setIsFormOpen(open);
            if (!open) setEditingContract(null);
          }}
          title={editingContract ? 'Editar Contrato' : 'Novo Contrato'}
          description={editingContract ? 'Altere os dados do contrato' : 'Preencha os dados do novo contrato'}
          size="lg"
          pending={formPending}
        >
          <ContractForm
            contract={editingContract || undefined}
            onSuccess={handleFormSuccess}
            onPendingChange={setFormPending}
            onCancel={() => {
              setIsFormOpen(false);
              setFormPending(false);
              setEditingContract(null);
            }}
          />
        </FinancialDrawer>

        <FinancialConfirmationDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmation(null);
          }}
          title={
            confirmation?.kind === 'regenerate'
              ? 'Regenerar comissões?'
              : 'Excluir contrato?'
          }
          description={
            confirmation
              ? confirmation.kind === 'regenerate'
                ? `As comissões atuais do contrato ${confirmation.contract.contract_number || confirmation.contract.id.slice(0, 8)} serão excluídas e recriadas com base nos corretores vinculados.`
                : `O contrato ${confirmation.contract.contract_number || confirmation.contract.id.slice(0, 8)}${confirmation.contract.client_name || confirmation.contract.lead?.name ? `, de ${confirmation.contract.client_name || confirmation.contract.lead?.name},` : ''} será excluído permanentemente.`
              : 'Revise a ação antes de continuar.'
          }
          confirmLabel={
            confirmation?.kind === 'regenerate'
              ? 'Regenerar comissões'
              : 'Excluir contrato'
          }
          destructive={confirmation?.kind === 'delete'}
          isPending={
            confirmation?.kind === 'regenerate'
              ? regenerateCommissions.isPending
              : deleteContract.isPending
          }
          onConfirm={() => {
            if (!confirmation) return;
            if (confirmation.kind === 'regenerate') {
              regenerateCommissions.mutate(confirmation.contract.id, {
                onSuccess: () => setConfirmation(null),
              });
              return;
            }
            deleteContract.mutate(confirmation.contract.id, {
              onSuccess: () => setConfirmation(null),
            });
          }}
        />

        <FinancialConfirmationDialog
          open={noBrokersContract !== null}
          onOpenChange={(open) => {
            if (!open) setNoBrokersContract(null);
          }}
          title="Ativar contrato sem corretores?"
          description={
            noBrokersContract
              ? `O contrato ${noBrokersContract.contract_number || noBrokersContract.id.slice(0, 8)} será ativado, mas nenhuma comissão será gerada porque não há corretores vinculados.`
              : 'Vincule corretores antes de ativar para gerar as comissões.'
          }
          confirmLabel="Ativar sem comissões"
          isPending={activateContract.isPending}
          onConfirm={() => {
            if (noBrokersContract) handleActivate(noBrokersContract, true);
          }}
        />

      </div>
    </AppLayout>
  );
}
