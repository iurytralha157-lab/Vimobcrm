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

import { useContracts, useActivateContract, useDeleteContract, useRegenerateCommissions, Contract } from '@/hooks/use-contracts';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatCurrency, formatDate, exportToExcel, prepareContractsExport } from '@/lib/export-financial';
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
function ContractCard({ contract, onActivate, onEdit, onDelete }: {
  contract: Contract;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const getTypeLabel = (type: string | null) => {
    if (!type) return '-';
    const types: Record<string, string> = {
      sale: 'Venda',
      rent: 'Locação',
      service: 'Serviço',
    };
    return types[type] || type;
  };

  return (
    <Card className="app-card-soft mb-2 sm:mb-3 cursor-pointer transition-colors hover:bg-white/[0.055]" onClick={() => router.push(`/financeiro/contratos/${contract.id}`)}>
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

        <div className="flex items-center justify-between pt-2 sm:pt-3 border-t border-white/[0.055] gap-2">
          <p className="font-bold text-primary text-sm sm:text-base">{formatCurrency(contract.value)}</p>
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {contract.status === 'draft' && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onActivate}>
                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                Ativar
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Contracts() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [, setNoBrokersDialogId] = useState<string | null>(null);

  const { data: contracts, isLoading } = useContracts({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
  });

  const activateContract = useActivateContract();
  const deleteContract = useDeleteContract();
  const regenerateCommissions = useRegenerateCommissions();

  const filteredContracts = contracts?.filter(contract => {
    const leadName = contract.lead?.name?.toLowerCase() || '';
    const contractNumber = contract.contract_number?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return leadName.includes(query) || contractNumber.includes(query);
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

  const handleActivate = async (id: string, skipCommissions = false) => {
    try {
      await activateContract.mutateAsync({ contractId: id, skipCommissions });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'NO_BROKERS') {
        setNoBrokersDialogId(id);
      }
    }
  };

  const handleRegenerateCommissions = async (id: string) => {
    if (confirm('Isso irá excluir as comissões atuais e gerar novas baseadas nos corretores vinculados. Continuar?')) {
      await regenerateCommissions.mutateAsync(id);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir este contrato?')) {
      await deleteContract.mutateAsync(id);
    }
  };

  const handleEdit = (contract: Contract) => {
    setEditingContract(contract);
    setIsFormOpen(true);
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingContract(null);
  };

  const getTypeLabel = (type: string | null) => {
    if (!type) return '-';
    const types: Record<string, string> = {
      sale: 'Venda',
      rent: 'Locação',
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
            <Button size={isMobile ? "sm" : "default"} onClick={() => setIsFormOpen(true)}>
              <Plus className="h-4 w-4 mr-1 md:mr-2" />
              <span className="hidden sm:inline">Novo Contrato</span>
              <span className="sm:hidden">Novo</span>
            </Button>
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
                      <SelectItem value="rent">Locação</SelectItem>
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
              <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-white/[0.055]">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="sale">Venda</SelectItem>
                    <SelectItem value="rent">Locação</SelectItem>
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

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 md:h-12" />)}
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
                  onActivate={() => handleActivate(contract.id)}
                  onEdit={() => handleEdit(contract)}
                  onDelete={() => handleDelete(contract.id)}
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
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Nenhum contrato encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredContracts.map((contract) => (
                      <TableRow
                        key={contract.id}
                        className="cursor-pointer transition-colors hover:bg-white/[0.055]"
                        onClick={() => router.push(`/financeiro/contratos/${contract.id}`)}
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
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover">
                              {contract.status === 'draft' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleActivate(contract.id)}>
                                    <PlayCircle className="h-4 w-4 mr-2" />
                                    Ativar Contrato
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              {contract.status === 'active' && (
                                <>
                                  <DropdownMenuItem onClick={() => handleRegenerateCommissions(contract.id)}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Regenerar Comissões
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              <DropdownMenuItem onClick={() => handleEdit(contract)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(contract.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
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
        >
          <ContractForm
            contract={editingContract || undefined}
            onSuccess={handleFormSuccess}
            onCancel={() => setIsFormOpen(false)}
          />
        </FinancialDrawer>

      </div>
    </AppLayout>
  );
}
