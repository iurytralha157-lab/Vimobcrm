import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMemo } from "react";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";
import { createClientId } from "@/lib/client-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  Plus,
  X,
  Trash2,
  Loader2,
  Save,
  Settings2,
  Users,
  Filter,
  AlertCircle,
  UsersRound,
  Globe,
  Webhook,
  MessageSquare,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { usePipelines, useStages } from "@/hooks/use-stages";
import { useTeams } from "@/hooks/use-teams";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useTags } from "@/hooks/use-tags";
import { useProperties } from "@/hooks/use-properties";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useWebhooks } from "@/hooks/use-webhooks";
import { useRoundRobinWhatsAppSessions } from "@/hooks/use-round-robins";
import { useMetaFormConfigs } from "@/hooks/use-meta-forms";
import { useMetaIntegrations } from "@/hooks/use-meta-integration";
import { cn } from "@/lib/utils";
import {
  activeTeamsForUser,
  hydrateQueueMembers,
  queueIgnoresAvailability,
  queueMemberKey,
  resolveDirectUserTeamContext,
  type QueueMemberDraft,
  type QueueTeamSource,
} from "@/lib/round-robin/member-context";

// Drag and Drop imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

interface QueueSettings {
  ignore_availability?: boolean;
  enable_redistribution?: boolean;
  redistribution_timeout_minutes?: number;
  redistribution_warning_minutes?: number;
  redistribution_max_attempts?: number;
  preserve_position?: boolean;
  require_checkin?: boolean;
  reentry_behavior?: "redistribute" | "keep_assignee";
}

interface RuleCondition {
  id: string;
  type:
    | "source"
    | "webhook"
    | "whatsapp_session"
    | "meta_form"
    | "website_category"
    | "campaign_contains"
    | "whatsapp_message_contains"
    | "tag"
    | "city"
    | "interest_property";
  values: string[];
  sessionId?: string;
}

type RuleConditionType = RuleCondition["type"];

type QueueMember = QueueMemberDraft;

interface QueueFormData {
  name: string;
  strategy: "simple" | "weighted";
  target_pipeline_id: string;
  target_stage_id: string;
  is_active: boolean;
  settings: QueueSettings;
  conditions: RuleCondition[];
  members: QueueMember[];
}

type QueueStrategy = QueueFormData["strategy"];

interface ExistingQueueRule {
  id: string;
  match_type?: string | null;
  match_value?: string | null;
  match?: unknown;
}

interface ExistingQueueMember {
  id?: string;
  team_id?: string | null;
  user_id?: string | null;
  weight?: number | null;
  user?: {
    name?: string | null;
  } | null;
}

interface ExistingDistributionQueue {
  id?: string;
  name?: string | null;
  strategy?: string | null;
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  is_active?: boolean | null;
  settings?: Partial<QueueSettings> | null;
  reentry_behavior?: "redistribute" | "keep_assignee";
  rules?: ExistingQueueRule[] | null;
  members?: ExistingQueueMember[] | null;
}

interface DistributionQueueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue?: ExistingDistributionQueue | null;
  onSave: (data: QueueFormData) => Promise<void>;
  allowedTeamIds?: string[];
  allowedUserIds?: string[];
  allowedPipelineIds?: string[];
}

const EMPTY_RESTRICTION_IDS: string[] = [];

const SOURCE_OPTIONS = [
  { value: "meta_ads", label: "Meta Ads" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "webhook", label: "Webhook" },
  { value: "website", label: "Website" },
];

const CONDITION_TYPES = [
  { value: "source", label: "Canal de entrada" },
  { value: "webhook", label: "Webhook especifico" },
  { value: "whatsapp_session", label: "Conexao WhatsApp" },
  { value: "meta_form", label: "Formulario Meta" },
  { value: "website_category", label: "Categoria do site" },
  { value: "campaign_contains", label: "Nome da campanha contem" },
  { value: "whatsapp_message_contains", label: "Campanha de WhatsApp" },
  { value: "tag", label: "Tag" },
  { value: "city", label: "Cidade" },
  { value: "interest_property", label: "Interesse em imóvel" },
];

const WEBSITE_CATEGORY_OPTIONS = [
  { value: "venda", label: "Venda" },
  { value: "locacao", label: "Locacao" },
  { value: "lancamento", label: "Lancamento" },
];

function isQueueStrategy(value: unknown): value is QueueStrategy {
  return value === "simple" || value === "weighted";
}

function isRuleConditionType(value: unknown): value is RuleConditionType {
  return (
    typeof value === "string" &&
    CONDITION_TYPES.some((condition) => condition.value === value)
  );
}

function whatsappSessionIdFromMatch(match: unknown): string {
  if (!match || typeof match !== 'object' || Array.isArray(match)) return '';
  const sessionId = (match as Record<string, unknown>).whatsapp_session_id;
  return typeof sessionId === 'string' ? sessionId.trim() : '';
}

function conditionOptionBadgeClass(selected: boolean) {
  return cn(
    "cursor-pointer rounded-[6px] border px-2.5 py-1 shadow-none",
    selected
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-[var(--app-border-strong)] bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]",
  );
}

// Sortable Item Component for Members
function SortableMemberRow({
  member,
  idx,
  strategy,
  totalWeight,
  teamOptions,
  ignoreAvailability,
  onUpdateWeight,
  onUpdateTeam,
  onRemove,
}: {
  member: QueueMember;
  idx: number;
  strategy: string;
  totalWeight: number;
  teamOptions: QueueTeamSource[];
  ignoreAvailability: boolean;
  onUpdateWeight: (id: string, weight: number) => void;
  onUpdateTeam: (id: string, teamId: string) => void;
  onRemove: (id: string) => void;
}) {
  const memberKey = queueMemberKey(member);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: memberKey });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  const percentage =
    totalWeight > 0 ? Math.round((member.weight / totalWeight) * 100) : 0;
  const hasValidTeamContext =
    !member.teamId || teamOptions.some((team) => team.id === member.teamId);
  const requiresTeamSelector =
    member.type === "user" &&
    (teamOptions.length > 1 ||
      (teamOptions.length === 1 && !hasValidTeamContext));

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-0 hover:bg-[var(--app-surface-hover)]",
        isDragging && "bg-[var(--app-surface-hover)]",
      )}
    >
      <TableCell className="w-10">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {member.type === "team" ? (
            <UsersRound className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {member.name?.[0] || "?"}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <span className="font-medium text-sm">
              {member.name || "Desconhecido"}
            </span>
            {member.type === "team" && (
              <Badge variant="outline" className="ml-2 text-xs">
                Equipe
              </Badge>
            )}
            {member.type === "user" &&
              teamOptions.length === 1 &&
              hasValidTeamContext && (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {teamOptions[0].name || "Equipe vinculada"}
                </p>
              )}
            {requiresTeamSelector && (
              <Select
                value={member.teamId}
                onValueChange={(teamId) => onUpdateTeam(memberKey, teamId)}
              >
                <SelectTrigger className="mt-1 h-7 min-w-[150px] rounded-[6px] border-[var(--app-border)] bg-[var(--app-surface-solid)] text-[11px] shadow-none">
                  <SelectValue placeholder="Escolha a equipe" />
                </SelectTrigger>
                <SelectContent>
                  {teamOptions.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name || "Equipe"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {member.type === "user" && teamOptions.length === 0 && (
              <p
                className={cn(
                  "mt-0.5 text-[11px]",
                  ignoreAvailability
                    ? "text-muted-foreground"
                    : "text-destructive",
                )}
              >
                {ignoreAvailability
                  ? "Sem equipe · horários ignorados"
                  : "Sem equipe ativa para aplicar horários"}
              </p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {strategy === "weighted" ? (
          <div className="flex items-center justify-center gap-2">
            <Input
              type="number"
              value={member.weight}
              onChange={(e) =>
                onUpdateWeight(memberKey, parseInt(e.target.value) || 1)
              }
              className="w-16 text-center h-8"
              min={1}
              max={100}
            />
            <span className="text-xs text-muted-foreground w-10">
              ({percentage}%)
            </span>
          </div>
        ) : (
          <div className="text-center text-muted-foreground text-sm">
            #{idx + 1}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(memberKey)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function DistributionQueueEditor({
  open,
  onOpenChange,
  queue,
  onSave,
  allowedTeamIds,
  allowedUserIds,
  allowedPipelineIds,
}: DistributionQueueEditorProps) {
  const { hasModule } = useOrganizationModules();
  const hasPropertiesModule = hasModule("properties");
  const { data: pipelines = [] } = usePipelines();
  const { data: teams = [], isPending: teamsLoading } = useTeams({
    includeInactive: true,
  });
  const { data: users = [], isPending: usersLoading } =
    useOrganizationUsers();
  const { data: tags = [] } = useTags();
  const { data: properties = [] } = useProperties(
    undefined,
    {},
    {
      enabled: hasPropertiesModule,
    },
  );
  const { data: webhooks = [] } = useWebhooks();
  const { data: whatsappSessions = [] } = useRoundRobinWhatsAppSessions();
  const { data: metaIntegrations = [] } = useMetaIntegrations();
  const activeMetaIntegration = metaIntegrations.find((i) => i.is_connected);
  const { data: metaFormConfigs = [] } = useMetaFormConfigs(
    activeMetaIntegration?.id,
  );
  const hasTeamRestriction = Array.isArray(allowedTeamIds);
  const hasUserRestriction = Array.isArray(allowedUserIds);
  const hasPipelineRestriction = Array.isArray(allowedPipelineIds);
  const effectiveAllowedTeamIds = allowedTeamIds ?? EMPTY_RESTRICTION_IDS;
  const effectiveAllowedUserIds = allowedUserIds ?? EMPTY_RESTRICTION_IDS;
  const effectiveAllowedPipelineIds =
    allowedPipelineIds ?? EMPTY_RESTRICTION_IDS;
  const availableConditionTypes = useMemo(
    () =>
      hasPropertiesModule
        ? CONDITION_TYPES
        : CONDITION_TYPES.filter(
            (condition) => condition.value !== "interest_property",
          ),
    [hasPropertiesModule],
  );
  const activeTeams = useMemo(
    () => teams.filter((team) => team.is_active !== false && Boolean(team.id)),
    [teams],
  );
  const activeUsers = useMemo(
    () => users.filter((user) => user.is_active !== false && Boolean(user.id)),
    [users],
  );
  const visibleTeams = useMemo(
    () =>
      hasTeamRestriction
        ? activeTeams.filter((team) =>
            effectiveAllowedTeamIds.includes(team.id),
          )
        : activeTeams,
    [activeTeams, effectiveAllowedTeamIds, hasTeamRestriction],
  );
  const visibleUsers = useMemo(
    () =>
      hasUserRestriction
        ? activeUsers.filter((user) =>
            effectiveAllowedUserIds.includes(user.id),
          )
        : activeUsers,
    [activeUsers, effectiveAllowedUserIds, hasUserRestriction],
  );
  const visiblePipelines = useMemo(
    () =>
      hasPipelineRestriction
        ? pipelines.filter((pipeline) =>
            effectiveAllowedPipelineIds.includes(pipeline.id),
          )
        : pipelines,
    [effectiveAllowedPipelineIds, hasPipelineRestriction, pipelines],
  );
  const incomingWebhooks = useMemo(
    () => webhooks.filter((webhook) => webhook.type === "incoming"),
    [webhooks],
  );
  const activeWhatsAppSessions = useMemo(
    () => whatsappSessions.filter((session) => session.is_active),
    [whatsappSessions],
  );
  const campaignWhatsAppSessions = useMemo(
    () => whatsappSessions.filter((session) => (
      session.is_active
      && !['disabled', 'deleted'].includes(session.status.trim().toLowerCase())
      && (!session.provider || session.provider === 'evolution_go')
    )),
    [whatsappSessions]
  );

  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [pendingUserId, setPendingUserId] = useState("");

  const [formData, setFormData] = useState<QueueFormData>({
    name: "",
    strategy: "simple",
    target_pipeline_id: "",
    target_stage_id: "",
    is_active: true,
    settings: {
      enable_redistribution: false,
      redistribution_timeout_minutes: 20,
      redistribution_warning_minutes: 5,
      redistribution_max_attempts: 10,
      preserve_position: true,
      require_checkin: false,
      reentry_behavior: "redistribute",
    },
    conditions: [],
    members: [],
  });

  const hasWhatsAppMessageCondition = formData.conditions.some(
    (condition) => condition.type === "whatsapp_message_contains",
  );

  const selectableUsers = useMemo(
    () =>
      visibleUsers.filter(
        (user) =>
          !formData.members.some(
            (member) => member.type === "user" && member.entityId === user.id,
          ),
      ),
    [formData.members, visibleUsers],
  );
  const selectableTeams = useMemo(
    () =>
      visibleTeams.filter(
        (team) =>
          !formData.members.some(
            (member) => member.type === "team" && member.entityId === team.id,
          ),
      ),
    [formData.members, visibleTeams],
  );
  const pendingUserTeams = useMemo(
    () =>
      pendingUserId
        ? activeTeamsForUser(pendingUserId, visibleTeams)
        : [],
    [pendingUserId, visibleTeams],
  );
  const teamSelectMessage =
    teams.length === 0
      ? "Nenhuma equipe cadastrada."
      : activeTeams.length === 0
        ? "Nenhuma equipe ativa encontrada."
        : selectableTeams.length === 0
          ? "Todas as equipes ativas ja foram adicionadas."
          : null;

  // Sensors for DnD
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Get stages for selected pipeline
  const { data: stages = [] } = useStages(
    formData.target_pipeline_id || undefined,
  );

  useEffect(() => {
    if (open) {
      // This is UI draft hydration when the dialog opens or switches queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenSections([]);
      setPendingUserId("");
    }
  }, [open, queue?.id]);

  // Initialize form when queue changes
  useEffect(() => {
    if (queue) {
      const existingConditions: RuleCondition[] = (queue.rules || []).map(
        (rule) => {
          const matchType = isRuleConditionType(rule.match_type)
            ? rule.match_type
            : "source";
          const matchValueStr = rule.match_value || "";
          const sessionId =
            matchType === "whatsapp_message_contains"
              ? whatsappSessionIdFromMatch(rule.match)
              : undefined;
          let values: string[] = [];
          if (matchValueStr) {
            values =
              matchType === "whatsapp_message_contains"
                ? [matchValueStr.trim()].filter(Boolean)
                : matchValueStr
                    .split(",")
                    .map((v: string) => v.trim())
                    .filter(Boolean);
          }
          return { id: rule.id, type: matchType, values, sessionId };
        },
      );

      const existingMembers = hydrateQueueMembers(queue.members || [], teams);
      const strategy: QueueStrategy = isQueueStrategy(queue.strategy)
        ? queue.strategy
        : "simple";

      // This is form draft hydration from the selected queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        name: queue.name || "",
        strategy,
        target_pipeline_id: queue.target_pipeline_id || "",
        target_stage_id: queue.target_stage_id || "",
        is_active: queue.is_active ?? true,
        settings: {
          enable_redistribution: false,
          redistribution_timeout_minutes: 20,
          redistribution_warning_minutes: 5,
          redistribution_max_attempts: 10,
          preserve_position: true,
          require_checkin: false,
          ...(queue.settings || {}),
          reentry_behavior:
            queue.reentry_behavior ??
            queue.settings?.reentry_behavior ??
            "redistribute",
        },
        conditions: existingConditions,
        members: existingMembers,
      });
    } else {
      // This is form draft hydration for create mode.
      setFormData({
        name: "",
        strategy: "simple",
        target_pipeline_id: "",
        target_stage_id: "",
        is_active: true,
        settings: {
          enable_redistribution: false,
          redistribution_timeout_minutes: 20,
          redistribution_warning_minutes: 5,
          redistribution_max_attempts: 10,
          preserve_position: true,
          require_checkin: false,
          reentry_behavior: "redistribute",
        },
        conditions: [],
        members: [],
      });
    }
    // Intentionally initialize only when the dialog opens or switches queue.
    // Team/user query refreshes must not reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue?.id]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );
  };

  const addCondition = () => {
    setFormData((prev) => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        {
          id: createClientId("condition"),
          type: prev.conditions.some(
            (condition) => condition.type === "whatsapp_message_contains",
          )
            ? "whatsapp_message_contains"
            : "source",
          values: [],
        },
      ],
    }));
  };

  const updateCondition = (id: string, updates: Partial<RuleCondition>) => {
    setFormData((prev) => {
      const current = prev.conditions.find((condition) => condition.id === id);
      const conditions = prev.conditions.map((condition) =>
        condition.id === id ? { ...condition, ...updates } : condition,
      );
      const removedLastWhatsAppCondition =
        current?.type === "whatsapp_message_contains" &&
        updates.type !== undefined &&
        updates.type !== "whatsapp_message_contains" &&
        !conditions.some(
          (condition) => condition.type === "whatsapp_message_contains",
        );

      return {
        ...prev,
        conditions,
        settings: removedLastWhatsAppCondition
          ? {
              ...prev.settings,
              ignore_availability: queue?.settings?.ignore_availability,
            }
          : prev.settings,
      };
    });
  };

  const removeCondition = (id: string) => {
    setFormData((prev) => {
      const removed = prev.conditions.find((condition) => condition.id === id);
      const conditions = prev.conditions.filter(
        (condition) => condition.id !== id,
      );
      const removedLastWhatsAppCondition =
        removed?.type === "whatsapp_message_contains" &&
        !conditions.some(
          (condition) => condition.type === "whatsapp_message_contains",
        );

      return {
        ...prev,
        conditions,
        settings: removedLastWhatsAppCondition
          ? {
              ...prev.settings,
              ignore_availability: queue?.settings?.ignore_availability,
            }
          : prev.settings,
      };
    });
  };

  const addMember = (
    type: "user" | "team",
    entityId: string,
    name: string,
    teamId?: string,
  ) => {
    if (!entityId.trim()) return;
    if (type === "team" && hasWhatsAppMessageCondition) {
      toast.error(
        "Campanhas do WhatsApp exigem corretores adicionados individualmente.",
      );
      return;
    }

    setFormData((prev) => ({
      ...prev,
      members: prev.members.some(
        (m) => m.type === type && m.entityId === entityId,
      )
        ? prev.members
        : [...prev.members, { type, entityId, teamId, weight: 10, name }],
    }));
  };

  const addDirectUser = (userId: string) => {
    const user = visibleUsers.find((candidate) => candidate.id === userId);
    if (!user) return;

    const userTeams = activeTeamsForUser(userId, visibleTeams);
    const resolution = resolveDirectUserTeamContext(
      userTeams.map((team) => team.id),
      undefined,
      queueIgnoresAvailability(formData.settings.ignore_availability),
    );
    if (resolution.status === "resolved") {
      addMember("user", userId, user.name, resolution.teamId);
      setPendingUserId("");
      return;
    }
    if (resolution.status === "requires-team") {
      setPendingUserId(userId);
      toast.info("Escolha a equipe usada para os horários deste corretor.");
      return;
    }

    setPendingUserId("");
    toast.error(
      "Este corretor precisa estar em uma equipe ativa com horários configuráveis.",
    );
  };

  const updateMemberWeight = (memberKey: string, weight: number) => {
    setFormData((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        queueMemberKey(m) === memberKey
          ? { ...m, weight: Math.max(1, weight) }
          : m,
      ),
    }));
  };

  const updateMemberTeam = (memberKey: string, teamId: string) => {
    setFormData((prev) => ({
      ...prev,
      members: prev.members.map((member) =>
        queueMemberKey(member) === memberKey
          ? { ...member, teamId }
          : member,
      ),
    }));
  };

  const removeMember = (memberKey: string) => {
    setFormData((prev) => ({
      ...prev,
      members: prev.members.filter((m) => queueMemberKey(m) !== memberKey),
    }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFormData((prev) => {
        const oldIndex = prev.members.findIndex(
          (m) => queueMemberKey(m) === active.id,
        );
        const newIndex = prev.members.findIndex(
          (m) => queueMemberKey(m) === over.id,
        );
        if (oldIndex < 0 || newIndex < 0) return prev;
        return {
          ...prev,
          members: arrayMove(prev.members, oldIndex, newIndex),
        };
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome da fila e obrigatorio");
      return;
    }
    if (!formData.target_pipeline_id) {
      toast.error("Pipeline de destino e obrigatorio");
      return;
    }
    if (!formData.target_stage_id) {
      toast.error("Estagio inicial e obrigatorio");
      return;
    }
    if (
      hasPipelineRestriction &&
      !effectiveAllowedPipelineIds.includes(formData.target_pipeline_id)
    ) {
      toast.error("Você só pode criar filas para pipelines da sua equipe");
      return;
    }
    const participantDataLoading = formData.members.some((member) =>
      member.type === "user"
        ? teamsLoading || usersLoading
        : teamsLoading,
    );
    if (participantDataLoading) {
      toast.error("Aguarde o carregamento das equipes e dos corretores.");
      return;
    }
    if (hasTeamRestriction || hasUserRestriction) {
      const invalidMember = formData.members.some((member) => {
        if (member.type === "team") {
          return (
            hasTeamRestriction &&
            !effectiveAllowedTeamIds.includes(member.entityId)
          );
        }
        return (
          (hasUserRestriction &&
            !effectiveAllowedUserIds.includes(member.entityId)) ||
          (hasTeamRestriction &&
            Boolean(member.teamId) &&
            !effectiveAllowedTeamIds.includes(member.teamId || ""))
        );
      });
      if (invalidMember) {
        toast.error("Você só pode distribuir para sua equipe ou membros dela");
        return;
      }
    }
    const validUserIds = new Set(visibleUsers.map((user) => user.id));
    const validTeamIds = new Set(visibleTeams.map((team) => team.id));
    const ignoreAvailability = queueIgnoresAvailability(
      formData.settings.ignore_availability,
    );
    const validMembers: QueueMember[] = [];
    for (const member of formData.members) {
      if (!member.entityId?.trim()) continue;
      if (member.type === "team") {
        if (validTeamIds.has(member.entityId)) validMembers.push(member);
        continue;
      }
      if (!validUserIds.has(member.entityId)) continue;

      const userTeams = activeTeamsForUser(member.entityId, visibleTeams);
      const resolution = resolveDirectUserTeamContext(
        userTeams.map((team) => team.id),
        member.teamId,
        ignoreAvailability,
      );
      if (resolution.status === "requires-team") {
        toast.error(
          `Escolha a equipe usada para os horários de ${member.name || "cada corretor"}.`,
        );
        return;
      }
      if (resolution.status === "unavailable") {
        toast.error(
          `${member.name || "O corretor"} não possui uma equipe ativa válida para esta fila.`,
        );
        return;
      }
      validMembers.push({ ...member, teamId: resolution.teamId });
    }
    if (validMembers.length !== formData.members.length) {
      toast.info(
        "Removi participantes pendentes ou inativos antes de salvar a fila.",
      );
      setFormData((prev) => ({ ...prev, members: validMembers }));
    }
    const configuredWhatsAppMessageConditions = formData.conditions.filter(
      (condition) =>
        condition.type === "whatsapp_message_contains" &&
        condition.values.some((value) => value.trim()),
    );
    const hasConfiguredWhatsAppMessageCondition =
      configuredWhatsAppMessageConditions.length > 0;
    if (
      configuredWhatsAppMessageConditions.some(
        (condition) => !condition.sessionId?.trim(),
      )
    ) {
      toast.error(
        "Selecione a conexão do WhatsApp para cada campanha configurada.",
      );
      return;
    }
    const invalidWhatsAppSession = configuredWhatsAppMessageConditions.find(
      (condition) => {
        const selectedSession = whatsappSessions.find(
          (session) => session.id === condition.sessionId,
        );
        return (
          !selectedSession ||
          !selectedSession.is_active ||
          ["disabled", "deleted"].includes(
            selectedSession.status.trim().toLowerCase(),
          ) ||
          selectedSession.provider !== "evolution_go"
        );
      },
    );
    if (invalidWhatsAppSession) {
      toast.error(
        "Selecione uma conexão do WhatsApp ativa para esta campanha.",
      );
      return;
    }
    const hasConfiguredNonWhatsAppCondition = formData.conditions.some(
      (condition) =>
        condition.type !== "whatsapp_message_contains" &&
        condition.values.some((value) => value.trim()),
    );
    if (formData.is_active && hasConfiguredWhatsAppMessageCondition) {
      if (hasConfiguredNonWhatsAppCondition) {
        toast.error(
          "Crie uma fila dedicada para campanhas do WhatsApp, sem outros critérios de entrada.",
        );
        return;
      }
      if (formData.strategy !== "simple") {
        toast.error("Campanhas do WhatsApp usam distribuição sequencial.");
        return;
      }
      if (formData.settings.enable_redistribution) {
        toast.error(
          "Desative a redistribuição automática nesta fila de campanha do WhatsApp.",
        );
        return;
      }
      if (validMembers.some((member) => member.type === "team")) {
        toast.error(
          "Campanhas do WhatsApp exigem corretores adicionados individualmente.",
        );
        return;
      }
      if (!validMembers.some((member) => member.type === "user")) {
        toast.error(
          "Adicione pelo menos um corretor para distribuir a campanha do WhatsApp.",
        );
        return;
      }
      if (formData.settings.require_checkin) {
        toast.error(
          "Campanhas do WhatsApp não podem usar check-in obrigatório nesta fila.",
        );
        return;
      }
      if (!ignoreAvailability) {
        toast.error(
          "Ative “Ignorar escala dos corretores” para distribuir a campanha do WhatsApp.",
        );
        return;
      }
    }
    const hasValidCriteria = formData.conditions.some(
      (condition) =>
        condition.values.some((value) => value.trim()) &&
        (condition.type !== "whatsapp_message_contains" ||
          Boolean(condition.sessionId?.trim())),
    );
    if (!hasValidCriteria) {
      toast.error(
        "Adicione pelo menos um criterio de entrada para salvar a fila",
      );
      return;
    }
    if (formData.is_active && validMembers.length === 0) {
      toast.error("Adicione pelo menos um participante antes de ativar a fila");
      return;
    }
    if (formData.settings.enable_redistribution) {
      const timeout = formData.settings.redistribution_timeout_minutes ?? 20;
      const warning = formData.settings.redistribution_warning_minutes ?? 5;
      if (timeout < 1 || timeout > 10080) {
        toast.error(
          "O prazo de redistribuicao deve ficar entre 1 minuto e 7 dias.",
        );
        return;
      }
      if (warning < 0 || warning >= timeout) {
        toast.error(
          "O aviso precisa acontecer antes do prazo de redistribuicao.",
        );
        return;
      }
      const hasTeam = validMembers.some((member) => member.type === "team");
      const directUsers = new Set(
        validMembers
          .filter((member) => member.type === "user")
          .map((member) => member.entityId),
      );
      if (!hasTeam && directUsers.size < 2) {
        toast.error(
          "A redistribuicao automatica precisa de pelo menos dois corretores ativos.",
        );
        return;
      }
    }
    const sanitizedConditions = formData.conditions
      .map((condition) => ({
        ...condition,
        values: condition.values.map((value) => value.trim()).filter(Boolean),
        sessionId: condition.type === 'whatsapp_message_contains'
          ? condition.sessionId?.trim()
          : undefined,
      }))
      .filter((condition) => condition.values.length > 0);
    const sanitizedHasWhatsAppMessageCondition = sanitizedConditions.some(
      (condition) => condition.type === "whatsapp_message_contains",
    );
    const payload: QueueFormData = {
      ...formData,
      settings: sanitizedHasWhatsAppMessageCondition
        ? formData.settings
        : {
            ...formData.settings,
            ignore_availability: queue?.settings?.ignore_availability,
          },
      conditions: sanitizedConditions,
      members: validMembers,
    };
    setSaving(true);
    try {
      await onSave(payload);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  const totalWeight = formData.members.reduce((sum, m) => sum + m.weight, 0);
  const renderConditionValueSelector = (condition: RuleCondition) => {
    switch (condition.type) {
      case "source":
        return (
          <div className="flex flex-wrap gap-1">
            {SOURCE_OPTIONS.map((opt) => (
              <Badge
                key={opt.value}
                variant="outline"
                className={conditionOptionBadgeClass(
                  condition.values.includes(opt.value),
                )}
                onClick={() => {
                  const newValues = condition.values.includes(opt.value)
                    ? condition.values.filter((v) => v !== opt.value)
                    : [...condition.values, opt.value];
                  updateCondition(condition.id, { values: newValues });
                }}
              >
                {opt.label}
              </Badge>
            ))}
          </div>
        );
      case "webhook":
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Webhooks:</p>
            <div className="flex flex-wrap gap-1">
              {incomingWebhooks.length === 0 && (
                <span className="rounded-md bg-[var(--app-surface)] px-2 py-1 text-xs text-muted-foreground">
                  Nenhum webhook de entrada encontrado.
                </span>
              )}
              {incomingWebhooks.map((wh) => (
                <Badge
                  key={wh.id}
                  variant="outline"
                  className={cn(
                    conditionOptionBadgeClass(condition.values.includes(wh.id)),
                    "gap-1",
                  )}
                  onClick={() => {
                    const newValues = condition.values.includes(wh.id)
                      ? condition.values.filter((v) => v !== wh.id)
                      : [...condition.values, wh.id];
                    updateCondition(condition.id, { values: newValues });
                  }}
                >
                  <Webhook className="h-3 w-3" />
                  {wh.name}
                </Badge>
              ))}
            </div>
          </div>
        );
      case "whatsapp_session":
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Conexoes WhatsApp:</p>
            <div className="flex flex-wrap gap-1">
              {activeWhatsAppSessions.length === 0 && (
                <span className="rounded-md bg-[var(--app-surface)] px-2 py-1 text-xs text-muted-foreground">
                  Nenhuma conexão WhatsApp ativa.
                </span>
              )}
              {activeWhatsAppSessions.map((session) => (
                <Badge
                  key={session.id}
                  variant="outline"
                  className={cn(
                    conditionOptionBadgeClass(
                      condition.values.includes(session.id),
                    ),
                    "gap-1",
                  )}
                  onClick={() => {
                    const newValues = condition.values.includes(session.id)
                      ? condition.values.filter((v) => v !== session.id)
                      : [...condition.values, session.id];
                    updateCondition(condition.id, { values: newValues });
                  }}
                >
                  <MessageSquare className="h-3 w-3" />
                  {session.display_name ||
                    session.phone_number ||
                    session.instance_name}
                </Badge>
              ))}
            </div>
          </div>
        );
      case "meta_form":
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Formularios Meta:</p>
            <div className="flex flex-wrap gap-1">
              {metaFormConfigs.length === 0 && (
                <span className="rounded-md bg-[var(--app-surface)] px-2 py-1 text-xs text-muted-foreground">
                  Nenhum formulário Meta integrado.
                </span>
              )}
              {metaFormConfigs.map((form) => (
                <Badge
                  key={form.form_id}
                  variant="outline"
                  className={cn(
                    conditionOptionBadgeClass(
                      condition.values.includes(form.form_id),
                    ),
                    "gap-1",
                  )}
                  onClick={() => {
                    const newValues = condition.values.includes(form.form_id)
                      ? condition.values.filter((v) => v !== form.form_id)
                      : [...condition.values, form.form_id];
                    updateCondition(condition.id, { values: newValues });
                  }}
                >
                  {form.form_name || form.form_id}
                </Badge>
              ))}
            </div>
          </div>
        );
      case "website_category":
        return (
          <div className="flex flex-wrap gap-1">
            {WEBSITE_CATEGORY_OPTIONS.map((opt) => (
              <Badge
                key={opt.value}
                variant="outline"
                className={cn(
                  conditionOptionBadgeClass(
                    condition.values.includes(opt.value),
                  ),
                  "gap-1",
                )}
                onClick={() => {
                  const newValues = condition.values.includes(opt.value)
                    ? condition.values.filter((v) => v !== opt.value)
                    : [...condition.values, opt.value];
                  updateCondition(condition.id, { values: newValues });
                }}
              >
                <Globe className="h-3 w-3" />
                {opt.label}
              </Badge>
            ))}
          </div>
        );
      case "campaign_contains":
        return (
          <Input
            placeholder="Digite parte do nome da campanha..."
            value={condition.values[0] || ""}
            onChange={(e) =>
              updateCondition(condition.id, { values: [e.target.value] })
            }
          />
        );
      case "whatsapp_message_contains": {
        const selectedSession = whatsappSessions.find(
          (session) => session.id === condition.sessionId,
        );
        const selectableSession = campaignWhatsAppSessions.find(
          (session) => session.id === condition.sessionId,
        );
        const selectedSessionUnavailable = Boolean(
          condition.sessionId && !selectableSession,
        );
        const selectedSessionLabel =
          selectedSession?.display_name ||
          selectedSession?.phone_number ||
          selectedSession?.instance_name ||
          "Conexão salva indisponível";
        const selectedSessionConnected =
          selectedSession?.status.trim().toLowerCase() === "connected";

        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`whatsapp-session-${condition.id}`}>
                Conexão WhatsApp *
              </Label>
              <Select
                value={condition.sessionId || ""}
                onValueChange={(sessionId) =>
                  updateCondition(condition.id, { sessionId })
                }
                disabled={
                  campaignWhatsAppSessions.length === 0 && !condition.sessionId
                }
              >
                <SelectTrigger
                  id={`whatsapp-session-${condition.id}`}
                  className={!condition.sessionId ? "border-destructive" : ""}
                >
                  <SelectValue placeholder="Selecione uma conexão..." />
                </SelectTrigger>
                <SelectContent>
                  {selectedSessionUnavailable && condition.sessionId && (
                    <SelectItem value={condition.sessionId} disabled>
                      {selectedSessionLabel} (indisponível)
                    </SelectItem>
                  )}
                  {campaignWhatsAppSessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.display_name ||
                        session.phone_number ||
                        session.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {campaignWhatsAppSessions.length === 0 &&
                !condition.sessionId && (
                  <p className="text-xs text-destructive">
                    Nenhuma conexão do WhatsApp ativa está disponível para esta
                    conta.
                  </p>
                )}
              {!condition.sessionId &&
                campaignWhatsAppSessions.length > 0 && (
                  <p className="text-xs text-destructive">
                    Selecione a conexão que receberá esta campanha.
                  </p>
                )}
            </div>

            <Label htmlFor={`whatsapp-message-${condition.id}`}>
              Mensagem contém
            </Label>
            <Input
              id={`whatsapp-message-${condition.id}`}
              maxLength={180}
              placeholder="Digite uma palavra ou trecho da mensagem..."
              value={condition.values[0] || ""}
              onChange={(e) =>
                updateCondition(condition.id, { values: [e.target.value] })
              }
            />
            {selectedSessionUnavailable ? (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                A conexão salva não está disponível nesta conta. Ela foi
                preservada; selecione outra para validar o funcionamento.
              </p>
            ) : condition.sessionId ? (
              <p
                className={cn(
                  "rounded-md px-3 py-2 text-xs",
                  selectedSessionConnected
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                )}
              >
                {selectedSessionConnected
                  ? "Quando esta conexão receber uma mensagem com esse trecho de um contato ainda não cadastrado, o CRM cria o lead automaticamente e o envia para esta fila."
                  : "Esta conexão não está conectada. Reconecte-a para receber a mensagem, criar o lead e fazer a distribuição automaticamente."}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Selecione a conexão que receberá a mensagem e criará o lead automaticamente.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Nesta fila, adicione os corretores individualmente e use
              distribuição sequencial.
            </p>
          </div>
        );
      }
      case "tag":
        return (
          <div className="flex flex-wrap gap-1">
            {tags.length === 0 && (
              <span className="rounded-md bg-[var(--app-surface)] px-2 py-1 text-xs text-muted-foreground">
                Nenhuma tag cadastrada.
              </span>
            )}
            {tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="outline"
                className={conditionOptionBadgeClass(
                  condition.values.includes(tag.id),
                )}
                style={
                  condition.values.includes(tag.id)
                    ? { backgroundColor: tag.color, borderColor: tag.color }
                    : {}
                }
                onClick={() => {
                  const newValues = condition.values.includes(tag.id)
                    ? condition.values.filter((v) => v !== tag.id)
                    : [...condition.values, tag.id];
                  updateCondition(condition.id, { values: newValues });
                }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        );
      case "city":
        return (
          <Input
            placeholder="Ex: Sao Paulo, Campinas"
            value={condition.values.join(", ")}
            onChange={(e) =>
              updateCondition(condition.id, {
                values: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        );
      case "interest_property":
        if (!hasPropertiesModule) {
          return (
            <p className="rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
              O módulo de imóveis não está disponível. O critério existente será
              preservado até ser removido.
            </p>
          );
        }
        return (
          <PropertyPickerDialog
            properties={properties}
            selectedPropertyId={condition.values[0]}
            onSelect={(prop) =>
              updateCondition(condition.id, { values: [prop.id] })
            }
          />
        );
      default:
        return null;
    }
  };

  const hasValidCriteria = formData.conditions.some(
    (condition) =>
      condition.values.some((value) => value.trim()) &&
      (condition.type !== "whatsapp_message_contains" ||
        Boolean(condition.sessionId?.trim())),
  );
  const hasRequiredMembers = !formData.is_active || formData.members.length > 0;
  const canSave =
    !!formData.name.trim() &&
    !!formData.target_pipeline_id &&
    !!formData.target_stage_id &&
    hasValidCriteria &&
    hasRequiredMembers &&
    !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="distribution-queue-editor"
        className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-6xl flex-col gap-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none sm:max-h-[88dvh]"
      >
        <DialogHeader className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-4 py-3 sm:px-5">
          <DialogTitle className="text-[14px] font-normal">
            {queue
              ? "Editar Fila de Distribuicao"
              : "Nova Fila de Distribuicao"}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4 [&_input]:rounded-[6px] [&_label]:text-[12px] [&_label]:font-light">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <Collapsible
                data-tour="distribution-queue-basic"
                open={openSections.includes("basic")}
                onOpenChange={() => toggleSection("basic")}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-primary" />
                    <span className="font-medium">Informações básicas</span>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      openSections.includes("basic") && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Nome da fila *</Label>
                      <Input
                        placeholder="Ex: Leads Facebook"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Estrategia</Label>
                      <Select
                        value={formData.strategy}
                        onValueChange={(value) => {
                          if (isQueueStrategy(value)) {
                            if (
                              value === "weighted" &&
                              hasWhatsAppMessageCondition
                            ) {
                              toast.error(
                                "Campanhas do WhatsApp usam distribuição sequencial.",
                              );
                              return;
                            }
                            setFormData((prev) => ({
                              ...prev,
                              strategy: value,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simple">Sequencial</SelectItem>
                          <SelectItem
                            value="weighted"
                            disabled={hasWhatsAppMessageCondition}
                          >
                            Ponderada
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Pipeline de destino *</Label>
                      <Select
                        value={formData.target_pipeline_id || ""}
                        onValueChange={(v) =>
                          setFormData((prev) => ({
                            ...prev,
                            target_pipeline_id: v,
                            target_stage_id: "",
                          }))
                        }
                      >
                        <SelectTrigger
                          className={
                            !formData.target_pipeline_id
                              ? "border-destructive"
                              : ""
                          }
                        >
                          <SelectValue placeholder="Selecione um pipeline..." />
                        </SelectTrigger>
                        <SelectContent>
                          {visiblePipelines.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Estagio inicial *</Label>
                      <Select
                        value={formData.target_stage_id || ""}
                        onValueChange={(v) =>
                          setFormData((prev) => ({
                            ...prev,
                            target_stage_id: v,
                          }))
                        }
                        disabled={!formData.target_pipeline_id}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um estágio..." />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor: s.color ?? undefined,
                                  }}
                                />
                                {s.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible
                data-tour="distribution-queue-rules"
                open={openSections.includes("rules")}
                onOpenChange={() => toggleSection("rules")}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-primary" />
                    <span className="font-medium">Regras de entrada</span>
                    {formData.conditions.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {formData.conditions.length}
                      </Badge>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      openSections.includes("rules") && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  <p className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-xs text-muted-foreground">
                    Defina quais leads entram nesta fila. Use canal para regras
                    amplas e os campos específicos quando quiser travar uma
                    origem exata.
                  </p>
                  {formData.conditions.map((condition) => (
                    <div
                      key={condition.id}
                      className="space-y-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Select
                          value={condition.type}
                          onValueChange={(value) => {
                            if (isRuleConditionType(value)) {
                              if (value === "whatsapp_message_contains") {
                                const hasOtherConfiguredCondition =
                                  formData.conditions.some(
                                    (candidate) =>
                                      candidate.id !== condition.id &&
                                      candidate.type !==
                                        "whatsapp_message_contains" &&
                                      candidate.values.some((item) =>
                                        item.trim(),
                                      ),
                                  );
                                if (hasOtherConfiguredCondition) {
                                  toast.error(
                                    "Crie uma fila dedicada para campanhas do WhatsApp.",
                                  );
                                  return;
                                }
                                if (formData.strategy !== "simple") {
                                  toast.error(
                                    "Campanhas do WhatsApp usam distribuição sequencial.",
                                  );
                                  return;
                                }
                                if (formData.settings.enable_redistribution) {
                                  toast.error(
                                    "Desative a redistribuição automática antes de usar uma campanha do WhatsApp.",
                                  );
                                  return;
                                }
                                if (formData.settings.require_checkin) {
                                  toast.error(
                                    "Use uma fila sem check-in obrigatório para campanhas do WhatsApp.",
                                  );
                                  return;
                                }
                                if (
                                  formData.members.some(
                                    (member) => member.type === "team",
                                  )
                                ) {
                                  toast.error(
                                    "Remova as equipes e adicione os corretores individualmente.",
                                  );
                                  return;
                                }
                              } else {
                                const hasOtherConfiguredWhatsAppCondition =
                                  formData.conditions.some(
                                    (candidate) =>
                                      candidate.id !== condition.id &&
                                      candidate.type ===
                                        "whatsapp_message_contains" &&
                                      candidate.values.some((item) =>
                                        item.trim(),
                                      ),
                                  );
                                if (hasOtherConfiguredWhatsAppCondition) {
                                  toast.error(
                                    "Crie uma fila dedicada para campanhas do WhatsApp.",
                                  );
                                  return;
                                }
                              }
                              updateCondition(condition.id, {
                                type: value,
                                values: [],
                                sessionId: undefined,
                              });
                            }
                          }}
                        >
                          <SelectTrigger className="w-full min-w-0 border border-[var(--app-border)] bg-[var(--app-surface-solid)] shadow-none sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableConditionTypes.map((ct) => (
                              <SelectItem key={ct.value} value={ct.value}>
                                {ct.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeCondition(condition.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {renderConditionValueSelector(condition)}
                    </div>
                  ))}
                  {hasWhatsAppMessageCondition && (
                    <div className="flex items-start justify-between gap-4 rounded-lg bg-[var(--app-surface-soft)] p-3">
                      <div className="space-y-1">
                        <Label htmlFor="distribution-ignore-availability">
                          Ignorar escala dos corretores *
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Obrigatório nesta campanha. A fila distribui entre os
                          corretores ativos mesmo fora dos dias e horários
                          definidos na escala.
                        </p>
                      </div>
                      <Switch
                        id="distribution-ignore-availability"
                        checked={queueIgnoresAvailability(
                          formData.settings.ignore_availability,
                        )}
                        onCheckedChange={(checked) =>
                          setFormData((prev) => ({
                            ...prev,
                            settings: {
                              ...prev.settings,
                              ignore_availability: checked,
                            },
                          }))
                        }
                      />
                    </div>
                  )}
                  {!hasValidCriteria && (
                    <p className="text-xs text-destructive">
                      Adicione pelo menos um criterio preenchido para salvar a
                      fila.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    onClick={addCondition}
                    className="w-full gap-2"
                  >
                    <Plus className="h-4 w-4" /> Nova condicao
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <div className="space-y-4">
              <Collapsible
                data-tour="distribution-queue-members"
                open={openSections.includes("members")}
                onOpenChange={() => toggleSection("members")}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="font-medium">Ordem de distribuicao</span>
                    {formData.members.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {formData.members.length}
                      </Badge>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      openSections.includes("members") && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  {formData.members.length > 0 && (
                    <div className="overflow-hidden rounded-[6px] border-0 bg-[var(--app-surface)]">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis]}
                      >
                        <Table>
                          <TableHeader className="[&_tr]:border-0">
                            <TableRow className="border-0 hover:bg-transparent">
                              <TableHead className="w-10" />
                              <TableHead>Participante</TableHead>
                              <TableHead className="w-32 text-center">
                                {formData.strategy === "weighted"
                                  ? "Peso"
                                  : "Ordem"}
                              </TableHead>
                              <TableHead className="w-12" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <SortableContext
                              items={formData.members.map(queueMemberKey)}
                              strategy={verticalListSortingStrategy}
                            >
                              {formData.members.map((member, idx) => (
                                <SortableMemberRow
                                  key={queueMemberKey(member)}
                                  member={member}
                                  idx={idx}
                                  strategy={formData.strategy}
                                  totalWeight={totalWeight}
                                  teamOptions={
                                    member.type === "user"
                                      ? activeTeamsForUser(
                                          member.entityId,
                                          visibleTeams,
                                        )
                                      : []
                                  }
                                  ignoreAvailability={
                                    queueIgnoresAvailability(
                                      formData.settings.ignore_availability,
                                    )
                                  }
                                  onUpdateWeight={updateMemberWeight}
                                  onUpdateTeam={updateMemberTeam}
                                  onRemove={removeMember}
                                />
                              ))}
                            </SortableContext>
                          </TableBody>
                        </Table>
                      </DndContext>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select
                      value={pendingUserId}
                      onValueChange={addDirectUser}
                      disabled={teamsLoading || usersLoading}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Adicionar corretor..." />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableUsers.length === 0 && (
                          <SelectItem value="__no_users" disabled>
                            Nenhum corretor ativo disponível.
                          </SelectItem>
                        )}
                        {selectableUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      disabled={hasWhatsAppMessageCondition}
                      onValueChange={(v) => {
                        const team = visibleTeams.find((t) => t.id === v);
                        if (team) addMember("team", v, team.name);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Adicionar equipe..." />
                      </SelectTrigger>
                      <SelectContent>
                        {teamSelectMessage && (
                          <SelectItem value="__no_teams" disabled>
                            {teamSelectMessage}
                          </SelectItem>
                        )}
                        {selectableTeams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {hasWhatsAppMessageCondition && (
                    <p className="text-xs text-muted-foreground">
                      Para campanhas do WhatsApp, os corretores são adicionados
                      individualmente.
                    </p>
                  )}
                  {pendingUserId && pendingUserTeams.length > 1 && (
                    <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                      <Label className="mb-2 block">
                        Equipe usada para os horários
                      </Label>
                      <Select
                        onValueChange={(teamId) => {
                          const user = visibleUsers.find(
                            (candidate) => candidate.id === pendingUserId,
                          );
                          if (!user) return;
                          addMember(
                            "user",
                            pendingUserId,
                            user.name,
                            teamId,
                          );
                          setPendingUserId("");
                        }}
                      >
                        <SelectTrigger className="rounded-[6px] border-[var(--app-border)] bg-[var(--app-surface-solid)] shadow-none">
                          <SelectValue placeholder="Selecione uma equipe ativa..." />
                        </SelectTrigger>
                        <SelectContent>
                          {pendingUserTeams.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name || "Equipe"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {queueIgnoresAvailability(
                    formData.settings.ignore_availability,
                  ) && (
                    <p className="text-xs text-muted-foreground">
                      Esta fila está configurada para ignorar disponibilidade.
                      Corretores sem equipe ativa continuam elegíveis.
                    </p>
                  )}
                  {teams.length > 0 && activeTeams.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Ative uma equipe em Gestão &gt; Equipes para usá-la em uma
                      fila.
                    </p>
                  )}
                  {formData.is_active && formData.members.length === 0 && (
                    <p className="text-xs text-destructive">
                      Adicione pelo menos um participante para manter a fila
                      ativa.
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>

              <Collapsible
                data-tour="distribution-queue-redistribution"
                open={openSections.includes("redistribution")}
                onOpenChange={() => toggleSection("redistribution")}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    <span className="font-medium">Redistribuicao</span>
                    {formData.settings.enable_redistribution && (
                      <Badge variant="secondary" className="text-xs">
                        Ativa
                      </Badge>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      openSections.includes("redistribution") && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  <div className="space-y-4 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label>Ativar redistribuicao de lead parado</Label>
                        <p className="text-xs text-muted-foreground">
                          {hasWhatsAppMessageCondition
                            ? "Campanhas do WhatsApp usam somente a distribuição inicial desta fila."
                            : "Se o responsavel nao fizer contato nem movimentar o proprio lead no prazo, o sistema envia para o proximo participante da fila."}
                        </p>
                      </div>
                      <Switch
                        checked={!!formData.settings.enable_redistribution}
                        onCheckedChange={(checked) => {
                          if (checked && hasWhatsAppMessageCondition) {
                            toast.error(
                              "A redistribuição automática não está disponível para campanhas do WhatsApp.",
                            );
                            return;
                          }
                          setFormData((prev) => ({
                            ...prev,
                            settings: {
                              ...prev.settings,
                              enable_redistribution: checked,
                              redistribution_timeout_minutes:
                                prev.settings.redistribution_timeout_minutes ??
                                20,
                              redistribution_warning_minutes:
                                prev.settings.redistribution_warning_minutes ??
                                5,
                              redistribution_max_attempts:
                                prev.settings.redistribution_max_attempts ?? 10,
                            },
                          }));
                        }}
                      />
                    </div>

                    {formData.settings.enable_redistribution && (
                      <div className="space-y-3">
                        <p className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
                          A fila so sera ativada se houver pelo menos dois
                          corretores elegiveis. Equipes inativas e participantes
                          sem acesso a organizacao sao ignorados.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="space-y-2">
                            <Label>Tempo</Label>
                            <Input
                              type="number"
                              min={1}
                              value={
                                formData.settings
                                  .redistribution_timeout_minutes ?? 20
                              }
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  settings: {
                                    ...prev.settings,
                                    redistribution_timeout_minutes: Math.max(
                                      1,
                                      Number(e.target.value) || 20,
                                    ),
                                  },
                                }))
                              }
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Minutos.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label>Aviso</Label>
                            <Input
                              type="number"
                              min={0}
                              value={
                                formData.settings
                                  .redistribution_warning_minutes ?? 5
                              }
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  settings: {
                                    ...prev.settings,
                                    redistribution_warning_minutes: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  },
                                }))
                              }
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Minutos antes.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label>Tentativas</Label>
                            <Input
                              type="number"
                              min={0}
                              value={
                                formData.settings.redistribution_max_attempts ??
                                10
                              }
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  settings: {
                                    ...prev.settings,
                                    redistribution_max_attempts: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  },
                                }))
                              }
                            />
                            <p className="text-[11px] text-muted-foreground">
                              0 sem limite.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] px-4 py-3 sm:px-5">
          <Button
            variant="outline"
            className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            data-tour="distribution-queue-save"
            className="h-9 rounded-[6px] bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}{" "}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
