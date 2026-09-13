"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Inbox,
  KeyRound,
  Loader2,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { VimobLoader } from "@/components/shared/loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import {
  adminAPI,
  type AdminNotificationDeliveryOperations,
  type AdminNotificationDeliveryStatus,
  type AdminNotificationDispatchSettings,
} from "@/lib/api/admin";
import { notificationsAPI } from "@/lib/api/notifications";
import { cn } from "@/lib/utils";
import { AdminWarning, KpiCard } from "@/components/features/admin/AdminPrimitives";
import { formatDate, getErrorMessage } from "@/components/features/admin/admin-display";
import {
  getNotificationDispatchForm,
  useSafeAdminQuery,
  type NotificationDispatchForm,
  type SafeQueryResult,
} from "@/components/features/admin/admin-queries";

function NotificationDispatcherSettings({
  settings,
  isLoading,
}: {
  settings?: AdminNotificationDispatchSettings;
  isLoading: boolean;
}) {
  const { activeOrganization, profile, organization } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = activeOrganization.organizationId || "";
  const userId = profile?.id || "";
  const settingsForm = useMemo(() => getNotificationDispatchForm(settings), [settings]);
  const [form, setForm] = useState<NotificationDispatchForm>(() => settingsForm);
  const [isDirty, setIsDirty] = useState(false);
  const timeoutIsValid = Number.isInteger(form.timeoutSeconds)
    && form.timeoutSeconds >= 3
    && form.timeoutSeconds <= 60;

  useEffect(() => {
    if (isDirty) return;
    queueMicrotask(() => setForm(settingsForm));
  }, [isDirty, settingsForm]);

  const updateForm = <K extends keyof NotificationDispatchForm>(key: K, value: NotificationDispatchForm[K]) => {
    setIsDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!settings || !timeoutIsValid) {
        throw new Error("Revise o timeout antes de salvar.");
      }
      return adminAPI.updateNotificationDispatchSettings({
        enabled: form.enabled,
        mode: form.mode,
        instanceName: form.instanceName,
        senderNumber: form.senderNumber,
        webhookUrl: form.webhookUrl,
        headerName: form.headerName,
        timeoutSeconds: form.timeoutSeconds,
        instanceToken: form.clearInstanceToken
          ? { action: "clear" }
          : form.instanceToken.trim()
            ? { action: "replace", value: form.instanceToken }
            : { action: "unchanged" },
        headerValue: form.clearHeaderValue
          ? { action: "clear" }
          : form.headerValue.trim()
            ? { action: "replace", value: form.headerValue }
            : { action: "unchanged" },
      });
    },
    onSuccess: (updated) => {
      toast.success("Disparador de WhatsApp salvo");
      queryClient.setQueryData(
        ["admin-notification-dispatch-settings"],
        { data: updated, errorMessage: null } satisfies SafeQueryResult<AdminNotificationDispatchSettings | undefined>,
      );
      setForm(getNotificationDispatchForm(updated));
      setIsDirty(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o disparador.");
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => notificationsAPI.dispatch({
      eventKey: "test_push",
      organizationId,
      userId,
      title: "Teste do dispatcher",
      content: "Teste enviado pelo superadmin.",
      variables: { source: "superadmin" },
      channels: ["system", "whatsapp"],
      isTest: true,
    }),
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (!result.success || !result.queued || !result.notification) {
        toast.error("O backend não confirmou o enfileiramento do teste.");
        return;
      }
      toast.success("Teste enfileirado; a entrega será processada em segundo plano.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível testar o dispatcher.");
    },
  });

  return (
    <div className="app-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Disparador WhatsApp</h2>
          <p className="text-sm text-muted-foreground">Instância global chamada pelo backend para avisos no WhatsApp.</p>
        </div>
        <Badge className={cn("border-0", form.enabled ? "bg-emerald-500/12 text-emerald-400" : "bg-[var(--app-surface-soft)] text-muted-foreground")}>
          {form.enabled ? "Ativo" : "Inativo"}
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-[180px_1fr_1fr_180px]">
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Modo de entrega</span>
          <select
            value={form.mode}
            onChange={(event) => updateForm("mode", event.target.value as NotificationDispatchForm["mode"])}
            className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
          >
            <option value="webhook">Webhook privado</option>
            <option value="evolution_go_instance">Instância Evolution Go</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Nome da instância</span>
          <Input
            value={form.instanceName}
            onChange={(event) => updateForm("instanceName", event.target.value)}
            placeholder="Notificação"
            className="border-0 bg-[var(--app-surface-soft)]"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Token da instância</span>
          <div className="flex gap-2">
            <Input
              type="password"
              value={form.instanceToken}
              onChange={(event) => {
                setIsDirty(true);
                setForm((current) => ({
                  ...current,
                  instanceToken: event.target.value,
                  clearInstanceToken: false,
                }));
              }}
              placeholder={form.clearInstanceToken
                ? "Será removido ao salvar"
                : form.instanceTokenConfigured
                  ? "Configurado - deixe vazio para manter"
                  : "Novo token"}
              disabled={form.clearInstanceToken}
              autoComplete="new-password"
              className="border-0 bg-[var(--app-surface-soft)]"
            />
            {form.instanceTokenConfigured ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0 border-0 bg-[var(--app-surface-soft)]"
                onClick={() => {
                  setIsDirty(true);
                  setForm((current) => ({
                    ...current,
                    instanceToken: "",
                    clearInstanceToken: !current.clearInstanceToken,
                  }));
                }}
              >
                {form.clearInstanceToken ? "Manter" : "Remover"}
              </Button>
            ) : null}
          </div>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Número</span>
          <Input
            value={form.senderNumber}
            onChange={(event) => updateForm("senderNumber", event.target.value)}
            placeholder="55..."
            className="border-0 bg-[var(--app-surface-soft)]"
          />
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_180px]">
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">URL de fallback</span>
          <Input
            value={form.webhookUrl}
            onChange={(event) => updateForm("webhookUrl", event.target.value)}
            placeholder="https://..."
            className="border-0 bg-[var(--app-surface-soft)]"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Timeout</span>
          <Input
            type="number"
            min={3}
            max={60}
            value={form.timeoutSeconds}
            onChange={(event) => updateForm("timeoutSeconds", Number(event.target.value))}
            className="border-0 bg-[var(--app-surface-soft)]"
          />
          {!timeoutIsValid ? <span className="text-xs text-destructive">Use um número inteiro entre 3 e 60.</span> : null}
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Header</span>
          <Input
            value={form.headerName}
            onChange={(event) => updateForm("headerName", event.target.value)}
            placeholder="Authorization"
            className="border-0 bg-[var(--app-surface-soft)]"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-light text-muted-foreground">Valor</span>
          <div className="flex gap-2">
            <Input
              type="password"
              value={form.headerValue}
              onChange={(event) => {
                setIsDirty(true);
                setForm((current) => ({
                  ...current,
                  headerValue: event.target.value,
                  clearHeaderValue: false,
                }));
              }}
              placeholder={form.clearHeaderValue
                ? "Será removido ao salvar"
                : form.headerValueConfigured
                  ? "Configurado - deixe vazio para manter"
                  : "Novo valor"}
              disabled={form.clearHeaderValue}
              autoComplete="new-password"
              className="border-0 bg-[var(--app-surface-soft)]"
            />
            {form.headerValueConfigured ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0 border-0 bg-[var(--app-surface-soft)]"
                onClick={() => {
                  setIsDirty(true);
                  setForm((current) => ({
                    ...current,
                    headerValue: "",
                    clearHeaderValue: !current.clearHeaderValue,
                  }));
                }}
              >
                {form.clearHeaderValue ? "Manter" : "Remover"}
              </Button>
            ) : null}
          </div>
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--app-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={form.enabled} onCheckedChange={(checked) => updateForm("enabled", checked)} />
          Enviar WhatsApp pelo backend
        </label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-0 bg-[var(--app-surface-soft)]"
            onClick={() => testMutation.mutate()}
            disabled={isLoading || saveMutation.isPending || testMutation.isPending || !settings || !organizationId || !userId}
          >
            {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Testar
          </Button>
          <Button
            className="rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
            onClick={() => saveMutation.mutate()}
            disabled={isLoading || !settings || !timeoutIsValid || saveMutation.isPending || testMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

const NOTIFICATION_DELIVERY_STATUS_LABELS: Record<AdminNotificationDeliveryStatus, string> = {
  queued: "Na fila",
  leased: "Reservada",
  sending: "Enviando",
  accepted: "Aceita pelo provedor",
  delivered: "Entregue",
  retry_wait: "Aguardando nova tentativa",
  blocked_dependency: "Bloqueada",
  dead_letter: "Fila de falhas",
  cancelled: "Cancelada",
  permanent_failed: "Falha permanente",
};

const REPLAYABLE_NOTIFICATION_STATUSES = new Set<AdminNotificationDeliveryStatus>([
  "blocked_dependency",
  "dead_letter",
  "cancelled",
  "permanent_failed",
]);

function notificationDeliveryStatusClass(status: AdminNotificationDeliveryStatus) {
  if (status === "delivered") return "bg-emerald-500/12 text-emerald-400";
  if (status === "accepted") return "bg-sky-500/12 text-sky-400";
  if (status === "dead_letter" || status === "permanent_failed") {
    return "bg-destructive/12 text-destructive";
  }
  if (status === "blocked_dependency" || status === "retry_wait") {
    return "bg-amber-500/12 text-amber-400";
  }
  return "bg-[var(--app-surface-soft)] text-muted-foreground";
}

function NotificationDeliveryOperationsPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminNotificationDeliveryStatus | "all" | "problems">("problems");
  const operationsQuery = useQuery<AdminNotificationDeliveryOperations>({
    queryKey: ["admin-notification-delivery-operations", status],
    queryFn: () => adminAPI.getNotificationDeliveryOperations({ status, limit: 50 }),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
  const replayMutation = useMutation({
    mutationFn: (deliveryId: string) => adminAPI.replayNotificationDelivery(
      deliveryId,
      "Reprocessamento manual solicitado pelo superadmin no painel técnico.",
    ),
    onSuccess: async () => {
      toast.success("Entrega devolvida à fila com a tentativa auditada.");
      await queryClient.invalidateQueries({ queryKey: ["admin-notification-delivery-operations"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível reprocessar a entrega.");
    },
  });

  const totals = useMemo(() => {
    const byStatus = new Map<AdminNotificationDeliveryStatus, number>();
    let due = 0;
    for (const metric of operationsQuery.data?.metrics || []) {
      byStatus.set(metric.status, (byStatus.get(metric.status) || 0) + metric.deliveryCount);
      due += metric.dueCount;
    }
    const count = (...statuses: AdminNotificationDeliveryStatus[]) => (
      statuses.reduce((total, item) => total + (byStatus.get(item) || 0), 0)
    );
    return {
      active: count("queued", "leased", "sending", "retry_wait"),
      due,
      accepted: count("accepted"),
      blocked: count("blocked_dependency"),
      deadLetter: count("dead_letter", "permanent_failed"),
    };
  }, [operationsQuery.data?.metrics]);

  return (
    <div className="app-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-medium">Operação da fila de notificações</h2>
          <p className="text-sm text-muted-foreground">
            Estado por canal, tentativas pendentes e reprocessamento manual auditado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs outline-none"
            aria-label="Filtrar entregas"
          >
            <option value="problems">Atenção necessária</option>
            <option value="all">Todas</option>
            <option value="queued">Na fila</option>
            <option value="accepted">Aceitas</option>
            <option value="retry_wait">Nova tentativa</option>
            <option value="blocked_dependency">Bloqueadas</option>
            <option value="dead_letter">Fila de falhas</option>
            <option value="permanent_failed">Falha permanente</option>
            <option value="delivered">Entregues</option>
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-0 bg-[var(--app-surface-soft)]"
            onClick={() => operationsQuery.refetch()}
            disabled={operationsQuery.isFetching}
          >
            {operationsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard title="Fila ativa" value={totals.active} helper={`${totals.due} prontas agora`} icon={Inbox} />
        <KpiCard title="Aceitas" value={totals.accepted} helper="Aguardando recibo" icon={CheckCircle2} />
        <KpiCard title="Bloqueadas" value={totals.blocked} helper="Dependência indisponível" icon={AlertTriangle} />
        <KpiCard title="Fila de falhas" value={totals.deadLetter} helper="Exige decisão operacional" icon={CircleAlert} />
        <KpiCard
          title="Telemetria da fila"
          value={operationsQuery.isError ? "Indisponível" : "Disponível"}
          helper="Atualização a cada 15 s"
          icon={Activity}
        />
      </div>

      {operationsQuery.isError ? (
        <div className="mt-4">
          <AdminWarning message={getErrorMessage(operationsQuery.error)} />
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-[8px] border border-[var(--app-border)]">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-[var(--app-surface-soft)] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-normal">Notificação</th>
              <th className="px-3 py-2 font-normal">Canal</th>
              <th className="px-3 py-2 font-normal">Estado</th>
              <th className="px-3 py-2 font-normal">Tentativas</th>
              <th className="px-3 py-2 font-normal">Diagnóstico</th>
              <th className="px-3 py-2 text-right font-normal">Ação</th>
            </tr>
          </thead>
          <tbody>
            {operationsQuery.isPending ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando operação da fila...
                </td>
              </tr>
            ) : null}
            {!operationsQuery.isPending && (operationsQuery.data?.deliveries.length || 0) === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma entrega encontrada para este filtro.
                </td>
              </tr>
            ) : null}
            {operationsQuery.data?.deliveries.map((delivery) => (
              <tr key={delivery.id} className="border-t border-[var(--app-border)] align-top">
                <td className="max-w-[280px] px-3 py-3">
                  <p className="truncate font-medium">{delivery.title}</p>
                  <p className="mt-1 truncate text-muted-foreground">
                    {delivery.organizationName || delivery.organizationId} · {delivery.eventKey || "notification"}
                  </p>
                </td>
                <td className="px-3 py-3 uppercase text-muted-foreground">{delivery.channel}</td>
                <td className="px-3 py-3">
                  <Badge className={cn("border-0", notificationDeliveryStatusClass(delivery.status))}>
                    {NOTIFICATION_DELIVERY_STATUS_LABELS[delivery.status]}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {delivery.attemptCount}/{delivery.maxAttempts}
                </td>
                <td className="max-w-[320px] px-3 py-3 text-muted-foreground">
                  <p className="truncate">{delivery.lastErrorCode || delivery.dependencyKey || delivery.providerStatus || "Sem erro registrado"}</p>
                  <p className="mt-1 truncate">Atualizada em {formatDate(delivery.updatedAt)}</p>
                </td>
                <td className="px-3 py-3 text-right">
                  {REPLAYABLE_NOTIFICATION_STATUSES.has(delivery.status) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-0 bg-[var(--app-surface-soft)]"
                      onClick={() => replayMutation.mutate(delivery.id)}
                      disabled={replayMutation.isPending}
                    >
                      {replayMutation.isPending && replayMutation.variables === delivery.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Reprocessar
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminSettingsContent({ technical = false }: { technical?: boolean }) {
  const settingsQuery = useSafeAdminQuery<AdminNotificationDispatchSettings | undefined>(
    ["admin-notification-dispatch-settings"],
    () => adminAPI.getNotificationDispatchSettings(),
    undefined,
  );
  const settings = settingsQuery.data?.data;
  const settingsErrorMessage = settingsQuery.data?.errorMessage
    || (!settingsQuery.isPending && !settings ? "A API não retornou as configurações administrativas." : null);

  return (
    <div className="space-y-4">
      <AdminWarning message={settingsErrorMessage} />
      {settingsQuery.isPending ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <VimobLoader label="Carregando configurações..." />
        </div>
      ) : null}
      {!settingsQuery.isPending && !settingsErrorMessage && settings ? (
        <>
      <div className="grid gap-3 md:grid-cols-3">
        <KpiCard title="Entrega transacional" value={settings?.enabled ? "Ativa" : "Inativa"} icon={Settings} />
        <KpiCard title="Token da instância" value={settings?.instanceTokenConfigured ? "Configurado" : "Ausente"} icon={KeyRound} />
        <KpiCard title="Última atualização" value={formatDate(settings?.updatedAt)} icon={Activity} />
      </div>
      {technical ? (
        <>
          <NotificationDispatcherSettings settings={settings} isLoading={settingsQuery.isPending} />
          <NotificationDeliveryOperationsPanel />
        </>
      ) : (
        <div className="app-card p-4 text-sm text-muted-foreground">
          As configurações sensíveis ficam disponíveis apenas na área técnica e nunca são devolvidas pela API.
        </div>
      )}
        </>
      ) : null}
    </div>
  );
}
