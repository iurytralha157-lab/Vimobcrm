"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContractStatusBadge } from "@/components/features/financial/ContractStatusBadge";
import { EntryStatusBadge } from "@/components/features/financial/EntryStatusBadge";
import { formatCurrency, formatDate } from "@/lib/export-financial";
import {
  ArrowLeft,
  Building2,
  Calendar,
  DollarSign,
  FileText,
  History,
  Loader2,
  Percent,
  RefreshCw,
  User,
  WalletCards,
} from "lucide-react";
import { LeadTimeline } from "@/components/features/leads/LeadTimeline";
import { ContractDocuments } from "@/components/features/financial/ContractDocuments";
import { ContractForm } from "@/components/features/financial/ContractForm";
import { FinancialDrawer } from "@/components/features/financial/FinancialDrawer";
import type { FinancialEntry } from "@/hooks/use-financial";
import type { Commission } from "@/hooks/use-commissions";
import { useContract, type Contract } from "@/hooks/use-contracts";
import { useUserPermissions } from "@/hooks/use-user-permissions";

type ContractDetailsCommission = Commission & {
  user?: { name?: string | null } | null;
};

type ContractDetailsData = Omit<Contract, "lead" | "property"> & {
  lead?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  property?: {
    code?: string | null;
    title?: string | null;
    endereco?: string | null;
  } | null;
  entries?: FinancialEntry[] | null;
  commissions?: ContractDetailsCommission[] | null;
};

const COMMISSION_STATUS = {
  forecast: {
    label: "Prevista",
    className:
      "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
  },
  pending: {
    label: "Pendente",
    className: "bg-warning/10 text-warning",
  },
  approved: {
    label: "Aprovada",
    className: "bg-primary/10 text-primary",
  },
  paid: {
    label: "Paga",
    className: "bg-success/10 text-success",
  },
  cancelled: {
    label: "Cancelada",
    className: "bg-destructive/10 text-destructive",
  },
} satisfies Record<
  Commission["status"],
  { label: string; className: string }
>;

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textOrFallback(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function getPropertyLabel(property: ContractDetailsData["property"]) {
  const parts = [property?.code, property?.title]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : "Imóvel não vinculado";
}

function getInstallmentLabel(entry: FinancialEntry) {
  const installmentNumber = toFiniteNumber(entry.installment_number);
  const totalInstallments = toFiniteNumber(entry.total_installments);

  if (installmentNumber === 0) return "Entrada";
  if (installmentNumber > 0 && totalInstallments > 0) {
    return `${installmentNumber}/${totalInstallments}`;
  }
  if (installmentNumber > 0) return `Parcela ${installmentNumber}`;
  return "Parcela sem número";
}

export default function ContractDetails() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const contractId = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const { hasPermission, isLoading: permissionsLoading } =
    useUserPermissions();
  const canManage = hasPermission("financial_manage");
  const [isEditOpen, setIsEditOpen] = useState(false);

  const {
    data: contractRaw,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useContract(contractId);
  const contract = contractRaw as ContractDetailsData | null | undefined;

  if (isLoading || permissionsLoading) {
    return (
      <AppLayout title="Detalhes do Contrato">
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando detalhes do contrato</span>
          <Skeleton className="h-28 w-full rounded-[8px]" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Skeleton className="h-56 rounded-[8px] md:col-span-2" />
            <Skeleton className="h-56 rounded-[8px]" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error && !contract) {
    return (
      <AppLayout title="Detalhes do Contrato">
        <section
          className="app-card flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 py-8 text-center shadow-none sm:px-6"
          role="alert"
        >
          <h2 className="text-[14px] font-normal">
            Não foi possível carregar o contrato
          </h2>
          <p className="max-w-md text-[12px] font-light text-[var(--app-text-secondary)]">
            O contrato pode ter sido removido ou você pode não ter acesso a ele.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
              onClick={() => router.push("/financeiro/contratos")}
            >
              Voltar aos contratos
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
              disabled={isFetching}
              aria-busy={isFetching}
              onClick={() => void refetch()}
            >
              {isFetching && (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              )}
              {isFetching ? "Carregando..." : "Tentar novamente"}
            </Button>
          </div>
        </section>
      </AppLayout>
    );
  }

  if (!contract) {
    return (
      <AppLayout title="Detalhes do Contrato">
        <section className="app-card flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 py-8 text-center shadow-none sm:px-6">
          <h2 className="text-[14px] font-normal">Contrato não encontrado</h2>
          <p className="max-w-md text-[12px] font-light text-[var(--app-text-secondary)]">
            Verifique o endereço acessado ou volte para consultar os contratos
            disponíveis.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
            onClick={() => router.push("/financeiro/contratos")}
          >
            Voltar aos contratos
          </Button>
        </section>
      </AppLayout>
    );
  }

  const entries = contract.entries ?? [];
  const commissions = contract.commissions ?? [];
  const totalPaid = entries
    .filter((entry) => entry.status === "paid")
    .reduce(
      (acc, curr) =>
        acc +
        toFiniteNumber(
          curr.paid_value ?? curr.paid_amount ?? curr.amount ?? 0,
        ),
      0,
    );
  const contractValue = toFiniteNumber(contract.value);
  const paidProgress =
    contractValue > 0
      ? Math.min(Math.max((totalPaid / contractValue) * 100, 0), 100)
      : 0;
  const contractNumber = textOrFallback(contract.contract_number, "S/N");
  const clientName = textOrFallback(
    contract.client_name || contract.lead?.name,
    "Cliente não informado",
  );
  const propertyLabel = getPropertyLabel(contract.property);
  const totalCommissions = commissions.reduce(
    (acc, commission) => acc + toFiniteNumber(commission.calculated_value),
    0,
  );
  const approvedCommissions = commissions
    .filter((commission) => commission.status === "approved")
    .reduce(
      (acc, commission) => acc + toFiniteNumber(commission.calculated_value),
      0,
    );
  const paidCommissions = commissions
    .filter((commission) => commission.status === "paid")
    .reduce(
      (acc, commission) => acc + toFiniteNumber(commission.calculated_value),
      0,
    );

  return (
    <AppLayout title={`Contrato ${contractNumber}`}>
      <div className="space-y-4">
        {error && contract && (
          <div
            className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
            role="alert"
          >
            <span>Os detalhes podem estar desatualizados.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
              disabled={isFetching}
              aria-busy={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isFetching ? "Atualizando..." : "Atualizar novamente"}
            </Button>
          </div>
        )}
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            className="h-9 gap-2 rounded-[6px] px-3 text-[12px] font-light shadow-none"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar
          </Button>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
              onClick={() => setIsEditOpen(true)}
            >
              Editar contrato
            </Button>
          )}
        </div>

        {/* Summary Card */}
        <Card className="app-card overflow-hidden shadow-none">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-5 md:flex-row md:justify-between">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 py-1 text-[12px] font-light"
                  >
                    {contractNumber}
                  </Badge>
                  <ContractStatusBadge
                    status={contract.status}
                    className="rounded-[6px] border-0 text-[11px] font-light"
                  />
                </div>
                <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  <div className="flex min-w-0 items-start gap-2 text-[var(--app-text-tertiary)]">
                    <User className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words text-[12px] font-light text-[var(--app-text-primary)]">
                      {clientName}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-start gap-2 text-[var(--app-text-tertiary)]">
                    <Building2
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words text-[12px] font-light text-[var(--app-text-primary)]">
                      {propertyLabel}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-[var(--app-text-tertiary)]">
                    <Calendar
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-[12px] font-light text-[var(--app-text-primary)]">
                      Assinado em: {formatDate(contract.signing_date)}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-[var(--app-text-tertiary)]">
                    <DollarSign
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-[12px] font-light text-[var(--app-text-primary)]">
                      Valor Total: {formatCurrency(contractValue)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col items-start justify-center gap-2 border-t border-[var(--app-border)] pt-4 md:items-end md:border-l md:border-t-0 md:pl-5 md:pt-0">
                <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
                  Progresso Financeiro
                </p>
                <div className="md:text-right">
                  <p className="text-[20px] font-normal text-success">
                    {formatCurrency(totalPaid)}
                  </p>
                  <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                    Recebido de {formatCurrency(contractValue)}
                  </p>
                </div>
                <div
                  className="mt-1 h-2 w-full max-w-xs overflow-hidden rounded-full bg-[var(--app-surface-soft)] md:min-w-[200px]"
                  role="progressbar"
                  aria-label="Progresso financeiro recebido"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(paidProgress)}
                >
                  <div
                    className="h-2 rounded-full bg-success transition-[width]"
                    style={{ width: `${paidProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs Content */}
        <Tabs defaultValue="installments" className="w-full">
          <div
            className="app-responsive-tab-list min-w-0"
            data-collapse="standard"
          >
            <TabsList
              data-responsive-tab-scroll
              aria-label="Seções do contrato"
              className="flex h-auto w-fit max-w-full flex-nowrap justify-start overflow-x-auto rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-1 shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <TabsTrigger
                value="installments"
                data-responsive-tab
                aria-label="Parcelas"
                title="Parcelas"
                className="rounded-[6px] text-[12px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:shadow-none"
              >
                <WalletCards className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="app-responsive-tab-label">Parcelas</span>
              </TabsTrigger>
              <TabsTrigger
                value="commissions"
                data-responsive-tab
                aria-label="Comissões"
                title="Comissões"
                className="rounded-[6px] text-[12px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:shadow-none"
              >
                <Percent className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="app-responsive-tab-label">Comissões</span>
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                data-responsive-tab
                aria-label="Documentos"
                title="Documentos"
                className="rounded-[6px] text-[12px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:shadow-none"
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="app-responsive-tab-label">Documentos</span>
              </TabsTrigger>
              <TabsTrigger
                value="timeline"
                data-responsive-tab
                aria-label="Histórico"
                title="Histórico"
                className="rounded-[6px] text-[12px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:shadow-none"
              >
                <History className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="app-responsive-tab-label">Histórico</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="installments" className="mt-4">
            <Card className="app-card shadow-none">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-[14px] font-normal">
                  Fluxo de recebimento
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="relative overflow-x-auto rounded-[8px]">
                  <table className="w-full min-w-[680px] text-left text-[12px] font-light">
                    <caption className="sr-only">
                      Parcelas e pagamentos vinculados ao contrato
                    </caption>
                    <thead className="bg-[var(--app-surface-soft)] text-[11px] font-light text-[var(--app-text-tertiary)]">
                      <tr>
                        <th scope="col" className="px-3 py-2.5 font-light">
                          Parcela
                        </th>
                        <th scope="col" className="px-3 py-2.5 font-light">
                          Vencimento
                        </th>
                        <th scope="col" className="px-3 py-2.5 font-light">
                          Valor
                        </th>
                        <th scope="col" className="px-3 py-2.5 font-light">
                          Status
                        </th>
                        <th scope="col" className="px-3 py-2.5 font-light">
                          Data do pagamento
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--app-border)]">
                      {entries.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-8 text-center text-[12px] font-light text-[var(--app-text-tertiary)]"
                          >
                            Nenhuma parcela vinculada a este contrato.
                          </td>
                        </tr>
                      )}
                      {[...entries]
                        .sort(
                          (a, b) =>
                            toFiniteNumber(a.installment_number) -
                            toFiniteNumber(b.installment_number),
                        )
                        .map((entry) => (
                          <tr
                            key={entry.id}
                            className="transition-colors hover:bg-[var(--app-surface-hover)]"
                          >
                            <td className="px-3 py-3 font-normal text-[var(--app-text-primary)]">
                              {getInstallmentLabel(entry)}
                            </td>
                            <td className="px-3 py-3 text-[var(--app-text-secondary)]">
                              {formatDate(entry.due_date)}
                            </td>
                            <td className="px-3 py-3 font-normal text-[var(--app-text-primary)]">
                              {formatCurrency(toFiniteNumber(entry.amount))}
                            </td>
                            <td className="px-3 py-3">
                              <EntryStatusBadge
                                status={entry.status}
                                className="rounded-[6px] border-0 text-[11px] font-light"
                              />
                            </td>
                            <td className="px-3 py-3 text-[var(--app-text-secondary)]">
                              {entry.paid_date
                                ? formatDate(entry.paid_date)
                                : "-"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commissions" className="mt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="app-card shadow-none">
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="text-[14px] font-normal">
                    Divisão de comissões
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 px-4 pb-4">
                  {commissions.map((commission) => {
                    const userName = textOrFallback(
                      commission.user?.name,
                      "Corretor não informado",
                    );
                    const initials = userName
                      .slice(0, 2)
                      .toLocaleUpperCase("pt-BR");
                    const statusConfig = COMMISSION_STATUS[commission.status];
                    const percentage = toFiniteNumber(commission.percentage);

                    return (
                      <div
                        key={commission.id}
                        className="app-card-soft flex flex-col gap-3 p-3 shadow-none sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-normal text-primary">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">
                              {userName}
                            </p>
                            <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                              {percentage > 0
                                ? `${percentage}% da comissão`
                                : "Percentual não informado"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
                          <p className="text-[12px] font-normal text-[var(--app-text-primary)]">
                            {formatCurrency(
                              toFiniteNumber(commission.calculated_value),
                            )}
                          </p>
                          <Badge
                            variant="outline"
                            className={`rounded-[6px] border-0 px-2 py-0.5 text-[10px] font-light ${statusConfig.className}`}
                          >
                            {statusConfig.label}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                  {commissions.length === 0 && (
                    <p className="rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-8 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
                      Nenhuma comissão vinculada a este contrato.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="app-card shadow-none">
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="text-[14px] font-normal">
                    Resumo de repasses
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <dl className="space-y-3 text-[12px] font-light">
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] pb-3">
                      <dt className="text-[var(--app-text-secondary)]">
                        Total Comissões
                      </dt>
                      <dd className="font-normal text-[var(--app-text-primary)]">
                        {formatCurrency(totalCommissions)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] pb-3">
                      <dt className="text-[var(--app-text-secondary)]">
                        Liberado para pagamento
                      </dt>
                      <dd className="font-normal text-success">
                        {formatCurrency(approvedCommissions)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--app-text-secondary)]">
                        Pago aos Corretores
                      </dt>
                      <dd className="font-normal text-primary">
                        {formatCurrency(paidCommissions)}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <ContractDocuments
              contractId={contract.id}
              organizationId={contract.organization_id}
            />
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <Card className="app-card shadow-none">
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-[14px] font-normal">
                  Linha do tempo do contrato
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {contract.lead_id ? (
                  <LeadTimeline leadId={contract.lead_id} />
                ) : (
                  <p className="rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-8 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
                    Contrato sem lead vinculado.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {canManage && (
          <FinancialDrawer
            open={isEditOpen}
            onOpenChange={setIsEditOpen}
            title="Editar contrato"
            description="Altere os dados do contrato"
            size="lg"
          >
            <ContractForm
              contract={contractRaw || undefined}
              onSuccess={() => {
                setIsEditOpen(false);
                void refetch();
              }}
              onCancel={() => setIsEditOpen(false)}
            />
          </FinancialDrawer>
        )}
      </div>
    </AppLayout>
  );
}
