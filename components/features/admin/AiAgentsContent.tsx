"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Play, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { adminAPI, type AdminJSON } from "@/lib/api/admin";
import {
  DEFAULT_AI_AGENT_CONFIG,
  aiAPI,
  type AIAgent,
  type AIAgentConfig,
  type AIAgentInput,
  type AIRunResponse,
} from "@/lib/api/ai";
import { cn } from "@/lib/utils";

type FormState = {
  id?: string;
  organizationId: string;
  name: string;
  description: string;
  status: "draft" | "active" | "paused";
  config: AIAgentConfig;
};

const TOOL_OPTIONS = [
  { key: "getLeadContext", label: "Contexto do lead" },
  { key: "searchProperties", label: "Buscar imoveis" },
  { key: "classifyLeadIntent", label: "Classificar perfil" },
  { key: "draftWhatsAppMessage", label: "Rascunhar WhatsApp" },
  { key: "createFollowUpTask", label: "Criar follow-up" },
];

const AGENT_TYPES = [
  { value: "triage", label: "Triagem" },
  { value: "mcmv", label: "Minha Casa Minha Vida" },
  { value: "high_value", label: "Alto padrao" },
  { value: "launch", label: "Lancamentos" },
  { value: "custom", label: "Personalizado" },
];

export function AiAgentsContent() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [testMessage, setTestMessage] = useState("Cliente quer saber de uma casa ate 320 mil e se aceita financiamento.");
  const [testLeadId, setTestLeadId] = useState("");
  const [testResult, setTestResult] = useState<AIRunResponse | null>(null);

  const agentsQuery = useQuery({
    queryKey: ["admin-ai-agents"],
    queryFn: aiAPI.listAgents,
  });

  const organizationsQuery = useQuery({
    queryKey: ["admin-organizations-for-ai"],
    queryFn: () => adminAPI.listOrganizations({}),
  });

  const agents = agentsQuery.data || [];
  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === form.id), [agents, form.id]);

  useEffect(() => {
    if (!form.id && agents.length > 0) {
      setForm(agentToForm(agents[0]));
    }
  }, [agents, form.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = formToInput(form);
      if (form.id) {
        return aiAPI.updateAgent(form.id, input);
      }
      return aiAPI.createAgent(input);
    },
    onSuccess: (agent) => {
      toast.success("Agente salvo.");
      setForm(agentToForm(agent));
      queryClient.invalidateQueries({ queryKey: ["admin-ai-agents"] });
    },
    onError: () => {
      toast.error("Nao foi possivel salvar o agente.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (agentId: string) => aiAPI.deleteAgent(agentId),
    onSuccess: () => {
      toast.success("Agente removido.");
      setForm(emptyForm());
      queryClient.invalidateQueries({ queryKey: ["admin-ai-agents"] });
    },
    onError: () => {
      toast.error("Nao foi possivel remover o agente.");
    },
  });

  const testMutation = useMutation({
    mutationFn: async () =>
      aiAPI.run({
        message: testMessage,
        agentId: form.id,
        leadId: testLeadId || undefined,
      }, form.organizationId || undefined),
    onSuccess: (result) => {
      setTestResult(result);
      toast.success(result.mode === "openai" ? "Resposta gerada pela OpenAI." : "Resposta simulada gerada.");
    },
    onError: () => {
      toast.error("Nao foi possivel testar o agente.");
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Agentes" value={agents.length} />
        <SummaryCard label="Ativos" value={agents.filter((agent) => agent.status === "active").length} />
        <SummaryCard label="Modo de teste" value={testResult?.mode === "openai" ? "OpenAI" : "Seguro"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="app-card p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Agentes</h2>
              <p className="text-xs text-muted-foreground">Prompts, ferramentas e handoffs.</p>
            </div>
            <Button size="sm" className="gap-2" onClick={() => setForm(emptyForm())}>
              <Plus className="size-4" />
              Novo
            </Button>
          </div>

          {agentsQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={cn(
                    "w-full rounded-md border border-transparent bg-[var(--app-surface-soft)] p-3 text-left transition",
                    form.id === agent.id && "border-[var(--app-primary)] bg-[var(--app-primary-soft)]",
                  )}
                  onClick={() => setForm(agentToForm(agent))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{agent.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{agent.description || agent.config.type}</p>
                    </div>
                    <Badge className={cn("border-0", statusClass(agent.status))}>{statusLabel(agent.status)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge className="border-0 bg-[var(--app-surface)] text-[10px] text-muted-foreground">{agent.config.type}</Badge>
                    <Badge className="border-0 bg-[var(--app-surface)] text-[10px] text-muted-foreground">{agent.config.model}</Badge>
                  </div>
                </button>
              ))}
              {agents.length === 0 && (
                <div className="rounded-md bg-[var(--app-surface-soft)] p-4 text-sm text-muted-foreground">
                  Nenhum agente encontrado.
                </div>
              )}
            </div>
          )}
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="app-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{form.id ? "Editar agente" : "Novo agente"}</h2>
                <p className="text-xs text-muted-foreground">O prompt e liberado, mas a seguranca fica fixa no backend.</p>
              </div>
              {form.id && (
                <Button
                  variant="ghost"
                  className="gap-2 text-red-500"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(form.id!)}
                >
                  <Trash2 className="size-4" />
                  Remover
                </Button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome">
                <Input value={form.name} onChange={(event) => setFormValue("name", event.target.value, setForm)} />
              </Field>
              <Field label="Organizacao">
                <select
                  value={form.organizationId}
                  onChange={(event) => setFormValue("organizationId", event.target.value, setForm)}
                  className="h-10 w-full rounded-md border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
                >
                  <option value="">Global</option>
                  {(organizationsQuery.data || []).map((organization: AdminJSON) => (
                    <option key={String(organization.id)} value={String(organization.id)}>
                      {String(organization.name || organization.company_name || organization.id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo">
                <select
                  value={form.config.type}
                  onChange={(event) => updateConfig(setForm, { type: event.target.value })}
                  className="h-10 w-full rounded-md border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
                >
                  {AGENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(event) => setFormValue("status", event.target.value as FormState["status"], setForm)}
                  className="h-10 w-full rounded-md border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
                >
                  <option value="draft">Rascunho</option>
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </Field>
              <Field label="Modelo">
                <Input value={form.config.model} onChange={(event) => updateConfig(setForm, { model: event.target.value })} />
              </Field>
              <Field label="Temperatura">
                <Input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={form.config.temperature}
                  onChange={(event) => updateConfig(setForm, { temperature: Number(event.target.value) })}
                />
              </Field>
            </div>

            <Field label="Descricao" className="mt-3">
              <Input value={form.description} onChange={(event) => setFormValue("description", event.target.value, setForm)} />
            </Field>

            <Field label="Prompt do agente" className="mt-3">
              <textarea
                value={form.config.prompt}
                onChange={(event) => updateConfig(setForm, { prompt: event.target.value })}
                className="min-h-[220px] w-full resize-y rounded-md border-0 bg-[var(--app-surface-soft)] p-3 text-sm outline-none"
                placeholder="Defina objetivo, abordagem, tom de voz e criterios de handoff."
              />
            </Field>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-md bg-[var(--app-surface-soft)] p-3">
                <Label className="text-xs text-muted-foreground">Ferramentas liberadas</Label>
                <div className="mt-3 space-y-2">
                  {TOOL_OPTIONS.map((tool) => (
                    <label key={tool.key} className="flex items-center justify-between gap-3 text-sm">
                      <span>{tool.label}</span>
                      <Switch
                        checked={form.config.allowedTools.includes(tool.key)}
                        onCheckedChange={(checked) => toggleListValue(setForm, "allowedTools", tool.key, checked)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-md bg-[var(--app-surface-soft)] p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Agente padrao</span>
                  <Switch checked={form.config.isDefault} onCheckedChange={(checked) => updateConfig(setForm, { isDefault: checked })} />
                </label>
                <Field label="Handoffs permitidos">
                  <Input
                    value={form.config.handoffTargets.join(", ")}
                    onChange={(event) => updateConfig(setForm, { handoffTargets: csvToList(event.target.value) })}
                    placeholder="mcmv, high_value, launch"
                  />
                </Field>
                <Field label="Palavras de roteamento">
                  <Input
                    value={form.config.routingKeywords.join(", ")}
                    onChange={(event) => updateConfig(setForm, { routingKeywords: csvToList(event.target.value) })}
                    placeholder="financiamento, luxo, lancamento"
                  />
                </Field>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button className="gap-2" disabled={saveMutation.isPending || !form.name.trim()} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Salvar agente
              </Button>
            </div>
          </div>

          <div className="app-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-md bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
                <Bot className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Teste rapido</h2>
                <p className="text-xs text-muted-foreground">Usa OpenAI quando a chave existir.</p>
              </div>
            </div>

            <Field label="Lead ID opcional">
              <Input value={testLeadId} onChange={(event) => setTestLeadId(event.target.value)} placeholder="UUID do lead" />
            </Field>
            <Field label="Mensagem" className="mt-3">
              <textarea
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                className="min-h-[150px] w-full resize-y rounded-md border-0 bg-[var(--app-surface-soft)] p-3 text-sm outline-none"
              />
            </Field>
            <Button
              className="mt-3 w-full gap-2"
              disabled={testMutation.isPending || !testMessage.trim()}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Testar agente
            </Button>

            {testResult && (
              <div className="mt-4 space-y-3">
                <div className="rounded-md bg-[var(--app-surface-soft)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{testResult.agent.name}</span>
                    <Badge className="border-0 bg-[var(--app-surface)] text-xs text-muted-foreground">{testResult.mode}</Badge>
                  </div>
                  {testResult.handoff && (
                    <p className="mb-2 text-xs text-[var(--app-primary)]">
                      Handoff: {testResult.handoff.fromAgent.type} {"->"} {testResult.handoff.toAgent.type}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{testResult.output}</p>
                </div>
                {testResult.requiresApproval?.length ? (
                  <div className="rounded-md bg-[var(--app-surface-soft)] p-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">Acoes que exigem aprovacao</p>
                    <div className="space-y-2">
                      {testResult.requiresApproval.map((action) => (
                        <div key={action.type} className="rounded-md bg-[var(--app-surface)] p-2 text-xs">
                          <p className="font-semibold">{action.label}</p>
                          <p className="text-muted-foreground">{action.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="app-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function emptyForm(): FormState {
  return {
    organizationId: "",
    name: "",
    description: "",
    status: "draft",
    config: {
      ...DEFAULT_AI_AGENT_CONFIG,
      prompt: "Defina aqui a personalidade, objetivo, abordagem e criterios deste agente.",
      allowedTools: [...DEFAULT_AI_AGENT_CONFIG.allowedTools],
      handoffTargets: [...DEFAULT_AI_AGENT_CONFIG.handoffTargets],
      routingKeywords: [],
    },
  };
}

function agentToForm(agent: AIAgent): FormState {
  return {
    id: agent.id,
    organizationId: agent.organizationId || "",
    name: agent.name,
    description: agent.description || "",
    status: agent.status,
    config: {
      ...DEFAULT_AI_AGENT_CONFIG,
      ...agent.config,
      allowedTools: [...(agent.config.allowedTools || [])],
      handoffTargets: [...(agent.config.handoffTargets || [])],
      routingKeywords: [...(agent.config.routingKeywords || [])],
    },
  };
}

function formToInput(form: FormState): AIAgentInput {
  return {
    organizationId: form.organizationId || undefined,
    name: form.name,
    description: form.description,
    status: form.status,
    config: form.config,
  };
}

function setFormValue<K extends keyof FormState>(key: K, value: FormState[K], setForm: Dispatch<SetStateAction<FormState>>) {
  setForm((current) => ({ ...current, [key]: value }));
}

function updateConfig(setForm: Dispatch<SetStateAction<FormState>>, patch: Partial<AIAgentConfig>) {
  setForm((current) => ({ ...current, config: { ...current.config, ...patch } }));
}

function toggleListValue(
  setForm: Dispatch<SetStateAction<FormState>>,
  key: "allowedTools" | "handoffTargets" | "routingKeywords",
  value: string,
  checked: boolean,
) {
  setForm((current) => {
    const values = new Set(current.config[key]);
    if (checked) {
      values.add(value);
    } else {
      values.delete(value);
    }
    return { ...current, config: { ...current.config, [key]: Array.from(values) } };
  });
}

function csvToList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusLabel(status: AIAgent["status"]) {
  if (status === "active") return "Ativo";
  if (status === "paused") return "Pausado";
  return "Rascunho";
}

function statusClass(status: AIAgent["status"]) {
  if (status === "active") return "bg-emerald-500/15 text-emerald-500";
  if (status === "paused") return "bg-amber-500/15 text-amber-500";
  return "bg-[var(--app-surface)] text-muted-foreground";
}
