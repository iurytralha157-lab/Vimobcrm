'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Archive,
  BellRing,
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
  stage_inactivity: 'Inatividade na etapa',
  stage_age: 'Tempo maximo na etapa',
}

const POLICY_TYPE_DESCRIPTIONS: Record<AttentionPolicyType, string> = {
  unassigned: 'Cobra atribuicao quando um lead permanece sem corretor.',
  first_contact: 'Mede o primeiro contato humano em cada ciclo de atribuicao.',
  stage_inactivity: 'Reinicia o relogio somente quando ocorre uma acao valida.',
  stage_age: 'Limita o tempo total do lead na etapa, mesmo quando ha atividades.',
}

const POLICY_STATUS_LABELS: Record<AttentionPolicyStatus, string> = {
  shadow: 'Observacao',
  enabled: 'Ativa',
  paused: 'Pausada',
  archived: 'Arquivada',
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
  const updatePolicy = useUpdateAttentionPolicy()
  const isArchived = policy.status === 'archived'
  const warningMinutes = parseMinutes(draft.warningMinutes, 0)
  const thresholdMinutes = parseMinutes(draft.thresholdMinutes, 1)
  const isInvalid = warningMinutes >= thresholdMinutes || thresholdMinutes < 1

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
        config: {
          ...(policy.config || {}),
          redistributionBeforeFirstContactOnly: policy.policyType === 'first_contact'
            ? true
            : policy.config?.redistributionBeforeFirstContactOnly === true,
        },
      },
    })
  }

  return (
    <Card className="app-card overflow-hidden">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="truncate">{policy.name}</span>
              <Badge variant={policy.status === 'enabled' ? 'default' : 'secondary'}>
                {POLICY_STATUS_LABELS[policy.status]}
              </Badge>
              <Badge variant="outline">v{policy.version}</Badge>
            </CardTitle>
            <CardDescription>
              {POLICY_TYPE_LABELS[policy.policyType]}
              {policy.stageName ? ` · ${policy.stageName}` : ''}
              {policy.pipelineName ? ` · ${policy.pipelineName}` : ''}
            </CardDescription>
          </div>
          {isArchived && <Archive className="h-5 w-5 text-muted-foreground" />}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {POLICY_TYPE_DESCRIPTIONS[policy.policyType]}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {isArchived ? (
          <div className="rounded-lg bg-white/[0.04] p-4 text-sm text-muted-foreground">
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
                />
              </div>
              <div className="space-y-2">
                <Label>Modo</Label>
                <Select value={draft.status} onValueChange={(value) => setField('status', value as PolicyDraft['status'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shadow">Observacao, sem cobrar</SelectItem>
                    <SelectItem value="enabled">Ativa</SelectItem>
                    <SelectItem value="paused">Pausada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <MinutesField
                id={`warning-${policy.id}`}
                label="Avisar antes do limite"
                value={draft.warningMinutes}
                min={0}
                onChange={(value) => setField('warningMinutes', value)}
              />
              <MinutesField
                id={`threshold-${policy.id}`}
                label="Limite para violacao"
                value={draft.thresholdMinutes}
                min={1}
                onChange={(value) => setField('thresholdMinutes', value)}
              />
              <MinutesField
                id={`repeat-${policy.id}`}
                label="Repetir lembrete a cada"
                value={draft.repeatMinutes}
                min={15}
                onChange={(value) => setField('repeatMinutes', value)}
              />
              <MinutesField
                id={`escalation-${policy.id}`}
                label="Escalar para lider/admin em"
                value={draft.escalationMinutes}
                min={1}
                optional
                onChange={(value) => setField('escalationMinutes', value)}
              />
            </div>

            {isInvalid && (
              <p className="text-sm text-destructive">O aviso nao pode acontecer depois do limite da regra.</p>
            )}

            <div className="grid gap-3 rounded-xl bg-white/[0.035] p-4 md:grid-cols-2">
              <ToggleRow
                icon={Clock3}
                title="Contar somente horário comercial"
                description="Pausa o relógio fora da jornada configurada para a organização."
                checked={draft.businessHoursOnly}
                onCheckedChange={(value) => setField('businessHoursOnly', value)}
              />
              <ToggleRow
                icon={Shuffle}
                title="Redistribuicao por tempo"
                description="Opcional; também depende da chave global de segurança."
                checked={draft.redistributionEnabled}
                onCheckedChange={(value) => setField('redistributionEnabled', value)}
              />
              {draft.redistributionEnabled && (
                <div className="space-y-2 md:col-start-2">
                  <MinutesField
                    id={`redistribution-${policy.id}`}
                    label="Redistribuir depois de"
                    value={draft.redistributionMinutes}
                    min={1}
                    onChange={(value) => setField('redistributionMinutes', value)}
                  />
                  {policy.policyType === 'first_contact' && (
                    <p className="text-xs text-muted-foreground">
                      Protecao ativa: redistribui apenas se ainda nao houve primeiro contato humano neste ciclo.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
              <p className="max-w-2xl text-xs text-muted-foreground">
                Ao salvar, o backend cria uma nova versao. Ciclos em andamento continuam vinculados a versao anterior.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDraft(policyToDraft(policy))} disabled={updatePolicy.isPending}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Desfazer
                </Button>
                <Button onClick={handleSave} disabled={updatePolicy.isPending || isInvalid || draft.name.trim().length < 2}>
                  {updatePolicy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar nova versao
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          step={15}
          placeholder={optional ? 'Sem escalonamento' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pr-16"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">min</span>
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
    <div className="flex items-start justify-between gap-4 rounded-lg p-2">
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function CreatePolicyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [policyType, setPolicyType] = useState<AttentionPolicyType>('first_contact')
  const [pipelineId, setPipelineId] = useState('')
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
    && parsedThreshold >= 1
    && parsedWarning < parsedThreshold
    && (!requiresStage || Boolean(pipelineId && stageId))

  const reset = () => {
    setName('')
    setPolicyType('first_contact')
    setPipelineId('')
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
      config: {
        redistributionBeforeFirstContactOnly: policyType === 'first_contact',
      },
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova regra de cadencia</DialogTitle>
          <DialogDescription>
            A regra nasce em observação. Assim você mede o impacto antes de ativar cobranças ou redistribuição.
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
                {(Object.keys(POLICY_TYPE_LABELS) as AttentionPolicyType[]).map((type) => (
                  <SelectItem key={type} value={type}>{POLICY_TYPE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Pipeline {requiresStage ? '(obrigatoria)' : '(opcional)'}</Label>
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

        <div className="space-y-3 rounded-xl bg-white/[0.035] p-4">
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
          <p className="text-sm text-destructive">O aviso deve acontecer antes do limite, nunca no mesmo instante.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createPolicy.isPending}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={!canSubmit || createPolicy.isPending}>
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
  const [draft, setDraft] = useState<GlobalSettingsDraft>(() => ({
    engineMode: settings.engineMode,
    notificationsEnabled: settings.notificationsEnabled,
    redistributionEnabled: settings.redistributionEnabled,
    timezone: settings.timezone,
    defaultRepeatMinutes: String(settings.defaultRepeatMinutes ?? 1_440),
    maxReminders: String(settings.maxReminders ?? 0),
  }))
  const [redistributionConfirmOpen, setRedistributionConfirmOpen] = useState(false)
  const updateSettings = useUpdateAttentionSettings()
  const parsedRepeatMinutes = parseMinutes(draft.defaultRepeatMinutes, 0)
  const parsedMaxReminders = parseMinutes(draft.maxReminders, -1)
  const isInvalid = draft.timezone.trim().length === 0
    || parsedRepeatMinutes < 15
    || parsedMaxReminders < 0
  const isEnabled = draft.engineMode === 'enabled'

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
      <Card className={cn(
        'app-card overflow-hidden border-2',
        isEnabled ? 'border-amber-500/35' : 'border-emerald-500/20',
      )}>
        <CardHeader className="gap-3 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Power className={cn('h-5 w-5', isEnabled ? 'text-amber-500' : 'text-emerald-500')} />
                Seguranca global do motor
              </CardTitle>
              <CardDescription className="mt-1">
                Travas da organização que prevalecem sobre todas as políticas individuais.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={isEnabled ? 'default' : 'secondary'}>
                Motor {draft.engineMode === 'disabled' ? 'desligado' : draft.engineMode === 'shadow' ? 'em observação' : 'ativo'}
              </Badge>
              <Badge variant={draft.redistributionEnabled ? 'destructive' : 'outline'}>
                Redistribuicao {draft.redistributionEnabled ? 'liberada' : 'bloqueada'}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <Alert className={cn(
            isEnabled
              ? 'border-amber-500/30 bg-amber-500/[0.08]'
              : 'border-emerald-500/20 bg-emerald-500/[0.06]',
          )}>
            {isEnabled ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
            <AlertTitle>{isEnabled ? 'Ativação operacional preparada' : 'Ambiente seguro para configuração'}</AlertTitle>
            <AlertDescription>
              {isEnabled
                ? 'Ao salvar em modo ativo, politicas ativas iniciam cobrancas somente para leads futuros elegiveis: nao manuais e criados depois da implantacao. Leads antigos nunca entram.'
                : 'Use o modo observação para medir prazos sem cobrar corretores. O modo desligado interrompe a avaliação global.'}
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label>Modo do motor</Label>
              <Select value={draft.engineMode} onValueChange={(value) => setField('engineMode', value as AttentionEngineMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              />
              <p className="text-xs text-muted-foreground">Use 0 para lembretes ilimitados ate a resolucao.</p>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl bg-white/[0.035] p-4 md:grid-cols-2">
            <ToggleRow
              icon={BellRing}
              title="Notificações habilitadas"
              description="Permite avisos ao corretor, lideranca e administradores quando o motor e a politica estiverem ativos."
              checked={draft.notificationsEnabled}
              onCheckedChange={(checked) => setField('notificationsEnabled', checked)}
            />
            <ToggleRow
              icon={Shuffle}
              title="Kill switch de redistribuicao"
              description="Comeca desligado. Mesmo ligado, cada politica ainda precisa autorizar a redistribuicao."
              checked={draft.redistributionEnabled}
              onCheckedChange={handleRedistributionChange}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
            <p className="max-w-2xl text-xs text-muted-foreground">
              Desligar o kill switch bloqueia qualquer nova redistribuicao por SLA sem alterar a atribuicao atual dos leads.
            </p>
            <Button onClick={handleSave} disabled={isInvalid || updateSettings.isPending}>
              {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar segurança global
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={redistributionConfirmOpen} onOpenChange={setRedistributionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar redistribuicao automatica por tempo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta é a trava global da organização. Quando o motor e uma política também estiverem ativos, leads futuros elegíveis poderão trocar de corretor após o prazo configurado. A ativação não inclui leads antigos ou manuais.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter bloqueada</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setField('redistributionEnabled', true)
                setRedistributionConfirmOpen(false)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Entendi, liberar no rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function AttentionPolicySettings() {
  const [createOpen, setCreateOpen] = useState(false)
  const { data: policies = [], isLoading, isError, refetch } = useAttentionPolicies()
  const settingsQuery = useAttentionSettings()

  return (
    <div className="space-y-5">
      {settingsQuery.isLoading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : settingsQuery.isError || !settingsQuery.data ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Segurança global indisponível</AlertTitle>
          <AlertDescription className="mt-2 flex flex-wrap items-center gap-3">
            <span>Não foi possível confirmar o modo do motor. Nenhuma alteração deve ser ativada sem esta leitura.</span>
            <Button variant="outline" size="sm" onClick={() => settingsQuery.refetch()}>Tentar novamente</Button>
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

      <Alert className="border-amber-500/25 bg-amber-500/[0.07]">
        <ShieldCheck className="h-4 w-4 text-amber-500" />
        <AlertTitle>Seguranca em camadas</AlertTitle>
        <AlertDescription>
          Uma regra ativa pode gerar cobranças. Redistribuição só acontece quando a regra permite e o kill switch global também está ligado. Comece sempre em observação. As regras valem somente para leads não manuais criados depois da implantação; não há inscrição de legado.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Políticas de cadência e SLA</h2>
          <p className="text-sm text-muted-foreground">Configure cada relogio sem alterar ciclos que ja estao em andamento.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova regra
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-96 rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="app-card">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium">Não foi possível carregar as regras.</p>
              <p className="text-sm text-muted-foreground">Confira se a API local está rodando e tente novamente.</p>
            </div>
            <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
          </CardContent>
        </Card>
      ) : policies.length === 0 ? (
        <Card className="app-card">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <Clock3 className="h-12 w-12 text-muted-foreground" />
            <div className="max-w-xl">
              <h3 className="font-semibold">Nenhuma regra configurada</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Crie primeiro uma regra de contato ou de etapa em modo de observação para validar o comportamento com dados reais.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Criar primeira regra</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {policies.map((policy) => (
            <PolicyCard key={`${policy.id}:${policy.updatedAt}`} policy={policy} />
          ))}
        </div>
      )}

      <CreatePolicyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
