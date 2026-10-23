'use client'

import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'

import { useAuth } from '@/contexts/AuthContext'
import { useWhatsAppNotificationReset } from '@/hooks/admin/use-whatsapp-notification-reset'
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out'
import { whatsAppNotificationResetInputSchema, type WhatsAppNotificationResetPreview } from '@/lib/validation/notifications'
import { formatPtBRNumber } from '@/lib/utils/formatting'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

function resetErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível resetar a fila. Consulte novamente antes de tentar.'
}

function WhatsAppNotificationQueueResetForm({ organizationLabel }: { organizationLabel: string }) {
  const [scope, setScope] = useState<'organization' | 'all'>('organization')
  const [preview, setPreview] = useState<WhatsAppNotificationResetPreview | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const { ready, previewQuery, resetMutation, isCurrentVisit } = useWhatsAppNotificationReset(scope)
  const pending = previewQuery.isFetching || resetMutation.isPending
  const reasonLength = Array.from(reason.trim()).length
  const scopeLabel = scope === 'all' ? 'Todas as organizações do Vimob' : organizationLabel
  const request = preview ? whatsAppNotificationResetInputSchema.safeParse({
    ...(preview.scope === 'all' ? { scope: 'all' } : { scope: 'organization', organizationId: preview.organizationId }),
    cutoffAt: preview.cutoffAt,
    reason,
    confirmation,
  }) : null

  async function loadPreview() {
    setError(null)
    setResultMessage(null)
    setPreview(null)
    setReason('')
    setConfirmation('')
    const result = await previewQuery.refetch()
    if (!isCurrentVisit()) return
    if (result.error || !result.data) {
      setError(resetErrorMessage(result.error))
      return
    }
    setPreview(result.data)
    setDialogOpen(true)
  }

  async function resetQueue() {
    if (!request?.success) return
    setError(null)
    try {
      const result = await resetMutation.mutateAsync(request.data)
      if (!isCurrentVisit()) return
      setResultMessage(`${formatPtBRNumber(result.cancelledCount)} notificações pendentes de WhatsApp canceladas. ${formatPtBRNumber(result.inFlightCount)} em envio ou já aceitas pelo provedor ficaram fora do reset.`)
      setDialogOpen(false)
      setPreview(null)
      setReason('')
      setConfirmation('')
    } catch (resetError) {
      if (!isCurrentVisit()) return
      setError(`${resetErrorMessage(resetError)} Feche esta janela e consulte a fila novamente.`)
      setPreview(null)
    }
  }

  return (
    <div className="app-card p-4">
      <h2 className="text-base font-medium">Resetar fila de notificações do WhatsApp</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Antes de conectar o WhatsApp, consulte e cancele os avisos antigos que ainda aguardam envio.
        O reset considera apenas os itens já enfileirados até a consulta; novos avisos continuam funcionando normalmente.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Notificações no CRM, histórico, push, e-mail e mensagens de conversas são preservados.
        Envios em andamento ou já aceitos pelo provedor não podem ser interrompidos por esta ação.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="whatsapp-reset-scope">Escopo do reset</Label>
          <select
            id="whatsapp-reset-scope"
            className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
            value={scope}
            disabled={pending}
            onChange={(event) => {
              setScope(event.target.value === 'all' ? 'all' : 'organization')
              setPreview(null)
              setError(null)
              setResultMessage(null)
            }}
          >
            <option value="organization">Organização atual: {organizationLabel}</option>
            <option value="all">Todas as organizações do Vimob (global)</option>
          </select>
        </div>
        <Button type="button" variant="outline" disabled={!ready || pending} onClick={() => void loadPreview()}>
          {previewQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Consultar fila para reset
        </Button>
      </div>
      {scope === 'all' ? <p className="mt-3 text-sm text-amber-500">Escopo global: o reset afetará os avisos pendentes de WhatsApp de todas as organizações.</p> : null}
      {resultMessage ? <p className="mt-3 text-sm" role="status">{resultMessage}</p> : null}
      {error && !dialogOpen ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!resetMutation.isPending) setDialogOpen(open) }}>
        <DialogContent className="sm:max-w-lg" onInteractOutside={(event) => { if (resetMutation.isPending) event.preventDefault() }}>
          <DialogHeader>
            <DialogTitle>Confirmar reset dos avisos de WhatsApp</DialogTitle>
            <DialogDescription>Escopo: {scopeLabel}. Esta ação cancela os avisos pendentes selecionados.</DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3 text-sm">
              <p><strong>{formatPtBRNumber(preview.pendingCount)}</strong> avisos pendentes podem ser cancelados.</p>
              <p className="text-muted-foreground">
                {formatPtBRNumber(preview.inFlightCount)} em envio ou já aceitos pelo provedor ficam fora do reset.
                A consulta abrange itens criados até {new Date(preview.cutoffAt).toLocaleString('pt-BR')}.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp-reset-reason">Motivo do reset</Label>
                <Textarea id="whatsapp-reset-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={resetMutation.isPending} maxLength={2_000} placeholder="Ex.: cancelar avisos antigos antes de conectar o WhatsApp." />
                <p className={reasonLength > 1_000 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                  {formatPtBRNumber(reasonLength)}/1.000 caracteres. O motivo é obrigatório e será registrado na auditoria.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp-reset-confirmation">Digite RESETAR para confirmar</Label>
                <Input id="whatsapp-reset-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={resetMutation.isPending} autoComplete="off" />
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={resetMutation.isPending} onClick={() => setDialogOpen(false)}>Fechar</Button>
            <Button type="button" variant="destructive" disabled={!ready || !request?.success || !preview?.pendingCount || resetMutation.isPending} onClick={() => void resetQueue()}>
              {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cancelar avisos pendentes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function WhatsAppNotificationQueueReset() {
  const { activeOrganization, user, session, organization, userOrganizations, isSuperAdmin } = useAuth()
  if (!isSuperAdmin) return null
  const organizationId = activeOrganization.organizationId
  const organizationLabel = userOrganizations.find((item) => item.organization_id === organizationId)?.organization_name
    || (organization?.id === organizationId ? organization.name : null)
    || organizationId || 'Selecione uma organização'
  const identityKey = JSON.stringify([organizationId, user?.id, getGlobalSignOutSessionId(session)])
  return <WhatsAppNotificationQueueResetForm key={identityKey} organizationLabel={organizationLabel} />
}
