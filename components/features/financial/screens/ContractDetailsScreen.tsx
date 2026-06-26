'use client';


import { useParams, useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContractStatusBadge } from '@/components/features/financial/ContractStatusBadge';
import { EntryStatusBadge } from '@/components/features/financial/EntryStatusBadge';
import { formatCurrency, formatDate } from '@/lib/export-financial';
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  User,
  Building2
} from 'lucide-react';
import { LeadTimeline } from '@/components/features/leads/LeadTimeline';
import { ContractDocuments } from '@/components/features/financial/ContractDocuments';
import type { FinancialEntry } from '@/hooks/use-financial';
import type { Commission } from '@/hooks/use-commissions';
import { useContract, type Contract } from '@/hooks/use-contracts';

type ContractDetailsCommission = Commission & {
  user?: { name?: string | null } | null;
};

type ContractDetailsData = Omit<Contract, 'lead' | 'property'> & {
  lead?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  property?: { code?: string | null; title?: string | null; endereco?: string | null } | null;
  entries?: FinancialEntry[] | null;
  commissions?: ContractDetailsCommission[] | null;
};

export default function ContractDetails() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const contractId = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();

  const { data: contractRaw, isLoading } = useContract(contractId);
  const contract = contractRaw as ContractDetailsData | null | undefined;

  if (isLoading) {
    return (
      <AppLayout title="Detalhes do Contrato">
        <div className="space-y-6">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-64 col-span-2" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!contract) return <div>Contrato não encontrado</div>;

  const entries = contract.entries ?? [];
  const commissions = contract.commissions ?? [];
  const totalPaid = entries.filter((entry) => entry.status === 'paid').reduce((acc, curr) => acc + Number(curr.amount), 0);
  const contractValue = Number(contract.value || 0);
  const paidProgress = contractValue > 0 ? Math.min((totalPaid / contractValue) * 100, 100) : 0;

  return (
    <AppLayout title={`Contrato ${contract.contract_number || 'S/N'}`}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
          <div className="flex gap-2">
            <Button variant="outline">Editar Contrato</Button>
            <Button>Gerar Aditivo</Button>
          </div>
        </div>

        {/* Summary Card */}
        <Card className="app-card bg-primary/[0.045] border-primary/10">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-lg px-3 py-1">
                    {contract.contract_number}
                  </Badge>
                  <ContractStatusBadge status={contract.status} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4" />
                    <span className="text-sm font-medium text-foreground">{contract.client_name || contract.lead?.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <span className="text-sm font-medium text-foreground">{contract.property?.code} - {contract.property?.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span className="text-sm font-medium text-foreground">Assinado em: {formatDate(contract.signing_date)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-sm font-medium text-foreground">Valor Total: {formatCurrency(contractValue)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center items-end gap-2 border-l pl-6 border-white/[0.055]">
                <p className="text-sm text-muted-foreground">Progresso Financeiro</p>
                <div className="text-right">
                  <p className="text-2xl font-bold text-success">{formatCurrency(totalPaid)}</p>
                  <p className="text-xs text-muted-foreground">Recebido de {formatCurrency(contractValue)}</p>
                </div>
                <div className="w-full bg-white/[0.08] rounded-full h-2 mt-2 min-w-[200px]">
                  <div
                    className="bg-success h-2 rounded-full transition-all"
                    style={{ width: `${paidProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs Content */}
        <Tabs defaultValue="installments" className="w-full">
          <TabsList className="grid w-full grid-cols-4 lg:w-[520px]">
            <TabsTrigger value="installments">Parcelas</TabsTrigger>
            <TabsTrigger value="commissions">Comissões</TabsTrigger>
            <TabsTrigger value="documents">Documentos</TabsTrigger>
            <TabsTrigger value="timeline">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="installments" className="mt-6">
            <Card className="app-card">
              <CardHeader>
                <CardTitle className="text-lg">Fluxo de Recebimento</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-white/[0.04]">
                      <tr>
                        <th className="px-4 py-3">Parcela</th>
                        <th className="px-4 py-3">Vencimento</th>
                        <th className="px-4 py-3">Valor</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Data Pagto</th>
                        <th className="px-4 py-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.055]">
                      {[...entries].sort((a, b) => (a.installment_number || 0) - (b.installment_number || 0)).map((entry) => (
                        <tr key={entry.id} className="transition-colors hover:bg-white/[0.055]">
                          <td className="px-4 py-3 font-medium">
                            {entry.installment_number === 0 ? 'Entrada' : `${entry.installment_number}/${entry.total_installments}`}
                          </td>
                          <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                          <td className="px-4 py-3 font-bold">{formatCurrency(entry.amount)}</td>
                          <td className="px-4 py-3">
                            <EntryStatusBadge status={entry.status} />
                          </td>
                          <td className="px-4 py-3">{entry.paid_date ? formatDate(entry.paid_date) : '-'}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="sm">Ver</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commissions" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">Divisão de Comissões</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {commissions.map((comm) => (
                    <div key={comm.id} className="app-card-soft flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                          {comm.user?.name?.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{comm.user?.name}</p>
                          <p className="text-xs text-muted-foreground">{comm.percentage}% da comissão</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">{formatCurrency(comm.calculated_value)}</p>
                        <Badge variant="outline" className="text-[10px] uppercase">{comm.status}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="text-lg">Resumo de Repasses</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-white/[0.055] pb-2">
                      <span className="text-sm text-muted-foreground">Total Comissões</span>
                      <span className="font-bold">{formatCurrency(commissions.reduce((acc, curr) => acc + Number(curr.calculated_value), 0))}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-white/[0.055] pb-2">
                      <span className="text-sm text-muted-foreground">Liberado para Pagto</span>
                      <span className="font-bold text-success">{formatCurrency(commissions.filter((c) => c.status === 'approved').reduce((acc, curr) => acc + Number(curr.calculated_value), 0))}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Pago aos Corretores</span>
                      <span className="font-bold text-primary">{formatCurrency(commissions.filter((c) => c.status === 'paid').reduce((acc, curr) => acc + Number(curr.calculated_value), 0))}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-6">
            <ContractDocuments
              contractId={contract.id}
              organizationId={contract.organization_id}
            />
          </TabsContent>

          <TabsContent value="timeline" className="mt-6">
            <Card className="app-card">
              <CardHeader>
                <CardTitle className="text-lg">Linha do Tempo do Contrato</CardTitle>
              </CardHeader>
              <CardContent>
                {contract.lead_id ? (
                  <LeadTimeline leadId={contract.lead_id} />
                ) : (
                  <p className="text-sm text-muted-foreground">Contrato sem lead vinculado.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
