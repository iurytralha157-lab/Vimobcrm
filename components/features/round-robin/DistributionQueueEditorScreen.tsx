"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Filter,
  RefreshCw,
  ShieldX,
  UsersRound,
} from "lucide-react";

import { DistributionQueueEditor } from "@/components/features/round-robin/DistributionQueueEditor";
import { DistributionQueueChangeHistory } from "@/components/features/round-robin/DistributionQueueChangeHistory";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
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
          <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">
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
    queue.members.some(
      (member) =>
        (member.team_id && ledTeamIds.has(member.team_id)) ||
        (!member.team_id && member.user_id && ledUserIds.has(member.user_id)),
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
    (canManageDistribution && isEditing && roundRobinQuery.isLoading);
  const queueNotFound =
    roundRobinQuery.error instanceof VimobAPIError &&
    roundRobinQuery.error.status === 404;

  if (isLoading) {
    return (
      <AppLayout title={title}>
        <div className="flex w-full flex-col gap-3">
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
      </AppLayout>
    );
  }

  if (!canManageDistribution) {
    return (
      <AppLayout title={title}>
        <QueueMessage
          icon={ShieldX}
          title="Acesso não disponível"
          description="Seu perfil não possui permissão para gerenciar filas de distribuição."
        />
      </AppLayout>
    );
  }

  if (isEditing && queueNotFound) {
    return (
      <AppLayout title={title}>
        <QueueMessage
          icon={ShieldX}
          title="Fila não encontrada"
          description="A fila não existe ou está fora do seu escopo de gestão."
        />
      </AppLayout>
    );
  }

  if (isEditing && roundRobinQuery.isError && !queue) {
    return (
      <AppLayout title={title}>
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
      </AppLayout>
    );
  }

  if (isEditing && (!queue || !queueIsInScope)) {
    return (
      <AppLayout title={title}>
        <QueueMessage
          icon={ShieldX}
          title="Fila não encontrada"
          description="A fila não existe ou está fora do seu escopo de gestão."
        />
      </AppLayout>
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
    <AppLayout title={title}>
      <div className="flex w-full flex-col gap-3 pb-2 text-[12px] font-light">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <Button
            asChild
            variant="ghost"
            className="h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
          >
            <Link href={MANAGEMENT_DISTRIBUTION_URL}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Voltar para Gestão
            </Link>
          </Button>
          {isEditing && queue && (
            <span className="min-w-0 truncate text-right text-[10px] font-light text-[var(--app-text-tertiary)] sm:text-[11px]">
              Criada por {creator} em {createdAt}
            </span>
          )}
        </div>

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
              value={queue.members.length}
            />
            <QueueMetric
              icon={Filter}
              label="Critérios"
              value={queue.rules.length}
            />
            <QueueMetric
              icon={Activity}
              label="Estratégia"
              value={queue.strategy === "weighted" ? "Ponderada" : "Sequencial"}
            />
          </div>
        )}

        <div
          className={`grid min-w-0 items-start gap-3 ${
            isEditing
              ? "min-[1900px]:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]"
              : "grid-cols-1"
          }`}
        >
          <DistributionQueueEditor
            presentation="page"
            open
            queue={queue || null}
            onOpenChange={(open) => {
              if (!open) router.push(MANAGEMENT_DISTRIBUTION_URL);
            }}
            onSave={async (data) => {
              if (isEditing && queue) {
                await updateQueue.mutateAsync({ id: queue.id, ...data });
                return;
              }
              const createdQueue = await createQueue.mutateAsync(data);
              router.replace(
                `/crm/management/distribution/${createdQueue.id}/edit`,
              );
            }}
            allowedTeamIds={
              canManageAllDistribution ? undefined : access.ledTeamIds
            }
            allowedUserIds={
              canManageAllDistribution ? undefined : access.ledUserIds
            }
            allowedPipelineIds={allowedPipelineIds}
          />

          {isEditing && queue && (
            <div className="min-w-0">
              <DistributionQueueChangeHistory queueId={queue.id} />
            </div>
          )}
        </div>
      </div>
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
