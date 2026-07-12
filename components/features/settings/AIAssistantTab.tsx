"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  GitBranch,
  MessageCircle,
  Plus,
  PlugZap,
  RefreshCcw,
  Route,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useAIOrganizationAgents,
  useAIRoutingRules,
  useAISettings,
  useCreateAIOrganizationAgent,
  useCreateAIRoutingRule,
  useDeleteAIOrganizationAgent,
  useDeleteAIRoutingRule,
  useAIEvents,
  useUpdateAIOrganizationAgent,
  useUpdateAIRoutingRule,
  useUpdateAISettings,
} from "@/hooks/use-ai-control-center";
import { useAIMetrics } from "@/hooks/use-ai-metrics";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useToggleAIAutoReplySession, useWhatsAppSessions, type WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { useAuth } from "@/contexts/AuthContext";
import {
  aiAPI,
  DEFAULT_AI_AGENT_CONFIG,
  type AIAgent,
  type AIAgentConfig,
  type AIAgentInput,
  type AIEvent,
  type AIMetricPoint,
  type AIRoutingConditions,
  type AIRoutingRule,
  type AIRoutingRuleInput,
} from "@/lib/api/ai";

type SessionSettings = {
  ai_auto_reply_enabled?: boolean;
  ai_auto_reply_agent_id?: string;
  ai_follow_up_enabled?: boolean;
  ai_follow_up_interval_days?: number;
  ai_follow_up_template?: string;
};

type AgentDraft = {
  id?: string;
  name: string;
  description: string;
  status: AIAgent["status"];
  type: string;
  prompt: string;
  model: string;
  temperature: number;
  allowedTools: string;
  handoffTargets: string;
  routingKeywords: string;
};

type RuleDraft = {
  id?: string;
  name: string;
  agentId: string;
  priority: number;
  isEnabled: boolean;
  action: AIRoutingRule["action"];
  sessionId: string;
  source: string;
  pipelineName: string;
  messageContains: string;
};

const followUpIntervals = [
  { label: "1 dia", value: 1 },
  { label: "3 dias", value: 3 },
  { label: "7 dias", value: 7 },
];

const followUpTemplates = [
  { key: "soft", label: "Leve", text: "Retoma sem pressao e pergunta se ainda faz sentido continuar." },
  { key: "property", label: "Imovel", text: "Usa interesse do lead para sugerir opcoes ou detalhes relevantes." },
  { key: "visit", label: "Visita", text: "Conduz para agendamento quando o lead demonstrou interesse claro." },
];

const agentTypeOptions = [
  { value: "triage", label: "Triagem" },
  { value: "mcmv", label: "MCMV" },
  { value: "high_value", label: "Alto padrao" },
  { value: "launch", label: "Lancamentos" },
  { value: "rent", label: "Locacao" },
  { value: "custom", label: "Personalizado" },
];

function emptyAgentDraft(): AgentDraft {
  return {
    name: "",
    description: "",
    status: "active",
    type: "custom",
    prompt: "",
    model: "gpt-4.1-mini",
    temperature: 0.3,
    allowedTools: "getLeadContext, searchProperties, classifyLeadIntent",
    handoffTargets: "",
    routingKeywords: "",
  };
}

function emptyRuleDraft(agentId = ""): RuleDraft {
  return {
    name: "",
    agentId,
    priority: 100,
    isEnabled: true,
    action: "route_to_agent",
    sessionId: "any",
    source: "",
    pipelineName: "",
    messageContains: "",
  };
}

function getSessionSettings(session?: WhatsAppSession | null): SessionSettings {
  const value = session?.advanced_settings;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as SessionSettings;
}

function formatSessionName(session: WhatsAppSession) {
  return session.display_name || session.profile_name || session.phone_number || "Conexao WhatsApp";
}

function normalizePhone(value?: string | null) {
  if (!value) return "Numero nao informado";
  return value.replace(/:.*$/, "");
}

export function AIAssistantTab() {
  const { organization, profile, isSuperAdmin } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const { toast } = useToast();
  const { hasModule } = useOrganizationModules();
  const { data: sessions = [], isLoading: sessionsLoading } = useWhatsAppSessions();
  const { data: metrics, isLoading: metricsLoading } = useAIMetrics();
  const { data: settings } = useAISettings();
  const { data: agents = [], isLoading: agentsLoading } = useAIOrganizationAgents();
  const { data: rules = [], isLoading: rulesLoading } = useAIRoutingRules();
  const { data: events = [], isLoading: eventsLoading } = useAIEvents();
  const updateSettings = useUpdateAISettings();
  const createAgent = useCreateAIOrganizationAgent();
  const updateAgent = useUpdateAIOrganizationAgent();
  const deleteAgent = useDeleteAIOrganizationAgent();
  const createRule = useCreateAIRoutingRule();
  const updateRule = useUpdateAIRoutingRule();
  const deleteRule = useDeleteAIRoutingRule();
  const toggleAI = useToggleAIAutoReplySession();
  const aiModuleEnabled = hasModule("ai_agent");

  const connectedSessions = useMemo(
    () => sessions.filter((session) => session.status === "connected" && session.is_active !== false),
    [sessions],
  );
  const activeSessions = useMemo(
    () => connectedSessions.filter((session) => getSessionSettings(session).ai_auto_reply_enabled),
    [connectedSessions],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSession = connectedSessions.find((session) => session.id === selectedSessionId) || activeSessions[0] || connectedSessions[0];
  const selectedSettings = getSessionSettings(selectedSession);

  const [triagePrompt, setTriagePrompt] = useState("");
  const [triagePromptTouched, setTriagePromptTouched] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(() => emptyAgentDraft());
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(() => emptyRuleDraft());
  const [testMessage, setTestMessage] = useState("Oi, tenho interesse em um lancamento na planta. Pode me ajudar?");
  const [testAgentId, setTestAgentId] = useState("auto");
  const [testSessionId, setTestSessionId] = useState("none");
  const [limitDraft, setLimitDraft] = useState({ maxAgents: "", maxSessions: "", monthlyTokenLimit: "" });

  const effectiveTriagePrompt = triagePromptTouched ? triagePrompt : settings?.triagePrompt || "";
  const effectiveRuleAgentId = ruleDraft.agentId || agents[0]?.id || "";

  const testRun = useMutation({
    mutationFn: () =>
      aiAPI.run(
        {
          message: testMessage,
          agentId: testAgentId === "auto" ? undefined : testAgentId,
          sessionId: testSessionId === "none" ? undefined : testSessionId,
        },
        organizationId,
      ),
    onError: (error: Error) => {
      toast({ title: "Teste da IA falhou", description: error.message, variant: "destructive" });
    },
  });

  const updateSession = (session: WhatsAppSession, patch: Partial<SessionSettings>) => {
    const sessionSettings = getSessionSettings(session);
    toggleAI.mutate({
      sessionId: session.id,
      enabled: patch.ai_auto_reply_enabled ?? !!sessionSettings.ai_auto_reply_enabled,
      agentId: patch.ai_auto_reply_agent_id ?? sessionSettings.ai_auto_reply_agent_id,
      followUpEnabled: patch.ai_follow_up_enabled ?? sessionSettings.ai_follow_up_enabled,
      followUpIntervalDays: patch.ai_follow_up_interval_days ?? sessionSettings.ai_follow_up_interval_days ?? 3,
      followUpTemplate: patch.ai_follow_up_template ?? sessionSettings.ai_follow_up_template ?? "soft",
    });
  };

  const canCreateAgent = !!settings && settings.agentCount < settings.maxAgents;
  const operationalEnabled = !!settings?.isEnabled && aiModuleEnabled;
  const activeSessionLimitReached = !!settings && activeSessions.length >= settings.maxSessions;

  const saveTriagePrompt = () => {
    updateSettings.mutate({ triagePrompt: effectiveTriagePrompt });
  };

  const saveLimits = () => {
    if (!settings) return;
    updateSettings.mutate({
      maxAgents: Number(limitDraft.maxAgents || settings.maxAgents),
      maxSessions: Number(limitDraft.maxSessions || settings.maxSessions),
      monthlyTokenLimit: Number(limitDraft.monthlyTokenLimit || settings.monthlyTokenLimit),
    });
  };

  const saveAgent = () => {
    const input = buildAgentInput(agentDraft);
    if (!input.name || !input.config.prompt) {
      toast({ title: "Agente incompleto", description: "Informe nome e prompt antes de salvar.", variant: "destructive" });
      return;
    }
    if (agentDraft.id) {
      updateAgent.mutate({ id: agentDraft.id, input });
      return;
    }
    createAgent.mutate(input, {
      onSuccess: () => setAgentDraft(emptyAgentDraft()),
    });
  };

  const saveRule = () => {
    const input = buildRuleInput({ ...ruleDraft, agentId: effectiveRuleAgentId });
    if (!input.name || !input.agentId) {
      toast({ title: "Regra incompleta", description: "Escolha nome e agente da regra.", variant: "destructive" });
      return;
    }
    if (ruleDraft.id) {
      updateRule.mutate({ id: ruleDraft.id, input });
      return;
    }
    createRule.mutate(input, {
      onSuccess: () => setRuleDraft(emptyRuleDraft(agents[0]?.id || "")),
    });
  };

  return (
    <div data-tour="ai-overview" className="space-y-5">
      <section data-tour="ai-metrics" className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={MessageCircle} label="Leads recebidos" value={metricsLoading ? "..." : String(metrics?.leadsReceived ?? 0)} detail="ultimos 30 dias" />
        <MetricCard icon={Bot} label="Atendidos pela IA" value={metricsLoading ? "..." : String(metrics?.leadsAttended ?? 0)} detail={`${activeSessions.length} conexao(oes) ligada(s)`} tone="success" />
        <MetricCard icon={RefreshCcw} label="Follow-up" value={metricsLoading ? "..." : String(metrics?.followUpsActive ?? 0)} detail="retornos programados" tone="warning" />
        <MetricCard icon={ShieldCheck} label="Limite de agentes" value={settings ? `${settings.agentCount}/${settings.maxAgents}` : "..."} detail="controle do Superadmin" />
      </section>

      <div className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/12 text-primary">
            <WandSparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Central de IA da organizacao</p>
            <p className="text-xs text-muted-foreground">Modulo, conexao e regra precisam estar liberados para a IA responder.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={aiModuleEnabled ? "border-0 bg-emerald-500/15 text-emerald-400" : "border-0 bg-muted text-muted-foreground"}>
            {aiModuleEnabled ? "Modulo liberado" : "Modulo bloqueado"}
          </Badge>
          <span className="text-xs text-muted-foreground">{settings?.isEnabled ? "Operacao ligada" : "Operacao pausada"}</span>
          <Switch
            checked={!!settings?.isEnabled}
            disabled={!aiModuleEnabled || updateSettings.isPending}
            onCheckedChange={(checked) => updateSettings.mutate({ isEnabled: checked })}
          />
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-tour="ai-tabs" className="grid h-auto w-full grid-cols-2 gap-1 bg-[var(--app-surface-soft)] p-1 md:grid-cols-6">
          <TabsTrigger value="overview">Visao</TabsTrigger>
          <TabsTrigger data-tour="ai-tab-connections" value="connections">Conexoes</TabsTrigger>
          <TabsTrigger data-tour="ai-tab-agents" value="agents">Agentes</TabsTrigger>
          <TabsTrigger data-tour="ai-tab-routing" value="routing">Roteamento</TabsTrigger>
          <TabsTrigger data-tour="ai-tab-test" value="test">Teste</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_0.78fr]">
            <Panel title="Atendimento da IA" icon={BarChart3}>
              <AIMetricsChart series={metrics?.series || []} />
            </Panel>
            <Panel title="Saude operacional" icon={Activity}>
              <div className="space-y-3">
                <HealthRow label="Modulo Superadmin" ok={aiModuleEnabled} detail={aiModuleEnabled ? "Liberado para esta organizacao" : "Bloqueado no plano"} />
                <HealthRow label="Operacao da IA" ok={!!settings?.isEnabled} detail={settings?.isEnabled ? "Pode processar conexoes liberadas" : "Pausada para todos os canais"} />
                <HealthRow label="WhatsApp delegado" ok={activeSessions.length > 0} detail={`${activeSessions.length}/${settings?.maxSessions ?? 0} conexoes atendidas`} />
                <HealthRow label="Agente de triagem" ok={agents.some((agent) => agent.config.type === "triage" && agent.config.isDefault)} detail="Entrada padrao de qualquer conversa sem regra" />
              </div>
            </Panel>
          </div>

          <Panel title="Prompt da triagem" icon={GitBranch}>
            <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
              <Textarea
                value={effectiveTriagePrompt}
                onChange={(event) => {
                  setTriagePromptTouched(true);
                  setTriagePrompt(event.target.value);
                }}
                className="min-h-40 resize-y"
                placeholder="Defina como a triagem deve descobrir o interesse do lead antes de chamar um especialista."
              />
              <div className="space-y-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  A triagem deve descobrir interesse, urgencia e contexto. Quando estiver claro, ela passa para o agente especialista.
                </p>
                <Button className="w-full gap-2" onClick={saveTriagePrompt} disabled={updateSettings.isPending}>
                  <Save className="h-4 w-4" />
                  Salvar triagem
                </Button>
              </div>
            </div>
          </Panel>

          {isSuperAdmin && (
            <Panel title="Limites Superadmin" icon={SlidersHorizontal}>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                <Field label="Agentes">
                  <Input
                    type="number"
                    min={1}
                    value={limitDraft.maxAgents || settings?.maxAgents || ""}
                    onChange={(event) => setLimitDraft((draft) => ({ ...draft, maxAgents: event.target.value }))}
                  />
                </Field>
                <Field label="Conexoes IA">
                  <Input
                    type="number"
                    min={0}
                    value={limitDraft.maxSessions || settings?.maxSessions || ""}
                    onChange={(event) => setLimitDraft((draft) => ({ ...draft, maxSessions: event.target.value }))}
                  />
                </Field>
                <Field label="Tokens/mes">
                  <Input
                    type="number"
                    min={0}
                    value={limitDraft.monthlyTokenLimit || settings?.monthlyTokenLimit || ""}
                    onChange={(event) => setLimitDraft((draft) => ({ ...draft, monthlyTokenLimit: event.target.value }))}
                  />
                </Field>
                <Button className="gap-2" onClick={saveLimits} disabled={!settings || updateSettings.isPending}>
                  <Save className="h-4 w-4" />
                  Salvar
                </Button>
              </div>
            </Panel>
          )}
        </TabsContent>

        <TabsContent data-tour="ai-connections" value="connections" className="space-y-4">
          <Panel title="Conexoes que a IA pode atender" icon={PlugZap}>
            <div className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-2">
                {sessionsLoading && <p className="text-sm text-muted-foreground">Carregando conexoes...</p>}
                {!sessionsLoading && connectedSessions.length === 0 && <p className="text-sm text-muted-foreground">Nenhum WhatsApp conectado para delegar a IA.</p>}
                {connectedSessions.map((session) => {
                  const sessionSettings = getSessionSettings(session);
                  const enabled = !!sessionSettings.ai_auto_reply_enabled;
                  const disabledByLimit = !enabled && activeSessionLimitReached;
                  return (
                    <div
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSessionId(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          setSelectedSessionId(session.id);
                        }
                      }}
                      className={`w-full rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-left transition ${
                        selectedSession?.id === session.id ? "outline outline-1 outline-primary/70" : "hover:bg-[var(--app-surface-hover)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{formatSessionName(session)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{normalizePhone(session.phone_number)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{enabled ? "Atendendo" : "Parada"}</span>
                          <Switch
                            checked={enabled}
                            disabled={!operationalEnabled || toggleAI.isPending || disabledByLimit}
                            onClick={(event) => event.stopPropagation()}
                            onCheckedChange={(checked) => updateSession(session, { ai_auto_reply_enabled: checked })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-4 rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                <div>
                  <Label>Agente inicial desta conexao</Label>
                  <Select
                    value={selectedSettings.ai_auto_reply_agent_id || "auto"}
                    disabled={!selectedSession || toggleAI.isPending}
                    onValueChange={(value) => selectedSession && updateSession(selectedSession, { ai_auto_reply_agent_id: value === "auto" ? "" : value })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Triagem automatica" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Triagem automatica</SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <FollowUpControls
                  selectedSession={selectedSession}
                  selectedSettings={selectedSettings}
                  pending={toggleAI.isPending}
                  onUpdate={(patch) => selectedSession && updateSession(selectedSession, patch)}
                />
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent data-tour="ai-agents" value="agents" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Agentes da organizacao" icon={Bot}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{settings ? `${settings.agentCount} de ${settings.maxAgents} agentes usados` : "Carregando limite..."}</p>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => setAgentDraft(emptyAgentDraft())} disabled={!canCreateAgent}>
                  <Plus className="h-4 w-4" />
                  Novo
                </Button>
              </div>
              <div className="space-y-2">
                {agentsLoading && <p className="text-sm text-muted-foreground">Carregando agentes...</p>}
                {agents.map((agent) => (
                  <AgentListItem
                    key={agent.id}
                    agent={agent}
                    active={agentDraft.id === agent.id}
                    onEdit={() => setAgentDraft(draftFromAgent(agent))}
                    onDelete={() => deleteAgent.mutate(agent.id)}
                  />
                ))}
              </div>
            </Panel>

            <Panel title={agentDraft.id ? "Editar agente" : "Novo agente"} icon={WandSparkles}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome">
                  <Input value={agentDraft.name} onChange={(event) => setAgentDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="Especialista em lancamentos" />
                </Field>
                <Field label="Tipo">
                  <Select value={agentDraft.type} onValueChange={(value) => setAgentDraft((draft) => ({ ...draft, type: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agentTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={agentDraft.status} onValueChange={(value) => setAgentDraft((draft) => ({ ...draft, status: value as AIAgent["status"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="paused">Pausado</SelectItem>
                      <SelectItem value="draft">Rascunho</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Modelo">
                  <Input value={agentDraft.model} onChange={(event) => setAgentDraft((draft) => ({ ...draft, model: event.target.value }))} />
                </Field>
              </div>

              <Field label="Descricao">
                <Input value={agentDraft.description} onChange={(event) => setAgentDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="Quando este agente deve assumir" />
              </Field>

              <Field label="Prompt do agente">
                <Textarea value={agentDraft.prompt} onChange={(event) => setAgentDraft((draft) => ({ ...draft, prompt: event.target.value }))} className="min-h-36 resize-y" />
              </Field>

              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Ferramentas">
                  <Input value={agentDraft.allowedTools} onChange={(event) => setAgentDraft((draft) => ({ ...draft, allowedTools: event.target.value }))} />
                </Field>
                <Field label="Handoffs">
                  <Input value={agentDraft.handoffTargets} onChange={(event) => setAgentDraft((draft) => ({ ...draft, handoffTargets: event.target.value }))} placeholder="mcmv, launch" />
                </Field>
                <Field label="Palavras-chave">
                  <Input value={agentDraft.routingKeywords} onChange={(event) => setAgentDraft((draft) => ({ ...draft, routingKeywords: event.target.value }))} placeholder="planta, obra" />
                </Field>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="gap-2" onClick={saveAgent} disabled={createAgent.isPending || updateAgent.isPending || (!agentDraft.id && !canCreateAgent)}>
                  <Save className="h-4 w-4" />
                  Salvar agente
                </Button>
                <Button variant="outline" onClick={() => setAgentDraft(emptyAgentDraft())}>
                  Limpar
                </Button>
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent data-tour="ai-routing" value="routing" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <Panel title="Ordem de roteamento" icon={Route}>
              <div className="space-y-2">
                {rulesLoading && <p className="text-sm text-muted-foreground">Carregando regras...</p>}
                {!rulesLoading && rules.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma regra criada. Sem regra, a conversa cai na triagem padrao.</p>}
                {rules.map((rule) => (
                  <RuleListItem
                    key={rule.id}
                    rule={rule}
                    onEdit={() => setRuleDraft(draftFromRule(rule))}
                    onDelete={() => deleteRule.mutate(rule.id)}
                  />
                ))}
              </div>
            </Panel>

            <Panel title={ruleDraft.id ? "Editar regra" : "Nova regra"} icon={GitBranch}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome da regra">
                  <Input value={ruleDraft.name} onChange={(event) => setRuleDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="Lancamentos pelo WhatsApp comercial" />
                </Field>
                <Field label="Prioridade">
                  <Input type="number" value={ruleDraft.priority} onChange={(event) => setRuleDraft((draft) => ({ ...draft, priority: Number(event.target.value) || 100 }))} />
                </Field>
                <Field label="Agente">
                  <Select value={effectiveRuleAgentId} onValueChange={(value) => setRuleDraft((draft) => ({ ...draft, agentId: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um agente" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Acao">
                  <Select value={ruleDraft.action} onValueChange={(value) => setRuleDraft((draft) => ({ ...draft, action: value as AIRoutingRule["action"] }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="route_to_agent">Atender com agente</SelectItem>
                      <SelectItem value="handoff_to_agent">Handoff interno</SelectItem>
                      <SelectItem value="require_human">Pedir humano</SelectItem>
                      <SelectItem value="ignore">Ignorar</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Conexao WhatsApp">
                  <Select value={ruleDraft.sessionId} onValueChange={(value) => setRuleDraft((draft) => ({ ...draft, sessionId: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Qualquer conexao</SelectItem>
                      {connectedSessions.map((session) => (
                        <SelectItem key={session.id} value={session.id}>
                          {formatSessionName(session)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Origem">
                  <Input value={ruleDraft.source} onChange={(event) => setRuleDraft((draft) => ({ ...draft, source: event.target.value }))} placeholder="Meta Ads, WhatsApp, Webhook" />
                </Field>
                <Field label="Funil ou pipeline">
                  <Input value={ruleDraft.pipelineName} onChange={(event) => setRuleDraft((draft) => ({ ...draft, pipelineName: event.target.value }))} placeholder="Lancamentos" />
                </Field>
                <Field label="Mensagem contem">
                  <Input value={ruleDraft.messageContains} onChange={(event) => setRuleDraft((draft) => ({ ...draft, messageContains: event.target.value }))} placeholder="planta, obra, financiamento" />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <div>
                  <p className="text-sm font-semibold">Regra ativa</p>
                  <p className="text-xs text-muted-foreground">Regras pausadas ficam salvas, mas nao decidem atendimento.</p>
                </div>
                <Switch checked={ruleDraft.isEnabled} onCheckedChange={(checked) => setRuleDraft((draft) => ({ ...draft, isEnabled: checked }))} />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="gap-2" onClick={saveRule} disabled={createRule.isPending || updateRule.isPending || agents.length === 0}>
                  <Save className="h-4 w-4" />
                  Salvar regra
                </Button>
                <Button variant="outline" onClick={() => setRuleDraft(emptyRuleDraft(agents[0]?.id || ""))}>
                  Limpar
                </Button>
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent data-tour="ai-test" value="test" className="space-y-4">
          <Panel title="Simular atendimento" icon={TestTube2}>
            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-3">
                <Field label="Conexao de referencia">
                  <Select value={testSessionId} onValueChange={setTestSessionId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem conexao especifica</SelectItem>
                      {connectedSessions.map((session) => (
                        <SelectItem key={session.id} value={session.id}>
                          {formatSessionName(session)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Agente">
                  <Select value={testAgentId} onValueChange={setTestAgentId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto: regra + triagem</SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Mensagem do lead">
                  <Textarea value={testMessage} onChange={(event) => setTestMessage(event.target.value)} className="min-h-32 resize-y" />
                </Field>
                <Button className="gap-2" onClick={() => testRun.mutate()} disabled={testRun.isPending || !testMessage.trim()}>
                  <TestTube2 className="h-4 w-4" />
                  Testar resposta
                </Button>
              </div>

              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                {!testRun.data && <p className="text-sm text-muted-foreground">A resposta do teste aparece aqui sem enviar WhatsApp real.</p>}
                {testRun.data && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border-0 bg-primary/15 text-primary">{testRun.data.agent?.name || "Roteamento"}</Badge>
                      <Badge variant="outline" className="border-transparent bg-[var(--app-surface-hover)]">
                        {testRun.data.mode}
                      </Badge>
                      {testRun.data.handoff && (
                        <Badge className="border-0 bg-amber-500/15 text-amber-300">
                          {testRun.data.handoff.fromAgent.name} {"->"} {testRun.data.handoff.toAgent.name}
                        </Badge>
                      )}
                    </div>
                    <div className="rounded-[8px] bg-background/50 p-4 text-sm leading-6">
                      {testRun.data.output || "Regra acionada sem resposta automatica."}
                    </div>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      {testRun.data.toolsUsed?.map((tool) => (
                        <p key={tool.name}>{tool.name}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Panel title="Logs da IA" icon={Activity}>
            {eventsLoading && <p className="text-sm text-muted-foreground">Carregando logs...</p>}
            {!eventsLoading && events.length === 0 && <p className="text-sm text-muted-foreground">Ainda nao ha eventos recentes da IA.</p>}
            <div className="space-y-2">
              {events.map((event) => (
                <AIEventRow key={event.id} event={event} />
              ))}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FollowUpControls({
  selectedSession,
  selectedSettings,
  pending,
  onUpdate,
}: {
  selectedSession?: WhatsAppSession;
  selectedSettings: SessionSettings;
  pending: boolean;
  onUpdate: (patch: Partial<SessionSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Follow-up automatico</p>
          <p className="text-xs text-muted-foreground">Fica preso a conexao selecionada.</p>
        </div>
        <Switch
          checked={!!selectedSettings.ai_follow_up_enabled}
          disabled={!selectedSession || !selectedSettings.ai_auto_reply_enabled || pending}
          onCheckedChange={(checked) => onUpdate({ ai_follow_up_enabled: checked })}
        />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Frequencia</p>
        <div className="grid grid-cols-3 gap-2">
          {followUpIntervals.map((item) => {
            const active = (selectedSettings.ai_follow_up_interval_days || 3) === item.value;
            return (
              <Button
                key={item.value}
                type="button"
                variant={active ? "default" : "outline"}
                disabled={!selectedSession || pending}
                onClick={() => onUpdate({ ai_follow_up_interval_days: item.value })}
              >
                {item.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-2">
        {followUpTemplates.map((item) => {
          const active = (selectedSettings.ai_follow_up_template || "soft") === item.key;
          return (
            <button
              key={item.key}
              type="button"
              disabled={!selectedSession || pending}
              onClick={() => onUpdate({ ai_follow_up_template: item.key })}
              className={`rounded-[8px] p-3 text-left transition ${
                active ? "bg-primary text-primary-foreground" : "bg-background/50 hover:bg-[var(--app-surface-hover)]"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {active && <CheckCircle2 className="h-4 w-4" />}
                {item.label}
              </span>
              <span className={`mt-1 block text-xs leading-5 ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                {item.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const color = tone === "success" ? "text-emerald-400" : tone === "warning" ? "text-amber-300" : "text-foreground";
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-primary/12 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Badge className={ok ? "border-0 bg-emerald-500/15 text-emerald-400" : "border-0 bg-muted text-muted-foreground"}>
        {ok ? "OK" : "Pendente"}
      </Badge>
    </div>
  );
}

function AIEventRow({ event }: { event: AIEvent }) {
  const failed = event.status === "failed" || event.eventType.includes("failed");
  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{eventLabel(event.eventType)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{payloadSummary(event.payload)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge className={failed ? "border-0 bg-red-500/15 text-red-300" : "border-0 bg-emerald-500/15 text-emerald-400"}>
            {failed ? "Falha" : event.status || "OK"}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatEventTime(event.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function AgentListItem({ agent, active, onEdit, onDelete }: { agent: AIAgent; active: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={`rounded-[8px] bg-[var(--app-surface-soft)] p-3 ${active ? "outline outline-1 outline-primary/70" : ""}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={onEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onEdit();
        }}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{agent.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{agent.description || typeLabel(agent.config.type)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {agent.config.isDefault && <Badge className="border-0 bg-primary/15 text-primary">Padrao</Badge>}
            <Badge variant="outline" className="border-transparent bg-background/50">
              {agent.status}
            </Badge>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{typeLabel(agent.config.type)}</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={agent.config.isDefault && agent.config.type === "triage"} onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function RuleListItem({ rule, onEdit, onDelete }: { rule: AIRoutingRule; onEdit: () => void; onDelete: () => void }) {
  const chips = conditionChips(rule.conditions);
  return (
    <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <div
        role="button"
        tabIndex={0}
        onClick={onEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onEdit();
        }}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{rule.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              #{rule.priority} {"->"} {rule.agentName || "Agente"}
            </p>
          </div>
          <Badge className={rule.isEnabled ? "border-0 bg-emerald-500/15 text-emerald-400" : "border-0 bg-muted text-muted-foreground"}>
            {rule.isEnabled ? "Ativa" : "Pausada"}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.length === 0 && <span className="text-xs text-muted-foreground">Sem condicoes: aplica para tudo.</span>}
          {chips.map((chip) => (
            <Badge key={chip} variant="outline" className="border-transparent bg-background/50">
              {chip}
            </Badge>
          ))}
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AIMetricsChart({ series }: { series: AIMetricPoint[] }) {
  const max = Math.max(1, ...series.flatMap((item) => [item.leadsReceived, item.leadsAttended, item.followUpsActive]));
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">Ainda nao ha dados da IA para este periodo.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend color="bg-primary" label="Recebidos" />
        <Legend color="bg-emerald-400" label="Atendidos" />
        <Legend color="bg-amber-300" label="Follow-up" />
      </div>
      <div className="grid h-56 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-2 overflow-hidden">
        {series.map((item) => (
          <div key={item.date} className="flex min-w-0 flex-col items-center gap-2">
            <div className="flex h-44 w-full items-end justify-center gap-1">
              <Bar value={item.leadsReceived} max={max} className="bg-primary" />
              <Bar value={item.leadsAttended} max={max} className="bg-emerald-400" />
              <Bar value={item.followUpsActive} max={max} className="bg-amber-300" />
            </div>
            <span className="truncate text-[10px] text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const height = value > 0 ? Math.max(8, Math.round((value / max) * 100)) : 3;
  return <div className={`w-full rounded-t-[4px] ${className}`} style={{ height: `${height}%`, opacity: value > 0 ? 1 : 0.18 }} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function draftFromAgent(agent: AIAgent): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || "",
    status: agent.status,
    type: agent.config.type || "custom",
    prompt: agent.config.prompt || "",
    model: agent.config.model || "gpt-4.1-mini",
    temperature: agent.config.temperature ?? 0.3,
    allowedTools: (agent.config.allowedTools || []).join(", "),
    handoffTargets: (agent.config.handoffTargets || []).join(", "),
    routingKeywords: (agent.config.routingKeywords || []).join(", "),
  };
}

function buildAgentInput(draft: AgentDraft): AIAgentInput {
  const config: AIAgentConfig = {
    ...DEFAULT_AI_AGENT_CONFIG,
    type: draft.type,
    prompt: draft.prompt,
    model: draft.model || "gpt-4.1-mini",
    temperature: Number(draft.temperature) || 0.3,
    allowedTools: parseList(draft.allowedTools),
    handoffTargets: parseList(draft.handoffTargets),
    routingKeywords: parseList(draft.routingKeywords),
    isDefault: false,
  };
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    status: draft.status,
    config,
  };
}

function draftFromRule(rule: AIRoutingRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    agentId: rule.agentId,
    priority: rule.priority,
    isEnabled: rule.isEnabled,
    action: rule.action,
    sessionId: rule.conditions.sessionIds?.[0] || "any",
    source: (rule.conditions.sources || []).join(", "),
    pipelineName: (rule.conditions.pipelineNames || []).join(", "),
    messageContains: (rule.conditions.messageContains || []).join(", "),
  };
}

function buildRuleInput(draft: RuleDraft): AIRoutingRuleInput {
  const conditions: AIRoutingConditions = {};
  if (draft.sessionId && draft.sessionId !== "any") conditions.sessionIds = [draft.sessionId];
  const sources = parseList(draft.source);
  const pipelineNames = parseList(draft.pipelineName);
  const messageContains = parseList(draft.messageContains);
  if (sources.length) conditions.sources = sources;
  if (pipelineNames.length) conditions.pipelineNames = pipelineNames;
  if (messageContains.length) conditions.messageContains = messageContains;
  return {
    agentId: draft.agentId,
    name: draft.name.trim(),
    priority: draft.priority,
    isEnabled: draft.isEnabled,
    action: draft.action,
    conditions,
  };
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function conditionChips(conditions: AIRoutingConditions) {
  const chips: string[] = [];
  if (conditions.sessionIds?.length) chips.push("Conexao especifica");
  if (conditions.sources?.length) chips.push(`Origem: ${conditions.sources.join(", ")}`);
  if (conditions.pipelineNames?.length) chips.push(`Funil: ${conditions.pipelineNames.join(", ")}`);
  if (conditions.messageContains?.length) chips.push(`Texto: ${conditions.messageContains.join(", ")}`);
  return chips;
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    "ai.agent_run": "Atendimento executado",
    "ai.routing_skipped": "Roteamento pausou atendimento",
    ai_autoreply_skipped: "Resposta automatica pulada",
    ai_autoreply_failed: "Falha ao gerar resposta",
    ai_autoreply_send_failed: "Falha ao enviar resposta",
    ai_followup_sent: "Follow-up enviado",
    ai_followup_failed: "Falha no follow-up",
  };
  return labels[type] || type.replaceAll("_", " ");
}

function payloadSummary(payload: Record<string, unknown>) {
  const parts = [
    stringPayload(payload, "reason"),
    stringPayload(payload, "error"),
    stringPayload(payload, "agentName"),
    stringPayload(payload, "template"),
    stringPayload(payload, "conversationId"),
  ].filter(Boolean);
  if (parts.length === 0) return "Evento registrado sem detalhes adicionais.";
  return parts.slice(0, 3).join(" | ");
}

function stringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function typeLabel(type: string) {
  return agentTypeOptions.find((option) => option.value === type)?.label || type || "Agente";
}
