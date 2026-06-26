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

import { useIsMobile } from '@/hooks/use-mobile';
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
  CheckCircle2,
  Trash2,
  Download,
  XCircle,
  DollarSign,
  Pencil,
  User,
  FileText,
  Building2,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

// Mobile Commission Card - Melhorado para mobile
function CommissionCard({ commission, onApprove, onPay, onCancel }: {
  commission: Commission;
  onApprove: () => void;
  onPay: () => void;
  onCancel: () => void;
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
          <div className="text-center border-x border-white/[0.055]">
            <p className="text-[10px] sm:text-xs text-muted-foreground">%</p>
            <p className="text-xs sm:text-sm font-medium">{commission.percentage ? `${commission.percentage}%` : '-'}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-muted-foreground">Comissão</p>
            <p className="text-xs sm:text-sm font-bold text-primary truncate">{formatCurrency(commission.calculated_value)}</p>
          </div>
        </div>

        {commission.forecast_date && (
          <p className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1 mb-2">
            <Calendar className="h-3 w-3" />
            Previsão: {formatDate(commission.forecast_date)}
          </p>
        )}

        <div className="flex items-center gap-1.5 sm:gap-2 pt-2 border-t border-white/[0.055]">
          {commission.status === 'forecast' && (
            <p className="flex-1 text-[10px] sm:text-xs text-muted-foreground italic">
              Aguardando 1º pagamento do contrato
            </p>
          )}
          {commission.status === 'pending' && (
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onApprove}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Aprovar
            </Button>
          )}
          {commission.status === 'approved' && (
            <Button size="sm" className="flex-1 h-8 text-xs" onClick={onPay}>
              <DollarSign className="h-3.5 w-3.5 mr-1" />
              Pagar
            </Button>
          )}
          {(commission.status === 'forecast' || commission.status === 'pending' || commission.status === 'approved') && (
            <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0" onClick={onCancel}>
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Mobile Rule Card - Melhorado para mobile
function RuleCard({ rule, onEdit, onDelete }: {
  rule: CommissionRule;
  onEdit: () => void;
  onDelete: () => void;
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Commissions() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [payDialog, setPayDialog] = useState<{ open: boolean; commission: Commission | null }>({ open: false, commission: null });
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; commission: Commission | null }>({ open: false, commission: null });
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: CommissionRule | null }>({ open: false, rule: null });
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

  const { data: commissions, isLoading: commissionsLoading } = useCommissions({
    status: statusMap[activeTab]
  });
  const { data: rules, isLoading: rulesLoading } = useCommissionRules();

  const approveCommission = useApproveCommission();
  const payCommission = usePayCommission();
  const cancelCommission = useCancelCommission();
  const createRule = useCreateCommissionRule();
  const updateRule = useUpdateCommissionRule();
  const deleteRule = useDeleteCommissionRule();

  const filteredCommissions = commissions?.filter(c =>
    c.user?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contract?.contract_number?.toLowerCase().includes(searchQuery.toLowerCase())
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

  const handleApprove = async (id: string) => {
    if (confirm('Tem certeza que deseja aprovar esta comissão?')) {
      await approveCommission.mutateAsync(id);
    }
  };

  const handlePay = async () => {
    if (!payDialog.commission) return;
    await payCommission.mutateAsync({
      id: payDialog.commission.id,
      payment_proof: paymentProof || undefined,
    });
    setPayDialog({ open: false, commission: null });
    setPaymentProof('');
  };

  const handleCancel = async () => {
    if (!cancelDialog.commission) return;
    await cancelCommission.mutateAsync({
      id: cancelDialog.commission.id,
      notes: cancelNotes,
    });
    setCancelDialog({ open: false, commission: null });
    setCancelNotes('');
  };

  const handleSaveRule = async () => {
    const payload: Partial<CommissionRule> = {
      name: ruleName,
      business_type: ruleBusinessType,
      commission_type: ruleCommissionType,
      commission_value: ruleValue,
      is_active: ruleActive,
    };

    if (ruleDialog.rule) {
      await updateRule.mutateAsync({ id: ruleDialog.rule.id, ...payload });
    } else {
      await createRule.mutateAsync(payload);
    }
    setRuleDialog({ open: false, rule: null });
    resetRuleForm();
  };

  const handleDeleteRule = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta regra?')) {
      await deleteRule.mutateAsync(id);
    }
  };

  const openRuleDialog = (rule?: CommissionRule) => {
    if (rule) {
      setRuleName(rule.name);
      setRuleBusinessType(rule.business_type);
      setRuleCommissionType(rule.commission_type);
      setRuleValue(rule.commission_value);
      setRuleActive(rule.is_active);
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
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredCommissions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9} className="py-12">
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
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover">
                    {commission.status === 'pending' && (
                      <DropdownMenuItem onClick={() => handleApprove(commission.id)}>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Aprovar
                      </DropdownMenuItem>
                    )}
                    {commission.status === 'approved' && (
                      <DropdownMenuItem onClick={() => {
                        setPayDialog({ open: true, commission });
                      }}>
                        <DollarSign className="h-4 w-4 mr-2" />
                        Registrar Pagamento
                      </DropdownMenuItem>
                    )}
                    {(commission.status === 'forecast' || commission.status === 'pending' || commission.status === 'approved') && (
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setCancelDialog({ open: true, commission })}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Cancelar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
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
          <p className="text-xs sm:text-sm text-muted-foreground">Gerencie comissões e repasses</p>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" size={isMobile ? "sm" : "default"} onClick={() => router.push('/financeiro/corretor')} className="flex-1 sm:flex-none">
              <User className="h-4 w-4 mr-1.5" />
              Minhas Comissões
            </Button>
            <Button variant="outline" size={isMobile ? "sm" : "default"} onClick={handleExport} className="flex-1 sm:flex-none">
              <Download className="h-4 w-4 mr-1.5" />
              Exportar
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="forecast" className="text-xs sm:text-sm">
              Previstas
            </TabsTrigger>
            <TabsTrigger value="pending" className="text-xs sm:text-sm">
              Liberadas
            </TabsTrigger>
            <TabsTrigger value="approved" className="text-xs sm:text-sm">
              Aprovadas
            </TabsTrigger>
            <TabsTrigger value="paid" className="text-xs sm:text-sm">
              Pagas
            </TabsTrigger>
            <TabsTrigger value="rules" className="text-xs sm:text-sm">
              Regras
            </TabsTrigger>
          </TabsList>

          {/* Commissions Tabs */}
          {['forecast', 'pending', 'approved', 'paid'].map((tab) => (
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
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 sm:h-24 md:h-12" />)}
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
                            onApprove={() => handleApprove(commission.id)}
                            onPay={() => setPayDialog({ open: true, commission })}
                            onCancel={() => setCancelDialog({ open: true, commission })}
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
                <CardTitle className="text-base md:text-lg">Regras de Comissão</CardTitle>
                <Button size={isMobile ? "sm" : "default"} onClick={() => openRuleDialog()}>
                  <Plus className="h-4 w-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Nova Regra</span>
                  <span className="sm:hidden">Nova</span>
                </Button>
              </CardHeader>
              <CardContent className="p-0 md:p-0">
                {rulesLoading ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 md:h-12" />)}
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
                          onEdit={() => openRuleDialog(rule)}
                          onDelete={() => handleDeleteRule(rule.id)}
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
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules?.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            Nenhuma regra cadastrada
                          </TableCell>
                        </TableRow>
                      ) : (
                        rules?.map((rule) => (
                          <TableRow key={rule.id}>
                            <TableCell className="font-medium">{rule.name}</TableCell>
                            <TableCell>
                              {rule.business_type === 'sale' ? 'Venda' :
                               rule.business_type === 'rental' ? 'Locação' :
                               rule.business_type === 'service' ? 'Serviço' : 'Todos'}
                            </TableCell>
                            <TableCell>
                              {rule.commission_type === 'percentage' ? 'Percentual' : 'Valor Fixo'}
                            </TableCell>
                            <TableCell className="text-right">
                              {rule.commission_type === 'percentage'
                                ? `${rule.commission_value}%`
                                : formatCurrency(rule.commission_value)}
                            </TableCell>
                            <TableCell>
                              <span className={`text-sm font-medium ${rule.is_active ? 'text-success' : 'text-muted-foreground'}`}>
                                {rule.is_active ? 'Ativa' : 'Inativa'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openRuleDialog(rule)}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => handleDeleteRule(rule.id)}
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
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Pay Dialog */}
        <Dialog open={payDialog.open} onOpenChange={(open) => setPayDialog({ open, commission: null })}>
          <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg">
            <DialogHeader>
              <DialogTitle>Registrar Pagamento</DialogTitle>
              <DialogDescription>
                Confirme o pagamento da comissão de {payDialog.commission?.user?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Valor</Label>
                <p className="text-2xl font-bold">{formatCurrency(payDialog.commission?.calculated_value)}</p>
              </div>
              <div>
                <Label>Comprovante (opcional)</Label>
                <Input
                  placeholder="URL ou referência do comprovante"
                  value={paymentProof}
                  onChange={(e) => setPaymentProof(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="w-[40%] rounded-xl" onClick={() => setPayDialog({ open: false, commission: null })}>
                Cancelar
              </Button>
              <Button className="w-[60%] rounded-xl" onClick={handlePay} disabled={payCommission.isPending}>
                Confirmar Pagamento
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Cancel Dialog */}
        <Dialog open={cancelDialog.open} onOpenChange={(open) => setCancelDialog({ open, commission: null })}>
          <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg">
            <DialogHeader>
              <DialogTitle>Cancelar Comissão</DialogTitle>
              <DialogDescription>
                Informe o motivo do cancelamento
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Motivo</Label>
                <Input
                  placeholder="Descreva o motivo..."
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="w-[40%] rounded-xl" onClick={() => setCancelDialog({ open: false, commission: null })}>
                Voltar
              </Button>
              <Button variant="destructive" className="w-[60%] rounded-xl" onClick={handleCancel} disabled={cancelCommission.isPending}>
                Confirmar Cancelamento
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Rule Drawer */}
        <FinancialDrawer
          open={ruleDialog.open}
          onOpenChange={(open) => {
            setRuleDialog({ open, rule: null });
            if (!open) resetRuleForm();
          }}
          title={ruleDialog.rule ? 'Editar Regra' : 'Nova Regra'}
          description="Configure a regra de comissão"
        >
          <div className="space-y-4">
            <div>
              <Label>Nome da Regra</Label>
              <Input
                placeholder="Ex: Comissão padrão vendas"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo de Negócio</Label>
                <Select
                  value={ruleBusinessType}
                  onValueChange={(value) => setRuleBusinessType(value as CommissionRule['business_type'])}
                >
                  <SelectTrigger>
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
                <Label>Tipo de Comissão</Label>
                <Select
                  value={ruleCommissionType}
                  onValueChange={(value) => setRuleCommissionType(value as CommissionRule['commission_type'])}
                >
                  <SelectTrigger>
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
              <Label>{ruleCommissionType === 'percentage' ? 'Percentual (%)' : 'Valor (R$)'}</Label>
              <Input
                type="number"
                step={ruleCommissionType === 'percentage' ? '0.1' : '0.01'}
                value={ruleValue}
                onChange={(e) => setRuleValue(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={ruleActive}
                onCheckedChange={setRuleActive}
              />
              <Label>Regra ativa</Label>
            </div>
          </div>
          <div className="flex gap-2 pt-6">
            <Button variant="outline" className="w-[40%] rounded-xl" onClick={() => {
              setRuleDialog({ open: false, rule: null });
              resetRuleForm();
            }}>
              Cancelar
            </Button>
            <Button className="w-[60%] rounded-xl" onClick={handleSaveRule} disabled={createRule.isPending || updateRule.isPending}>
              {ruleDialog.rule ? 'Salvar' : 'Criar Regra'}
            </Button>
          </div>
        </FinancialDrawer>

      </div>
    </AppLayout>
  );
}
