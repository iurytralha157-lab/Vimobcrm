'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Archive,
  BellRing,
  ChevronDown,
  Clock3,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Shuffle,
  Power,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { usePipelines, useStages } from '@/hooks/use-stages'
import {
  useAttentionPolicies,
  useAttentionSettings,
  useCreateAttentionPolicy,
  useUpdateAttentionPolicy,
  useUpdateAttentionSettings,
} from '@/hooks/attention'
import type {
  AttentionEngineMode,
  AttentionPolicy,
  AttentionPolicyStatus,
  AttentionPolicyType,
  AttentionSettings,
  CreateAttentionPolicyInput,
} from '@/lib/api/attention'
import { cn } from '@/lib/utils'

const POLICY_TYPE_LABELS: Record<AttentionPolicyType, string> = {
  unassigned: 'Lead sem responsavel',
  first_contact: 'Primeiro contato',
  first_effective_contact: 'Contato efetivo',
  stage_inactivity: 'Inatividade na etapa',
  stage_age: 'Tempo maximo na etapa',
  cadence_task: 'Tarefa de cadencia',
}

const POLICY_TYPE_DESCRIPTIONS: Record<AttentionPolicyType, string> = {
  unassigned: 'Cobra atribuicao quando um lead permanece sem corretor.',
  first_contact: 'Mede o primeiro contato humano em cada ciclo de atribuicao.',
  first_effective_contact: 'Mede quando o lead responde ou atende em cada ciclo de atribuicao.',
  stage_inactivity: 'Reinicia o relogio somente quando ocorre uma acao valida.',
  stage_age: 'Limita o tempo total do lead na etapa, mesmo quando ha atividades.',
  cadence_task: 'Lembra o corretor quando uma tarefa materializada da cadencia vence.',
}

const POLICY_STATUS_LABELS: Record<AttentionPolicyStatus, string> = {
  shadow: 'Observacao',
  enabled: 'Ativa',
  paused: 'Pausada',
  archived: 'Arquivada',
}

const PIPELINE_POLICY_TYPES: AttentionPolicyType[] = [
  'unassigned',
  'first_contact',
  'first_effective_contact',
  'cadence_task',
]

function formatPolicyDuration(minutes: number) {
  if (minutes % 10_080 === 0) return `${minutes / 10_080} sem`
  if (minutes % 1_440 === 0) return `${minutes / 1_440} d`
  if (minutes % 60 === 0) return `${minutes / 60} h`
  return `${minutes} min`
}

type PolicyDraft = {
  name: string
  status: Exclude<AttentionPolicyStatus, 'archived'>
  warningMinutes: string
  thresholdMinutes: string
  repeatMinutes: string
  escalationMinutes: string
  redistributionEnabled: boolean
  redistributionMinutes: string
  businessHoursOnly: boolean
}

function policyToDraft(policy: AttentionPolicy): PolicyDraft {
  return {
    name: policy.name,
    status: policy.status === 'archived' ? 'paused' : policy.status,
    warningMinutes: String(policy.warningMinutes),
    thresholdMinutes: String(policy.thresholdMinutes),
    repeatMinutes: String(policy.repeatMinutes ?? 1_440),
    escalationMinutes: policy.escalationMinutes == null ? '' : String(policy.escalationMinutes),
    redistributionEnabled: policy.redistributionMinutes != null,
    redistributionMinutes: String(policy.redistributionMinutes ?? Math.max(policy.thresholdMinutes + 60, 120)),
    businessHoursOnly: policy.businessHoursOnly,
  }
}

function parseMinutes(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function PolicyCard({ policy }: { policy: AttentionPolicy }) {
  const [draft, setDraft] = useState<PolicyDraft>(() => policyToDraft(policy))
  const [open, setOpen] = useState(false)
  const updatePolicy = useUpdateAttentionPolicy()
  const isArchived = policy.status === 'archived'
  const warningMinutes = parseMinutes(draft.warningMinutes, 0)
  const thresholdMinutes = parseMinutes(draft.thresholdMinutes, 1)
  const isInvalid = warningMinutes >= thresholdMinutes || thresholdMinutes < 1
  const initialDraft = policyToDraft(policy)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft)

  const setField = <K extends keyof PolicyDraft>(field: K, value: PolicyDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const handleSave = () => {
    updatePolicy.mutate({
      id: policy.id,
      input: {
        name: draft.name,
        status: draft.status,
        warningMinutes,
        thresholdMinutes,
        repeatMinutes: Math.max(15, parseMinutes(draft.repeatMinutes, 1_440)),
        escalationMinutes: draft.escalationMinutes
          ? Math.max(1, parseMinutes(draft.escalationMinutes, 1_440))
          : null,
        redistributionMinutes: draft.redistributionEnabled
          ? Math.max(1, parseMinutes(draft.redistributionMinutes, thresholdMinutes + 60))
          : null,
        businessHoursOnly: draft.businessHoursOnly,
        redistributeBeforeContactOnly: policy.policyType === 'first_contact'
          ? (policy.redistributeBeforeContactOnly ?? true)
          : (policy.redistributeBeforeContactOnly ?? false),
      },
    })
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]"
      data-testid="attention-policy"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[6px] p-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:p-3"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary sm:h-10 sm:w-10">
            {isArchived ? <Archive className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="truncate text-[13px] font-normal text-[var(--app-text-primary)] sm:text-sm">
                {policy.name}
              </span>
              <span className="inline-flex h-5 items-center gap-1.5 rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    policy.status === 'enabled'
                      ? 'bg-primary'
                      : policy.status === 'shadow'
                        ? 'bg-amber-400'
                        : 'bg-[var(--app-text-tertiary)]',
                  )}
                />
                {POLICY_STATUS_LABELS[policy.status]}
              </span>
              <span className="text-[9px] font-light text-[var(--app-text-tertiary)]">v{policy.version}</span>
            </span>
            <span className="mt-0.5 block truncate text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              {POLICY_TYPE_LABELS[policy.policyType]}
              {policy.pipelineName ? ` · ${policy.pipelineName}` : ''}
              {policy.stageName ? ` · ${policy.stageName}` : ''}
            </span>
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </span>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-5 border-t border-border/30 px-3 pb-4 pt-3 sm:px-4 sm:pb-5 sm:pt-4">
          <p className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
            {POLICY_TYPE_DESCRIPTIONS[policy.policyType]}
          </p>

          {isArchived ? (
            <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              Esta versão foi arquivada e permanece disponível apenas para auditoria dos ciclos históricos.
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2 md:col-span-2 xl:col-span-1">
                  <Label htmlFor={`policy-name-${policy.id}`}>Nome da regra</Label>
                  <Input
                    id={`policy-name-${policy.id}`}
                    value={draft.name}
                    onChange={(event) => setField('name', event.target.value)}
                    className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Modo</Label>
                  <Select value={draft.status} onValueChange={(value) => setField('status', value as PolicyDraft['status'])}>
                    <SelectTrigger className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shadow">Observação, sem cobrar</SelectItem>
                      <SelectItem value="enabled">Ativa</SelectItem>
                      <SelectItem value="paused">Pausada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <MinutesField id={`warning-${policy.id}`} label="Avisar antes do limite" value={draft.warningMinutes} min={0} onChange={(value) => setField('warningMinutes', value)} />
                <MinutesField id={`threshold-${policy.id}`} label="Limite para violação" value={draft.thresholdMinutes} min={1} onChange={(value) => setField('thresholdMinutes', value)} />
                <MinutesField id={`repeat-${policy.id}`} label="Repetir lembrete a cada" value={draft.repeatMinutes} min={15} onChange={(value) => setField('repeatMinutes', value)} />
                <MinutesField id={`escalation-${policy.id}`} label="Escalar para líder/admin em" value={draft.escalationMinutes} min={1} optional onChange={(value) => setField('escalationMinutes', value)} />
              </div>

              {isInvalid && (
                <p className="text-[12px] font-light text-destructive">O aviso precisa acontecer antes do limite da regra.</p>
              )}

              <div className="grid gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-2 md:grid-cols-2">
                <ToggleRow
                  icon={Clock3}
                  title="Contar somente horário comercial"
                  description="Pausa o relógio fora da jornada configurada para a organização."
                  checked={draft.businessHoursOnly}
                  onCheckedChange={(value) => setField('businessHoursOnly', value)}
                />
                <ToggleRow
                  icon={Shuffle}
                  title="Redistribuição por tempo"
                  description="Também depende da chave global de segurança."
                  checked={draft.redistributionEnabled}
                  onCheckedChange={(value) => setField('redistributionEnabled', value)}
                />
                {draft.redistributionEnabled && (
                  <div className="space-y-2 px-2 pb-2 md:col-start-2">
                    <MinutesField id={`redistribution-${policy.id}`} label="Redistribuir depois de" value={draft.redistributionMinutes} min={1} onChange={(value) => setField('redistributionMinutes', value)} />
                    {policy.policyType === 'first_contact' && (
                      <p className="text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
                        Redistribui somente se ainda não houve primeiro contato humano neste ciclo.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 pt-4">
                <p className="max-w-2xl text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
                  Ao salvar, uma nova versão é criada. Ciclos em andamento mantêm a versão anterior.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" className="rounded-[6px] text-xs font-light" onClick={() => setDraft(initialDraft)} disabled={updatePolicy.isPending || !isDirty}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Desfazer
                  </Button>
                  <Button className="rounded-[6px] text-xs font-light" onClick={handleSave} disabled={updatePolicy.isPending || isInvalid || draft.name.trim().length < 2 || !isDirty}>
                    {updatePolicy.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                    Salvar nova versão
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function MinutesField({
  id,
  label,
  value,
  min,
  optional = false,
  onChange,
}: {
  id: string
  label: string
  value: string
  min: number
  optional?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[12px] font-light text-[var(--app-text-secondary)]">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          step={15}
          placeholder={optional ? 'Sem escalonamento' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] pr-16 text-xs font-light shadow-none"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-light text-[var(--app-text-tertiary)]">min</span>
      </div>
    </div>
  )
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  icon: typeof Clock3
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[6px] p-2">
      <div className="flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-[13px] font-normal text-[var(--app-text-primary)]">{title}</p>
          <p className="mt-0.5 text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function CreatePolicyDialog({
  open,
  onOpenChange,
  lockedPipelineId,
  lockedPipelineName,
  availablePolicyTypes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lockedPipelineId?: string
  lockedPipelineName?: string
  availablePolicyTypes: AttentionPolicyType[]
}) {
  const [name, setName] = useState('')
  const [policyType, setPolicyType] = useState<AttentionPolicyType>(availablePolicyTypes[0] ?? 'first_contact')
  const [pipelineId, setPipelineId] = useState(lockedPipelineId ?? '')
  const [stageId, setStageId] = useState('')
  const [warningMinutes, setWarningMinutes] = useState('30')
  const [thresholdMinutes, setThresholdMinutes] = useState('60')
  const [repeatMinutes, setRepeatMinutes] = useState('1440')
  const [escalationMinutes, setEscalationMinutes] = useState('1440')
  const [redistributionEnabled, setRedistributionEnabled] = useState(false)
  const [redistributionMinutes, setRedistributionMinutes] = useState('2880')
  const [businessHoursOnly, setBusinessHoursOnly] = useState(false)
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines()
  const { data: stages = [], isLoading: stagesLoading } = useStages(pipelineId || undefined)
  const createPolicy = useCreateAttentionPolicy()
  const requiresStage = policyType === 'stage_inactivity' || policyType === 'stage_age'
  const parsedWarning = parseMinutes(warningMinutes, 0)
  const parsedThreshold = parseMinutes(thresholdMinutes, 1)
  const canSubmit = name.trim().length >= 2
    && availablePolicyTypes.includes(policyType)
    && parsedThreshold >= 1
    && parsedWarning < parsedThreshold
    && (!requiresStage || Boolean(pipelineId && stageId))

  const reset = () => {
    setName('')
    setPolicyType(availablePolicyTypes[0] ?? 'first_contact')
    setPipelineId(lockedPipelineId ?? '')
    setStageId('')
    setWarningMinutes('30')
    setThresholdMinutes('60')
    setRepeatMinutes('1440')
    setEscalationMinutes('1440')
    setRedistributionEnabled(false)
    setRedistributionMinutes('2880')
    setBusinessHoursOnly(false)
  }

  const handleCreate = () => {
    const input: CreateAttentionPolicyInput = {
      name: name.trim(),
      policyType,
      status: 'shadow',
      pipelineId: pipelineId || null,
      stageId: stageId || null,
      warningMinutes: parsedWarning,
      thresholdMinutes: parsedThreshold,
      repeatMinutes: Math.max(15, parseMinutes(repeatMinutes, 1_440)),
      escalationMinutes: escalationMinutes ? Math.max(1, parseMinutes(escalationMinutes, 1_440)) : null,
      redistributionMinutes: redistributionEnabled
        ? Math.max(1, parseMinutes(redistributionMinutes, parsedThreshold + 60))
        : null,
      businessHoursOnly,
      redistributeBeforeContactOnly: policyType === 'first_contact',
    }

    createPolicy.mutate(input, {
      onSuccess: () => {
        onOpenChange(false)
        reset()
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-[8px] border-0 shadow-none">
        <DialogHeader>
          <DialogTitle className="text-base font-normal">Nova regra de atenção</DialogTitle>
          <DialogDescription className="text-[12px] font-light leading-5">
            A regra nasce em observação para você validar os prazos antes de ativar cobranças ou redistribuição.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="attention-policy-name">Nome da regra</Label>
            <Input
              id="attention-policy-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Primeiro contato em ate 1 hora"
            />
          </div>
          <div className="space-y-2">
            <Label>Relogio monitorado</Label>
            <Select
              value={policyType}
              onValueChange={(value) => {
                setPolicyType(value as AttentionPolicyType)
                setStageId('')
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availablePolicyTypes.map((type) => (
                  <SelectItem key={type} value={type}>{POLICY_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Pipeline {requiresStage ? '(obrigatória)' : '(opcional)'}</Label>
            {lockedPipelineId ? (
              <div className="flex h-10 items-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-xs font-light text-[var(--app-text-secondary)]">
                {lockedPipelineName || 'Pipeline selecionada'}
              </div>
            ) : (
              <Select
                value={pipelineId || 'all'}
                onValueChange={(value) => {
                  setPipelineId(value === 'all' ? '' : value)
                  setStageId('')
                }}
                disabled={pipelinesLoading}
              >
                <SelectTrigger><SelectValue placeholder="Todas as pipelines" /></SelectTrigger>
                <SelectContent>
                  {!requiresStage && <SelectItem value="all">Todas as pipelines</SelectItem>}
                  {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          {requiresStage && (
            <div className="space-y-2 md:col-span-2">
              <Label>Etapa</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={!pipelineId || stagesLoading}>
                <SelectTrigger><SelectValue placeholder={pipelineId ? 'Selecione a etapa' : 'Escolha a pipeline primeiro'} /></SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <MinutesField id="new-warning" label="Avisar antes do limite" value={warningMinutes} min={0} onChange={setWarningMinutes} />
          <MinutesField id="new-threshold" label="Limite para violacao" value={thresholdMinutes} min={1} onChange={setThresholdMinutes} />
          <MinutesField id="new-repeat" label="Repetir lembrete a cada" value={repeatMinutes} min={15} onChange={setRepeatMinutes} />
          <MinutesField id="new-escalation" label="Escalar para lider/admin em" value={escalationMinutes} min={1} optional onChange={setEscalationMinutes} />
        </div>

        <div className="space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-2">
          <ToggleRow
            icon={Clock3}
            title="Somente horário comercial"
            description="Usa o calendário e o fuso da organização."
            checked={businessHoursOnly}
            onCheckedChange={setBusinessHoursOnly}
          />
          <ToggleRow
            icon={Shuffle}
            title="Permitir redistribuicao"
            description="Continua bloqueada se a chave global de segurança estiver desligada."
            checked={redistributionEnabled}
            onCheckedChange={setRedistributionEnabled}
          />
          {redistributionEnabled && (
            <MinutesField
              id="new-redistribution"
              label="Redistribuir depois de"
              value={redistributionMinutes}
              min={1}
              onChange={setRedistributionMinutes}
            />
          )}
        </div>

        {parsedWarning >= parsedThreshold && (
          <p className="text-[12px] font-light text-destructive">O aviso deve acontecer antes do limite, nunca no mesmo instante.</p>
        )}

        <DialogFooter>
          <Button variant="ghost" className="rounded-[6px] text-xs font-light" onClick={() => onOpenChange(false)} disabled={createPolicy.isPending}>Cancelar</Button>
          <Button className="rounded-[6px] text-xs font-light" onClick={handleCreate} disabled={!canSubmit || createPolicy.isPending}>
            {createPolicy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Criar em observação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type GlobalSettingsDraft = {
  engineMode: AttentionEngineMode
  notificationsEnabled: boolean
  redistributionEnabled: boolean
  timezone: string
  defaultRepeatMinutes: string
  maxReminders: string
}

function GlobalSafetyCard({ settings }: { settings: AttentionSettings }) {
  const initialDraft: GlobalSettingsDraft = {
    engineMode: settings.engineMode,
    notificationsEnabled: settings.notificationsEnabled,
    redistributionEnabled: settings.redistributionEnabled,
    timezone: settings.timezone,
    defaultRepeatMinutes: String(settings.defaultRepeatMinutes ?? 1_440),
    maxReminders: String(settings.maxReminders ?? 0),
  }
  const [draft, setDraft] = useState<GlobalSettingsDraft>(() => initialDraft)
  const [redistributionConfirmOpen, setRedistributionConfirmOpen] = useState(false)
  const updateSettings = useUpdateAttentionSettings()
  const parsedRepeatMinutes = parseMinutes(draft.defaultRepeatMinutes, 0)
  const parsedMaxReminders = parseMinutes(draft.maxReminders, -1)
  const isInvalid = draft.timezone.trim().length === 0
    || parsedRepeatMinutes < 15
    || parsedMaxReminders < 0
  const isEnabled = draft.engineMode === 'enabled'
  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft)

  const setField = <K extends keyof GlobalSettingsDraft>(field: K, value: GlobalSettingsDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const handleRedistributionChange = (checked: boolean) => {
    if (!checked) {
      setField('redistributionEnabled', false)
      return
    }
    setRedistributionConfirmOpen(true)
  }

  const handleSave = () => {
    updateSettings.mutate({
      engineMode: draft.engineMode,
      notificationsEnabled: draft.notificationsEnabled,
      redistributionEnabled: draft.redistributionEnabled,
      timezone: draft.timezone.trim(),
      defaultRepeatMinutes: parsedRepeatMinutes,
      maxReminders: parsedMaxReminders,
    })
  }

  return (
    <>
      <Card className="app-card overflow-hidden border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="gap-3 p-4 pb-3 sm:p-5 sm:pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Power className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-[14px] font-normal text-[var(--app-text-primary)]">
                  Segurança da organização
                </CardTitle>
                <CardDescription className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                  Define como todos os pipelines monitoram prazos, enviam avisos e permitem redistribuições.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-[4px] text-[10px] font-light">
                Motor {draft.engineMode === 'disabled' ? 'desligado' : draft.engineMode === 'shadow' ? 'em observação' : 'ativo'}
              </Badge>
              <Badge variant="secondary" className="rounded-[4px] text-[10px] font-light">
                Redistribuição {draft.redistributionEnabled ? 'liberada' : 'bloqueada'}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 p-4 pt-0 sm:p-5 sm:pt-0">
          <Alert className="rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
            {isEnabled ? <AlertTriangle className="h-4 w-4 text-[var(--app-text-secondary)]" /> : <ShieldCheck className="h-4 w-4 text-[var(--app-text-secondary)]" />}
            <AlertTitle className="text-[13px] font-normal text-[var(--app-text-primary)]">
              {isEnabled ? 'Motor em modo ativo' : 'Configuração protegida'}
            </AlertTitle>
            <AlertDescription className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
              {isEnabled
                ? 'Políticas ativas passam a gerar cobranças. Instâncias abertas anteriores à ativação permanecem em observação para evitar cobrança retroativa imediata.'
                : 'Use o modo observação para medir prazos sem cobrar corretores. O modo desligado interrompe a avaliação global.'}
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label>Modo do motor</Label>
              <Select value={draft.engineMode} onValueChange={(value) => setField('engineMode', value as AttentionEngineMode)}>
                <SelectTrigger className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Desligado</SelectItem>
                  <SelectItem value="shadow">Observacao, sem cobranca</SelectItem>
                  <SelectItem value="enabled">Ativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="attention-timezone">Fuso horário</Label>
              <Input
                id="attention-timezone"
                value={draft.timezone}
                onChange={(event) => setField('timezone', event.target.value)}
                placeholder="America/Sao_Paulo"
                className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none"
              />
            </div>
            <MinutesField
              id="attention-default-repeat"
              label="Repeticao padrao"
              value={draft.defaultRepeatMinutes}
              min={15}
              onChange={(value) => setField('defaultRepeatMinutes', value)}
            />
            <div className="space-y-2">
              <Label htmlFor="attention-max-reminders">Maximo de lembretes</Label>
              <Input
                id="attention-max-reminders"
                type="number"
                min={0}
                step={1}
                value={draft.maxReminders}
                onChange={(event) => setField('maxReminders', event.target.value)}
                className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light shadow-none"
              />
              <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">Use 0 para lembretes ilimitados até a resolução.</p>
            </div>
          </div>

          <div className="grid gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-2 md:grid-cols-2">
            <ToggleRow
              icon={BellRing}
              title="Notificações habilitadas"
              description="Permite avisos ao corretor, lideranca e administradores quando o motor e a politica estiverem ativos."
              checked={draft.notificationsEnabled}
              onCheckedChange={(checked) => setField('notificationsEnabled', checked)}
            />
            <ToggleRow
              icon={Shuffle}
              title="Redistribuição automática"
              description="Mesmo ligada, cada política ainda precisa autorizar a redistribuição."
              checked={draft.redistributionEnabled}
              onCheckedChange={handleRedistributionChange}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 pt-4">
            <p className="max-w-2xl text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
              Desligar a redistribuição bloqueia novas trocas por SLA sem alterar a atribuição atual dos leads.
            </p>
            <Button className="rounded-[6px] text-xs font-light" onClick={handleSave} disabled={isInvalid || updateSettings.isPending || !isDirty}>
              {updateSettings.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              Salvar configuração
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={redistributionConfirmOpen} onOpenChange={setRedistributionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar redistribuição automática por tempo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta é a trava global da organização. Quando o motor e uma política também estiverem ativos, leads poderão trocar de corretor após o prazo configurado. Instâncias abertas anteriores à ativação permanecem protegidas em observação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter bloqueada</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setField('redistributionEnabled', true)
                setRedistributionConfirmOpen(false)
              }}
              className="rounded-[6px] bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Entendi, liberar no rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function InheritedPolicyRow({ policy }: { policy: AttentionPolicy }) {
  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[6px] px-2.5 py-2.5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground sm:h-10 sm:w-10">
        <Clock3 className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-normal text-[var(--app-text-primary)] sm:text-sm">
            {policy.name}
          </span>
          <span className="inline-flex h-5 items-center gap-1.5 rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                policy.status === 'enabled'
                  ? 'bg-primary'
                  : policy.status === 'shadow'
                    ? 'bg-amber-400'
                    : 'bg-[var(--app-text-tertiary)]',
              )}
            />
            {POLICY_STATUS_LABELS[policy.status]}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
          {POLICY_TYPE_LABELS[policy.policyType]} · limite de {formatPolicyDuration(policy.thresholdMinutes)}
        </span>
      </span>
      <span className="rounded-[4px] bg-[var(--app-surface-soft)] px-2 py-1 text-[9px] font-light text-[var(--app-text-tertiary)]">
        Organização
      </span>
    </div>
  )
}

type AttentionPolicySettingsProps = {
  pipelineId?: string
  pipelineName?: string
}

export function AttentionPolicySettings({
  pipelineId,
  pipelineName,
}: AttentionPolicySettingsProps = {}) {
  const [createOpen, setCreateOpen] = useState(false)
  const { data: policies = [], isLoading, isError, refetch } = useAttentionPolicies()
  const settingsQuery = useAttentionSettings()
  const isPipelineContext = Boolean(pipelineId)
  const scopedPolicies = isPipelineContext
    ? policies.filter((policy) => policy.pipelineId === pipelineId && !policy.stageId)
    : policies
  const currentScopePolicyTypes = new Set(
    (isPipelineContext
      ? scopedPolicies
      : policies.filter((policy) => !policy.pipelineId && !policy.stageId)
    )
      .filter((policy) => policy.status !== 'archived')
      .map((policy) => policy.policyType),
  )
  const allowedPolicyTypes = isPipelineContext
    ? PIPELINE_POLICY_TYPES
    : (Object.keys(POLICY_TYPE_LABELS) as AttentionPolicyType[])
  const availablePolicyTypes = allowedPolicyTypes.filter((type) => !currentScopePolicyTypes.has(type))
  const inheritedPolicies = isPipelineContext
    ? policies.filter((policy) => (
      !policy.pipelineId
      && !policy.stageId
      && policy.status !== 'archived'
      && PIPELINE_POLICY_TYPES.includes(policy.policyType)
      && !currentScopePolicyTypes.has(policy.policyType)
    ))
    : []

  return (
    <div className="space-y-3 pb-1">
      {settingsQuery.isLoading ? (
        <Skeleton className="h-72 rounded-[8px]" />
      ) : settingsQuery.isError || !settingsQuery.data ? (
        <Alert className="rounded-[8px] border-0 bg-[var(--app-surface-solid)]">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-[13px] font-normal">Segurança global indisponível</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap items-center gap-3 text-[12px] font-light">
            <span>Não foi possível confirmar o modo do motor. Nenhuma alteração deve ser ativada sem esta leitura.</span>
            <Button variant="ghost" size="sm" className="rounded-[6px] text-xs font-light" onClick={() => settingsQuery.refetch()}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <GlobalSafetyCard
          key={[
            settingsQuery.data.engineMode,
            settingsQuery.data.notificationsEnabled,
            settingsQuery.data.redistributionEnabled,
            settingsQuery.data.timezone,
            settingsQuery.data.defaultRepeatMinutes,
            settingsQuery.data.maxReminders,
          ].join(':')}
          settings={settingsQuery.data}
        />
      )}

      <Alert className="rounded-[8px] border-0 bg-[var(--app-surface-solid)]">
        <ShieldCheck className="h-4 w-4 text-[var(--app-text-secondary)]" />
        <AlertTitle className="text-[13px] font-normal text-[var(--app-text-primary)]">Segurança em camadas</AlertTitle>
        <AlertDescription className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
          {isPipelineContext
            ? 'A organização define a trava geral, o pipeline personaliza os prazos e cada coluna pode criar uma exceção local. A regra mais específica sempre prevalece.'
            : 'Uma regra ativa pode gerar cobranças. A redistribuição só acontece quando a regra e a configuração global permitem. Comece em observação e ative depois de validar os prazos.'}
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">
            {isPipelineContext ? `Regras de ${pipelineName || 'pipeline'}` : 'Políticas de cadência e SLA'}
          </h2>
          <p className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
            {isPipelineContext
              ? 'Personalize contato, atribuição e cadências deste pipeline. Regras de permanência continuam dentro de cada coluna.'
              : 'Configure cada relógio sem alterar ciclos que já estão em andamento.'}
          </p>
        </div>
        {availablePolicyTypes.length > 0 ? (
          <Button className="rounded-[6px] text-xs font-light" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Nova regra
          </Button>
        ) : null}
      </div>

      {inheritedPolicies.length > 0 ? (
        <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-1.5 sm:p-2">
          <div className="px-2 pb-1.5 pt-1 sm:px-3">
            <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
              Herdadas da organização
            </p>
          </div>
          <div className="divide-y divide-border/30">
            {inheritedPolicies.map((policy) => (
              <InheritedPolicyRow key={`${policy.id}:${policy.updatedAt}`} policy={policy} />
            ))}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-[8px]" />)}
        </div>
      ) : isError ? (
        <Card className="app-card border-0 shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]"><AlertTriangle className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-normal">Não foi possível carregar as regras.</p>
              <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">Tente novamente. As outras configurações continuam disponíveis.</p>
            </div>
            <Button variant="ghost" className="rounded-[6px] text-xs font-light" onClick={() => refetch()}>Tentar novamente</Button>
          </CardContent>
        </Card>
      ) : scopedPolicies.length === 0 ? (
        <Card className="app-card border-0 shadow-none">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]"><Clock3 className="h-4 w-4" /></span>
            <div className="max-w-xl">
              <h3 className="text-sm font-normal">
                {isPipelineContext ? 'Nenhuma regra específica neste pipeline' : 'Nenhuma regra configurada'}
              </h3>
              <p className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                {isPipelineContext
                  ? 'Enquanto não houver uma personalização, este pipeline continua usando as regras da organização e as exceções configuradas em cada coluna.'
                  : 'Crie uma regra de contato ou de etapa em observação para validar o comportamento com dados reais.'}
              </p>
            </div>
            {availablePolicyTypes.length > 0 ? (
              <Button className="rounded-[6px] text-xs font-light" onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-3.5 w-3.5" />Criar regra do pipeline</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {scopedPolicies.map((policy) => (
            <PolicyCard key={`${policy.id}:${policy.updatedAt}`} policy={policy} />
          ))}
        </div>
      )}

      <CreatePolicyDialog
        key={[pipelineId || 'organization', ...availablePolicyTypes].join(':')}
        open={createOpen}
        onOpenChange={setCreateOpen}
        lockedPipelineId={pipelineId}
        lockedPipelineName={pipelineName}
        availablePolicyTypes={availablePolicyTypes}
      />
    </div>
  )
}
