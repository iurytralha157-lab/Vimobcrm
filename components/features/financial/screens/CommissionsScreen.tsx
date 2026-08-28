'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CommissionStatusBadge } from '@/components/features/financial/CommissionStatusBadge';
import { FinancialDrawer } from '@/components/features/financial/FinancialDrawer';
import { FinancialEmptyState } from '@/components/features/financial/FinancialEmptyState';
import { FinancialConfirmationDialog } from '@/components/features/financial/FinancialConfirmationDialog';

import { useIsMobile } from '@/hooks/use-mobile';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { searchTextIncludes } from '@/lib/search-text';
import {
  useCommissions,
  useCommissionRules,
  useApproveCommission,
  usePayCommission,
  useCancelCommission,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule
} from '@/hooks/use-commissions';
import type { Commission, CommissionRule } from '@/hooks/use-commissions';
import { formatCurrency, formatDate, exportToExcel, prepareCommissionsExport } from '@/lib/export-financial';
import {
  Plus,
  Search,
  MoreHorizontal,
  BadgeDollarSign,
  CheckCircle2,
  Trash2,
  Download,
  XCircle,
  DollarSign,
  Pencil,
  User,
  FileText,
  Building2,
  Calendar,
  Settings2,
  Loader2,
} from "lucide-react";
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

// Mobile Commission Card - Melhorado para mobile
function CommissionCard({ commission, onApprove, onPay, onCancel, canManage, actionsPending }: {
  commission: Commission;
  onApprove: () => void;
  onPay: () => void;
  onCancel: () => void;
  canManage: boolean;
  actionsPending: boolean;
}) {
  return (
    <Card className="app-card-soft mb-2 sm:mb-3">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <User className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-xs sm:text-sm truncate">{commission.user?.name || '-'}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
              {commission.contract?.contract_number && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {commission.contract.contract_number}
                </span>
              )}
              {commission.property?.code && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {commission.property.code}
                </span>
              )}
            </div>
          </div>
          <CommissionStatusBadge status={commission.status} />
        </div>

        <div className="app-card-soft grid grid-cols-3 gap-1.5 sm:gap-2 mb-2 sm:mb-3 p-2">
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground">Base</p>
            <p className="text-xs sm:text-sm font-medium truncate">{formatCurrency(commission.base_value)}</p>
          </div>
          <div className="border-x border-border/60 text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground">%</p>
            <p className="text-xs sm:text-sm font-medium">{commission.percentage ? `${commission.percentage}%` : '-'}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground">Comissão</p>
            <p className="truncate text-xs font-normal text-primary sm:text-sm">{formatCurrency(commission.calculated_value)}</p>
          </div>
        </div>

        {commission.forecast_date && (
          <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1 mb-2">
            <Calendar className="h-3 w-3" />
            Previsão: {formatDate(commission.forecast_date)}
          </p>
        )}

        {(commission.status === 'forecast' || canManage) && (
        <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 sm:gap-2">
          {commission.status === 'forecast' && (
            <p className="flex-1 text-[10px] sm:text-xs text-muted-foreground italic">
              Aguardando 1º pagamento do contrato
            </p>
          )}
          {canManage && commission.status === 'pending' && (
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onApprove} disabled={actionsPending}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Aprovar
            </Button>
          )}
          {canManage && commission.status === 'approved' && (
            <Button size="sm" className="flex-1 h-8 text-xs" onClick={onPay} disabled={actionsPending}>
              <DollarSign className="h-3.5 w-3.5 mr-1" />
              Pagar
            </Button>
          )}
          {canManage && (commission.status === 'forecast' || commission.status === 'pending' || commission.status === 'approved') && (
            <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0" onClick={onCancel} disabled={actionsPending}>
              <XCircle className="h-4 w-4" />
              <span className="sr-only">Cancelar comissão</span>
            </Button>
          )}
        </div>
        )}
      </CardContent>
    </Card>
  );
}

// Mobile Rule Card - Melhorado para mobile
function RuleCard({ rule, onEdit, onDelete, canManage, actionsPending }: {
  rule: CommissionRule;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
  actionsPending: boolean;
}) {
  return (
    <Card className="app-card-soft mb-2 sm:mb-3">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-xs sm:text-sm truncate">{rule.name}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5 sm:mt-2">
              <Badge variant="outline" className="text-[10px] sm:text-xs h-5">
                {rule.business_type === 'sale' ? 'Venda' :
                 rule.business_type === 'rental' ? 'Locação' :
                 rule.business_type === 'service' ? 'Serviço' : 'Todos'}
              </Badge>
              <Badge variant="secondary" className="text-[10px] sm:text-xs h-5">
                {rule.commission_type === 'percentage'
                  ? `${rule.commission_value}%`
                  : formatCurrency(rule.commission_value)}
              </Badge>
              <Badge
                variant={rule.is_active ? 'default' : 'secondary'}
                className={`text-[10px] sm:text-xs h-5 ${rule.is_active ? 'bg-success text-success-foreground' : ''}`}
              >
                {rule.is_active ? 'Ativa' : 'Inativa'}
              </Badge>
            </div>
          </div>
          {canManage && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações da regra ${rule.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuItem onClick={onEdit} disabled={actionsPending}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete} disabled={actionsPending}>
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Commissions() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { hasPermission } = useUserPermissions();
  const canManage = hasPermission('financial_manage');
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [payDialog, setPayDialog] = useState<{ open: boolean; commission: Commission | null }>({ open: false, commission: null });
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; commission: Commission | null }>({ open: false, commission: null });
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: CommissionRule | null }>({ open: false, rule: null });
  const [commissionToApprove, setCommissionToApprove] = useState<Commission | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<CommissionRule | null>(null);
  const [paymentProof, setPaymentProof] = useState('');
  const [cancelNotes, setCancelNotes] = useState('');

  // Rules form state
  const [ruleName, setRuleName] = useState('');
  const [ruleBusinessType, setRuleBusinessType] = useState<CommissionRule['business_type']>('sale');
  const [ruleCommissionType, setRuleCommissionType] = useState<CommissionRule['commission_type']>('percentage');
  const [ruleValue, setRuleValue] = useState(0);
  const [ruleActive, setRuleActive] = useState(true);

  const statusMap: Record<string, string | undefined> = {
    forecast: 'forecast',
    pending: 'pending',
    approved: 'approved',
    paid: 'paid',
    rules: undefined,
  };

  const {
    data: commissions,
    isLoading: commissionsLoading,
    error: commissionsError,
    refetch: refetchCommissions,
  } = useCommissions(
    { status: statusMap[activeTab] },
    { enabled: activeTab !== 'rules' },
  );
  const {
    data: rules,
    isLoading: rulesLoading,
    error: rulesError,
    refetch: refetchRules,
  } = useCommissionRules({ enabled: activeTab === 'rules' });

  const approveCommission = useApproveCommission();
  const payCommission = usePayCommission();
  const cancelCommission = useCancelCommission();
  const createRule = useCreateCommissionRule();
  const updateRule = useUpdateCommissionRule();
  const deleteRule = useDeleteCommissionRule();
  const commissionActionsPending =
    approveCommission.isPending ||
    payCommission.isPending ||
    cancelCommission.isPending;
  const ruleActionsPending =
    createRule.isPending || updateRule.isPending || deleteRule.isPending;
  const ruleValueError =
    !Number.isFinite(ruleValue) || ruleValue <= 0
      ? 'Informe um valor maior que zero.'
      : ruleCommissionType === 'percentage' && ruleValue > 100
        ? 'O percentual não pode exceder 100%.'
        : null;
  const ruleNameError = !ruleName.trim() ? 'Informe o nome da regra.' : null;

  const filteredCommissions = commissions?.filter(c =>
    searchTextIncludes(c.user?.name, searchQuery) ||
    searchTextIncludes(c.contract?.contract_number, searchQuery)
  ) || [];

  const handleExport = () => {
    if (!filteredCommissions.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    const data = prepareCommissionsExport(filteredCommissions);
    exportToExcel(data, `comissoes-${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success('Arquivo exportado com sucesso');
  };

  const handleApprove = (commission: Commission) =>
    setCommissionToApprove(commission);

  const closePayDialog = () => {
    setPayDialog({ open: false, commission: null });
    setPaymentProof('');
  };

  const closeCancelDialog = () => {
    setCancelDialog({ open: false, commission: null });
    setCancelNotes('');
  };

  const handlePay = () => {
    if (!payDialog.commission) return;
    payCommission.mutate(
      {
        id: payDialog.commission.id,
        payment_proof: paymentProof.trim() || undefined,
      },
      { onSuccess: closePayDialog },
    );
  };

  const handleCancel = () => {
    if (!cancelDialog.commission) return;
    cancelCommission.mutate(
      {
        id: cancelDialog.commission.id,
        notes: cancelNotes.trim() || undefined,
      },
      { onSuccess: closeCancelDialog },
    );
  };

  const handleSaveRule = () => {
    if (ruleNameError || ruleValueError || ruleActionsPending) return;
    const payload: Partial<CommissionRule> = {
      name: ruleName.trim(),
      business_type: ruleBusinessType,
      commission_type: ruleCommissionType,
      commission_value: ruleValue,
      is_active: ruleActive,
    };

    if (ruleDialog.rule) {
      updateRule.mutate(
        { id: ruleDialog.rule.id, ...payload },
        {
          onSuccess: () => {
            setRuleDialog({ open: false, rule: null });
            resetRuleForm();
          },
        },
      );
      return;
    }
    createRule.mutate(payload, {
      onSuccess: () => {
        setRuleDialog({ open: false, rule: null });
        resetRuleForm();
      },
    });
  };

  const handleDeleteRule = (rule: CommissionRule) => setRuleToDelete(rule);

  const openRuleDialog = (rule?: CommissionRule) => {
    if (rule) {
      setRuleName(rule.name);
      setRuleBusinessType(rule.business_type);
      setRuleCommissionType(rule.commission_type);
      setRuleValue(rule.commission_value);
      setRuleActive(rule.is_active);
    } else {
      resetRuleForm();
    }
    setRuleDialog({ open: true, rule: rule || null });
  };

  const resetRuleForm = () => {
    setRuleName('');
    setRuleBusinessType('sale');
    setRuleCommissionType('percentage');
    setRuleValue(0);
    setRuleActive(true);
  };

  const CommissionsTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Corretor</TableHead>
          <TableHead>Contrato</TableHead>
          <TableHead>Imóvel</TableHead>
          <TableHead className="text-right">Valor Base</TableHead>
          <TableHead className="text-right">%</TableHead>
          <TableHead className="text-right">Valor Comissão</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Previsão</TableHead>
          {canManage && <TableHead className="w-10"></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredCommissions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={canManage ? 9 : 8} className="py-12">
              <FinancialEmptyState
                title="Nenhuma comissão encontrada"
                description={activeTab === 'rules' ? "Nenhuma regra de comissão cadastrada." : "Não encontramos comissões para o filtro selecionado."}
                actionLabel={activeTab === 'rules' ? "Criar Regra" : undefined}
                onAction={activeTab === 'rules' ? () => openRuleDialog() : undefined}
              />
            </TableCell>
          </TableRow>
        ) : (
          filteredCommissions.map((commission) => (
            <TableRow key={commission.id}>
              <TableCell className="font-medium">{commission.user?.name || '-'}</TableCell>
              <TableCell>{commission.contract?.contract_number || '-'}</TableCell>
              <TableCell>{commission.property?.code || '-'}</TableCell>
              <TableCell className="text-right">{formatCurrency(commission.base_value)}</TableCell>
              <TableCell className="text-right">{commission.percentage ? `${commission.percentage}%` : '-'}</TableCell>
              <TableCell className="text-right font-medium">{formatCurrency(commission.calculated_value)}</TableCell>
              <TableCell>
                <CommissionStatusBadge status={commission.status} />
              </TableCell>
              <TableCell>{formatDate(commission.forecast_date)}</TableCell>
              {canManage && (
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Ações da comissão de ${commission.user?.name || 'corretor'}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover">
                      {commission.status === 'pending' && (
                        <DropdownMenuItem onClick={() => handleApprove(commission)} disabled={commissionActionsPending}>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Aprovar
                        </DropdownMenuItem>
                      )}
                      {commission.status === 'approved' && (
                        <DropdownMenuItem onClick={() => {
                          setPayDialog({ open: true, commission });
                        }} disabled={commissionActionsPending}>
                          <DollarSign className="h-4 w-4 mr-2" />
                          Registrar Pagamento
                        </DropdownMenuItem>
                      )}
                      {(commission.status === 'forecast' || commission.status === 'pending' || commission.status === 'approved') && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setCancelDialog({ open: true, commission })}
                          disabled={commissionActionsPending}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Cancelar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <AppLayout title="Comissões">
      <div className="space-y-3 sm:space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <p className="text-xs sm:text-sm text-muted-foreground">
            Gerencie comissões e repasses
          </p>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size={isMobile ? "sm" : "default"}
              onClick={() => router.push("/financeiro/corretor")}
              className="flex-1 sm:flex-none"
            >
              <User className="h-4 w-4 mr-1.5" />
              Minhas Comissões
            </Button>
            {activeTab !== 'rules' && <Button
              variant="outline"
              size={isMobile ? "sm" : "default"}
              onClick={handleExport}
              className="flex-1 sm:flex-none"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Exportar
            </Button>}
          </div>
        </div>

        {/* Tabs */}
        {activeTab !== 'rules' && commissionsError && commissions && (
          <div className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground" role="alert">
            <span>As comissões podem estar desatualizadas.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void refetchCommissions()}>
              Atualizar novamente
            </Button>
          </div>
        )}
        {activeTab === 'rules' && rulesError && rules && (
          <div className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground" role="alert">
            <span>As regras podem estar desatualizadas.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void refetchRules()}>
              Atualizar novamente
            </Button>
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div
            data-collapse="standard"
            className="app-responsive-tab-list min-w-0 flex-1"
          >
            <TabsList
              data-responsive-tab-scroll
              aria-label="Status das comissões"
              className="flex w-fit max-w-full flex-nowrap justify-start overflow-x-auto"
            >
              <TabsTrigger
                value="forecast"
                data-responsive-tab
                aria-label="Previstas"
                title="Previstas"
                className="shrink-0 gap-2 text-xs sm:text-sm"
              >
                <Calendar aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="app-responsive-tab-label">Previstas</span>
              </TabsTrigger>
              <TabsTrigger
                value="pending"
                data-responsive-tab
                aria-label="Liberadas"
                title="Liberadas"
                className="shrink-0 gap-2 text-xs sm:text-sm"
              >
                <DollarSign aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="app-responsive-tab-label">Liberadas</span>
              </TabsTrigger>
              <TabsTrigger
                value="approved"
                data-responsive-tab
                aria-label="Aprovadas"
                title="Aprovadas"
                className="shrink-0 gap-2 text-xs sm:text-sm"
              >
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="app-responsive-tab-label">Aprovadas</span>
              </TabsTrigger>
              <TabsTrigger
                value="paid"
                data-responsive-tab
                aria-label="Pagas"
                title="Pagas"
                className="shrink-0 gap-2 text-xs sm:text-sm"
              >
                <BadgeDollarSign
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                />
                <span className="app-responsive-tab-label">Pagas</span>
              </TabsTrigger>
              <TabsTrigger
                value="rules"
                data-responsive-tab
                aria-label="Regras"
                title="Regras"
                className="shrink-0 gap-2 text-xs sm:text-sm"
              >
                <Settings2 aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="app-responsive-tab-label">Regras</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Commissions Tabs */}
          {["forecast", "pending", "approved", "paid"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <Card className="app-card">
                <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-3 md:pb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar corretor ou contrato..."
                      className="pl-9 h-9 sm:h-10 text-sm"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-2 sm:p-3 md:p-4 pt-0">
                  {commissionsLoading ? (
                    <div className="space-y-2 sm:space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-20 sm:h-24 md:h-12" />
                      ))}
                    </div>
                  ) : commissionsError && !commissions ? (
                    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
                      <p className="text-sm text-destructive">Não foi possível carregar as comissões.</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => void refetchCommissions()}>
                        Tentar novamente
                      </Button>
                    </div>
                  ) : isMobile ? (
                    <div className="p-4">
                      {filteredCommissions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Nenhuma comissão encontrada
                        </div>
                      ) : (
                        filteredCommissions.map((commission) => (
                          <CommissionCard
                            key={commission.id}
                            commission={commission}
                            canManage={canManage}
                            actionsPending={commissionActionsPending}
                            onApprove={() => handleApprove(commission)}
                            onPay={() =>
                              setPayDialog({ open: true, commission })
                            }
                            onCancel={() =>
                              setCancelDialog({ open: true, commission })
                            }
                          />
                        ))
                      )}
                    </div>
                  ) : (
                    <CommissionsTable />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}

          {/* Rules Tab */}
          <TabsContent value="rules">
            <Card className="app-card">
              <CardHeader className="flex flex-row items-center justify-between pb-3 md:pb-4">
                <CardTitle className="text-base md:text-lg">
                  Regras de Comissão
                </CardTitle>
                {canManage && <Button
                  size={isMobile ? "sm" : "default"}
                  onClick={() => openRuleDialog()}
                >
                  <Plus className="h-4 w-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Nova Regra</span>
                  <span className="sm:hidden">Nova</span>
                </Button>}
              </CardHeader>
              <CardContent className="p-0 md:p-0">
                {rulesLoading ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-16 md:h-12" />
                    ))}
                  </div>
                ) : rulesError && !rules ? (
                  <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
                    <p className="text-sm text-destructive">Não foi possível carregar as regras.</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => void refetchRules()}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : isMobile ? (
                  <div className="p-4">
                    {rules?.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        Nenhuma regra cadastrada
                      </div>
                    ) : (
                      rules?.map((rule) => (
                        <RuleCard
                          key={rule.id}
                          rule={rule}
                          canManage={canManage}
                          actionsPending={ruleActionsPending}
                          onEdit={() => openRuleDialog(rule)}
                          onDelete={() => handleDeleteRule(rule)}
                        />
                      ))
                    )}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Tipo de Negócio</TableHead>
                        <TableHead>Tipo de Comissão</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status</TableHead>
                        {canManage && <TableHead className="w-10"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules?.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={canManage ? 6 : 5}
                            className="text-center py-8 text-muted-foreground"
                          >
                            Nenhuma regra cadastrada
                          </TableCell>
                        </TableRow>
                      ) : (
                        rules?.map((rule) => (
                          <TableRow key={rule.id}>
                            <TableCell className="font-medium">
                              {rule.name}
                            </TableCell>
                            <TableCell>
                              {rule.business_type === "sale"
                                ? "Venda"
                                : rule.business_type === "rental"
                                  ? "Locação"
                                  : rule.business_type === "service"
                                    ? "Serviço"
                                    : "Todos"}
                            </TableCell>
                            <TableCell>
                              {rule.commission_type === "percentage"
                                ? "Percentual"
                                : "Valor Fixo"}
                            </TableCell>
                            <TableCell className="text-right">
                              {rule.commission_type === "percentage"
                                ? `${rule.commission_value}%`
                                : formatCurrency(rule.commission_value)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`text-sm font-medium ${rule.is_active ? "text-success" : "text-muted-foreground"}`}
                              >
                                {rule.is_active ? "Ativa" : "Inativa"}
                              </span>
                            </TableCell>
                            {canManage && (
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Ações da regra ${rule.name}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => openRuleDialog(rule)}
                                      disabled={ruleActionsPending}
                                    >
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Editar
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => handleDeleteRule(rule)}
                                      disabled={ruleActionsPending}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Excluir
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Pay Dialog */}
        <Dialog
          open={payDialog.open}
          onOpenChange={(open) => {
            if (!open && !payCommission.isPending) closePayDialog();
          }}
        >
          <DialogContent
            className="w-[90%] sm:max-w-md sm:w-full rounded-lg"
            onEscapeKeyDown={(event) => {
              if (payCommission.isPending) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (payCommission.isPending) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Registrar Pagamento</DialogTitle>
              <DialogDescription>
                Confirme o pagamento da comissão de{" "}
                {payDialog.commission?.user?.name}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                handlePay();
              }}
            >
            <div className="space-y-4">
              <div>
                <Label>Valor</Label>
                <p className="text-2xl font-normal">
                  {formatCurrency(payDialog.commission?.calculated_value)}
                </p>
              </div>
              <div>
                <Label htmlFor="commission-payment-proof">Comprovante (opcional)</Label>
                <Input
                  id="commission-payment-proof"
                  placeholder="URL ou referência do comprovante"
                  value={paymentProof}
                  maxLength={2_000}
                  disabled={payCommission.isPending}
                  onChange={(e) => setPaymentProof(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-[40%] rounded-lg"
                onClick={closePayDialog}
                disabled={payCommission.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="w-[60%] rounded-lg"
                disabled={payCommission.isPending}
              >
                {payCommission.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {payCommission.isPending ? 'Processando...' : 'Confirmar Pagamento'}
              </Button>
            </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Cancel Dialog */}
        <Dialog
          open={cancelDialog.open}
          onOpenChange={(open) => {
            if (!open && !cancelCommission.isPending) closeCancelDialog();
          }}
        >
          <DialogContent
            className="w-[90%] sm:max-w-md sm:w-full rounded-lg"
            onEscapeKeyDown={(event) => {
              if (cancelCommission.isPending) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (cancelCommission.isPending) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Cancelar Comissão</DialogTitle>
              <DialogDescription>
                Você pode registrar um motivo para manter o histórico da decisão.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleCancel();
              }}
            >
            <div className="space-y-4">
              <div>
                <Label htmlFor="commission-cancel-notes">Motivo (opcional)</Label>
                <Input
                  id="commission-cancel-notes"
                  placeholder="Descreva o motivo..."
                  value={cancelNotes}
                  maxLength={2_000}
                  disabled={cancelCommission.isPending}
                  onChange={(e) => setCancelNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="w-[40%] rounded-lg"
                onClick={() =>
                  closeCancelDialog()
                }
                disabled={cancelCommission.isPending}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="w-[60%] rounded-lg"
                disabled={cancelCommission.isPending}
              >
                {cancelCommission.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {cancelCommission.isPending ? 'Processando...' : 'Confirmar Cancelamento'}
              </Button>
            </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Rule Drawer */}
        <FinancialDrawer
          open={ruleDialog.open}
          onOpenChange={(open) => {
            if (createRule.isPending || updateRule.isPending) return;
            setRuleDialog({ open, rule: null });
            if (!open) resetRuleForm();
          }}
          title={ruleDialog.rule ? "Editar Regra" : "Nova Regra"}
          description="Configure a regra de comissão"
          pending={createRule.isPending || updateRule.isPending}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              handleSaveRule();
            }}
          >
          <div className="space-y-4">
            <div>
              <Label htmlFor="commission-rule-name">Nome da Regra</Label>
              <Input
                id="commission-rule-name"
                placeholder="Ex: Comissão padrão vendas"
                value={ruleName}
                maxLength={180}
                aria-invalid={Boolean(ruleNameError)}
                aria-describedby={ruleNameError ? 'commission-rule-name-error' : undefined}
                disabled={createRule.isPending || updateRule.isPending}
                onChange={(e) => setRuleName(e.target.value)}
              />
              {ruleNameError && (
                <p id="commission-rule-name-error" className="mt-1 text-xs text-destructive" role="alert">
                  {ruleNameError}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="commission-rule-business-type">Tipo de Negócio</Label>
                <Select
                  value={ruleBusinessType}
                  disabled={createRule.isPending || updateRule.isPending}
                  onValueChange={(value) =>
                    setRuleBusinessType(
                      value as CommissionRule["business_type"],
                    )
                  }
                >
                  <SelectTrigger id="commission-rule-business-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="sale">Venda</SelectItem>
                    <SelectItem value="rental">Locação</SelectItem>
                    <SelectItem value="service">Serviço</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="commission-rule-type">Tipo de Comissão</Label>
                <Select
                  value={ruleCommissionType}
                  disabled={createRule.isPending || updateRule.isPending}
                  onValueChange={(value) =>
                    setRuleCommissionType(
                      value as CommissionRule["commission_type"],
                    )
                  }
                >
                  <SelectTrigger id="commission-rule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentual</SelectItem>
                    <SelectItem value="fixed">Valor Fixo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="commission-rule-value">
                {ruleCommissionType === "percentage"
                  ? "Percentual (%)"
                  : "Valor (R$)"}
              </Label>
              <Input
                id="commission-rule-value"
                type="number"
                min="0.01"
                max={ruleCommissionType === 'percentage' ? 100 : undefined}
                step={ruleCommissionType === "percentage" ? "0.1" : "0.01"}
                value={ruleValue}
                aria-invalid={Boolean(ruleValueError)}
                aria-describedby={ruleValueError ? 'commission-rule-value-error' : undefined}
                disabled={createRule.isPending || updateRule.isPending}
                onChange={(e) =>
                  setRuleValue(
                    e.target.value === '' ? 0 : Number(e.target.value),
                  )
                }
              />
              {ruleValueError && (
                <p id="commission-rule-value-error" className="mt-1 text-xs text-destructive" role="alert">
                  {ruleValueError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="commission-rule-active"
                checked={ruleActive}
                onCheckedChange={setRuleActive}
                disabled={createRule.isPending || updateRule.isPending}
              />
              <Label htmlFor="commission-rule-active">Regra ativa</Label>
            </div>
          </div>
          <div className="flex gap-2 pt-6">
            <Button
              type="button"
              variant="outline"
              className="w-[40%] rounded-lg"
              onClick={() => {
                setRuleDialog({ open: false, rule: null });
                resetRuleForm();
              }}
              disabled={createRule.isPending || updateRule.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="w-[60%] rounded-lg"
              disabled={
                createRule.isPending ||
                updateRule.isPending ||
                Boolean(ruleNameError) ||
                Boolean(ruleValueError)
              }
            >
              {(createRule.isPending || updateRule.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {createRule.isPending || updateRule.isPending
                ? 'Processando...'
                : ruleDialog.rule
                  ? 'Salvar'
                  : 'Criar Regra'}
            </Button>
          </div>
          </form>
        </FinancialDrawer>

        <FinancialConfirmationDialog
          open={commissionToApprove !== null}
          onOpenChange={(open) => {
            if (!open) setCommissionToApprove(null);
          }}
          title="Aprovar comissão?"
          description={
            commissionToApprove
              ? `A comissão de ${formatCurrency(commissionToApprove.calculated_value)}, destinada a ${commissionToApprove.user?.name || 'corretor não identificado'}, ficará disponível para pagamento.`
              : 'Revise a comissão antes de continuar.'
          }
          confirmLabel="Aprovar comissão"
          isPending={approveCommission.isPending}
          onConfirm={() => {
            if (!commissionToApprove) return;
            approveCommission.mutate(commissionToApprove.id, {
              onSuccess: () => setCommissionToApprove(null),
            });
          }}
        />

        <FinancialConfirmationDialog
          open={ruleToDelete !== null}
          onOpenChange={(open) => {
            if (!open) setRuleToDelete(null);
          }}
          title="Excluir regra de comissão?"
          description={
            ruleToDelete
              ? `A regra “${ruleToDelete.name}” será excluída permanentemente e não poderá ser usada em novos cálculos.`
              : 'Esta ação não pode ser desfeita.'
          }
          confirmLabel="Excluir regra"
          destructive
          isPending={deleteRule.isPending}
          onConfirm={() => {
            if (!ruleToDelete) return;
            deleteRule.mutate(ruleToDelete.id, {
              onSuccess: () => setRuleToDelete(null),
            });
          }}
        />
      </div>
    </AppLayout>
  );
}
