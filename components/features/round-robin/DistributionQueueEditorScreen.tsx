"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  Filter,
  RefreshCw,
  ShieldX,
  UsersRound,
} from "lucide-react";

import { DistributionQueueEditor } from "@/components/features/round-robin/DistributionQueueEditor";
import { DistributionQueueChangeHistory } from "@/components/features/round-robin/DistributionQueueChangeHistory";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FORM_WIZARD_DIALOG_CLASS_NAME } from "@/config/form-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreateQueueAdvanced,
  useUpdateQueueAdvanced,
} from "@/hooks/use-create-queue-advanced";
import { useRoundRobin, type RoundRobin } from "@/hooks/use-round-robins";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { normalizeExistingDistributionQueue } from "@/lib/round-robin/distribution-queue-form";
import { requireSuccessfulQueueReload } from "@/lib/round-robin/reload-result";

const MANAGEMENT_DISTRIBUTION_URL = "/crm/management?tab=distribution";


function QueueMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
            {label}
          </p>
          <p className="mt-1 truncate text-[20px] font-normal leading-none text-[var(--app-text-primary)]">
            {value}
          </p>
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function canAccessQueue(
  queue: RoundRobin,
  access: ReturnType<typeof useUserAccessScope>,
  canManageAllDistribution: boolean,
  currentUserId?: string,
) {
  if (canManageAllDistribution) return true;
  const ledTeamIds = new Set(access.ledTeamIds);
  const ledUserIds = new Set(access.ledUserIds);
  return (
    queue.created_by === currentUserId ||
    (Boolean(queue.target_pipeline_id) && access.ledPipelineIds.includes(queue.target_pipeline_id!)) ||
    queue.members.some(
      (member) =>
        member.is_active !== false && ((member.team_id && ledTeamIds.has(member.team_id)) ||
        (member.user_id && ledUserIds.has(member.user_id))),
    )
  );
}

type DistributionQueueEditorScreenProps =
  { mode: "create"; queueId?: never } | { mode: "edit"; queueId: string };

export default function DistributionQueueEditorScreen(
  props: DistributionQueueEditorScreenProps,
) {
  const isEditing = props.mode === "edit";
  const queueId = isEditing ? props.queueId : null;
  const title = isEditing ? "Editar fila" : "Nova fila";
  const router = useRouter();
  const { profile } = useAuth();
  const access = useUserAccessScope();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canManageDistribution =
    !permissionsLoading && hasPermission("distribution_manage");
  const canManageAllDistribution =
    access.isAdmin || (!access.isTeamLeader && canManageDistribution);
  const roundRobinQuery = useRoundRobin(queueId, {
    enabled: canManageDistribution && isEditing,
  });
  const createQueue = useCreateQueueAdvanced();
  const updateQueue = useUpdateQueueAdvanced();
  const queue = isEditing ? roundRobinQuery.data : undefined;
  const queueIsInScope = queue
    ? canAccessQueue(queue, access, canManageAllDistribution, profile?.id)
    : !isEditing;
  const allowedPipelineIds = useMemo(() => {
    if (canManageAllDistribution) return undefined;
    return Array.from(
      new Set(
        [queue?.target_pipeline_id, ...access.ledPipelineIds].filter(
          (pipelineId): pipelineId is string => Boolean(pipelineId),
        ),
      ),
    );
  }, [access.ledPipelineIds, canManageAllDistribution, queue]);

  const isLoading =
    permissionsLoading ||
    access.isLoading ||
    (canManageDistribution && isEditing && (roundRobinQuery.isLoading ||
      (roundRobinQuery.isFetching && !roundRobinQuery.isFetchedAfterMount)));
  const queueNotFound =
    roundRobinQuery.error instanceof VimobAPIError &&
    roundRobinQuery.error.status === 404;

  if (isLoading) {
    return (
      <QueueEditorStateDialog title={title} onClose={() => router.push(MANAGEMENT_DISTRIBUTION_URL)}>
        <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden">
          <Skeleton className="h-8 w-40 rounded-[6px]" />
          {isEditing && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-[76px] rounded-[8px]" />
              ))}
            </div>
          )}
          <Skeleton className="min-h-0 flex-1 rounded-[8px]" />
        </div>
      </QueueEditorStateDialog>
    );
  }

  if (!canManageDistribution) {
    return (
      <QueueEditorStateDialog title={title} onClose={() => router.push(MANAGEMENT_DISTRIBUTION_URL)}>
        <QueueMessage
          icon={ShieldX}
          title="Acesso não disponível"
          description="Seu perfil não possui permissão para gerenciar filas de distribuição."
        />
      </QueueEditorStateDialog>
    );
  }

  if (isEditing && queueNotFound) {
    return (
      <QueueEditorStateDialog title={title} onClose={() => router.push(MANAGEMENT_DISTRIBUTION_URL)}>
        <QueueMessage
          icon={ShieldX}
          title="Fila não encontrada"
          description="A fila não existe ou está fora do seu escopo de gestão."
        />
      </QueueEditorStateDialog>
    );
  }

  if (isEditing && roundRobinQuery.isError && !queue) {
    return (
      <QueueEditorStateDialog title={title} onClose={() => router.push(MANAGEMENT_DISTRIBUTION_URL)}>
        <QueueMessage
          icon={AlertTriangle}
          title="Não foi possível carregar a fila"
          description="Confira sua conexão e tente novamente. Nenhuma alteração foi enviada."
          action={
            <Button
              type="button"
              onClick={() => roundRobinQuery.refetch()}
              className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          }
        />
      </QueueEditorStateDialog>
    );
  }

  if (isEditing && (!queue || !queueIsInScope)) {
    return (
      <QueueEditorStateDialog title={title} onClose={() => router.push(MANAGEMENT_DISTRIBUTION_URL)}>
        <QueueMessage
          icon={ShieldX}
          title="Fila não encontrada"
          description="A fila não existe ou está fora do seu escopo de gestão."
        />
      </QueueEditorStateDialog>
    );
  }

  const creator = queue
    ? queue.created_by_user?.name ||
      queue.created_by_user?.email ||
      "Não informado"
    : "";
  const createdAt = queue
    ? format(new Date(queue.created_at), "dd/MM/yyyy 'às' HH:mm", {
        locale: ptBR,
      })
    : "";

  return (
    <AppLayout title={title} disableMainScroll>
      <DistributionQueueEditor
        presentation="dialog"
        open
        queue={queue ? normalizeExistingDistributionQueue(queue) : null}
        closeOnSave={!isEditing}
        onOpenChange={(open) => { if (!open) router.push(MANAGEMENT_DISTRIBUTION_URL); }}
        onReload={isEditing ? async () => normalizeExistingDistributionQueue(requireSuccessfulQueueReload(await roundRobinQuery.refetch())) : undefined}
        onSave={async (data) => {
          if (isEditing && queue) {
            return normalizeExistingDistributionQueue(await updateQueue.mutateAsync({ id: queue.id, ...data }));
          }
          return normalizeExistingDistributionQueue(await createQueue.mutateAsync(data));
        }}
        allowedTeamIds={canManageAllDistribution ? undefined : access.ledTeamIds}
        allowedUserIds={canManageAllDistribution ? undefined : access.ledUserIds}
        allowedPipelineIds={allowedPipelineIds}
        aside={isEditing && queue ? <DistributionQueueChangeHistory queueId={queue.id} /> : undefined}
        summary={isEditing && queue ? (
          <>
            <details className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light">
              <summary className="cursor-pointer font-normal">Indicadores da distribuição</summary>
              <p className="mt-3 text-[10px] text-[var(--app-text-tertiary)]">Criada por {creator} em {createdAt}</p>
              <div className="mt-3">
        {isEditing && queue && (
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <QueueMetric
              icon={Activity}
              label="Eventos"
              value={queue.leads_distributed || 0}
            />
            <QueueMetric
              icon={UsersRound}
              label="Participantes"
              value={queue.members.filter((member) => member.is_active !== false).length}
            />
            <QueueMetric
              icon={Filter}
              label="Critérios"
              value={queue.rules.filter((rule) => !('is_active' in rule) || rule.is_active !== false).length}
            />
            <QueueMetric
              icon={Activity}
              label="Estratégia"
              value={queue.strategy === "weighted" ? "Ponderada" : "Sequencial"}
            />
          </div>
        )}
              </div>
            </details>
        {isEditing && roundRobinQuery.isError && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-[8px] bg-warning/10 px-3 py-2 text-[11px] font-light text-warning"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Não foi possível atualizar a fila agora. O rascunho foi mantido e a
            tela continua usando os últimos dados carregados.
          </div>
        )}
          </>
        ) : undefined}
      />
    </AppLayout>
  );
}

function QueueEditorStateDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <AppLayout title={title} disableMainScroll>
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent data-management-editor="distribution" className={FORM_WIZARD_DIALOG_CLASS_NAME} aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader className="shrink-0 border-b border-[var(--app-border)] px-5 py-4 text-left">
            <DialogTitle className="pr-8 text-[15px] font-normal">{title}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function QueueMessage({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[52vh] w-full max-w-[720px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-5 py-10 text-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        <Icon className="h-5 w-5" />
      </span>
      <h2 className="text-[14px] font-normal">{title}</h2>
      <p className="mt-1 max-w-md text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
      <Button
        asChild
        variant="ghost"
        className="mt-3 h-9 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        <Link href={MANAGEMENT_DISTRIBUTION_URL}>Voltar para Gestão</Link>
      </Button>
    </div>
  );
}
