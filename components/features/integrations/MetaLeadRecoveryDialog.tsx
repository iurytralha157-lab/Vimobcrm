import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { metaIntegrationsAPI } from "@/lib/api/integrations/meta";

type RecoveryPreview = Awaited<ReturnType<typeof metaIntegrationsAPI.previewMetaLeadRecovery>>;

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function saoPauloTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(iso));
}

function statusLabel(status: RecoveryPreview["items"][number]["status"]) {
  switch (status) {
    case "ready": return "Pronto para recuperar";
    case "possible_reentry": return "Contato existente; nova entrada";
    case "already_ingested": return "Já entrou no CRM";
    case "already_present_alias": return "Já entrou com outro ID da Meta";
    case "test_lead": return "Teste da Meta";
    case "incomplete": return "Dados incompletos";
    case "processed": return "Recuperado";
  }
}

export function MetaLeadRecoveryDialog({
  open, onOpenChange, pageId, pageName, formId, formName, organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  pageName: string;
  formId: string;
  formName: string;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(saoPauloDate);
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const eligible = preview?.items.filter((item) => item.status === "ready" || item.status === "possible_reentry") ?? [];

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && (loading || recovering)) return;
    if (!nextOpen) {
      setPreview(null);
      setSummary(null);
      setDate(saoPauloDate());
    }
    onOpenChange(nextOpen);
  };

  const loadPreview = async () => {
    if (loading || recovering || !organizationId) return;
    setLoading(true);
    setPreview(null);
    setSummary(null);
    try {
      const result = await metaIntegrationsAPI.previewMetaLeadRecovery(pageId, formId, { date }, organizationId);
      setPreview(result);
    } catch {
      toast.error("Não foi possível conferir os leads na Meta. Tente novamente em instantes.");
    } finally {
      setLoading(false);
    }
  };

  const recover = async (selected: RecoveryPreview["items"]) => {
    if (!preview || loading || recovering || selected.length === 0 || selected.length > 25) return;
    setRecovering(true);
    let processed = 0;
    let reentries = 0;
    let alreadyPresent = 0;
    let notRecovered = 0;
    let interrupted = false;
    try {
      for (const item of selected) {
        try {
          const result = await metaIntegrationsAPI.recoverMetaLead(
            pageId, formId, { date: preview.date, leadgenId: item.leadgenId }, organizationId,
          );
          if (result.status === "processed") {
            processed += 1;
            if (result.reentry) reentries += 1;
          } else if (result.status === "already_ingested" || result.status === "already_present_alias") {
            alreadyPresent += 1;
          } else {
            notRecovered += 1;
          }
        } catch {
          // The response may have been lost after a committed write. Stop and
          // refresh the read-only preview before another idempotent attempt.
          interrupted = true;
          break;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["meta-form-configs"] });
      await queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      try {
        setPreview(await metaIntegrationsAPI.previewMetaLeadRecovery(pageId, formId, { date }, organizationId));
      } catch {
        setPreview(null);
      }
      const message = `${processed} recuperado${processed === 1 ? "" : "s"}, ${reentries} reentrada${reentries === 1 ? "" : "s"}, ${alreadyPresent} já existente${alreadyPresent === 1 ? "" : "s"}, ${notRecovered} não recuperado${notRecovered === 1 ? "" : "s"}.`;
      setSummary(interrupted ? `${message} Operação interrompida; confira a prévia antes de tentar novamente.` : message);
      if (interrupted) toast.warning("Não foi possível confirmar todas as entradas. Confira a prévia antes de repetir.");
      else toast.success("Recuperação concluída. Confira a distribuição no CRM.");
    } finally {
      setRecovering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recuperar leads da Meta</DialogTitle>
          <DialogDescription>
            {pageName} · {formName}. Confira as entradas de um dia antes de enviá-las ao CRM. Os dados de contato não aparecem nesta tela.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="meta-recovery-date" className="text-[12px] font-medium">Dia das entradas (horário de São Paulo)</label>
          <Input
            id="meta-recovery-date"
            type="date"
            value={date}
            max={saoPauloDate()}
            onChange={(event) => { setDate(event.target.value); setPreview(null); setSummary(null); }}
            disabled={loading || recovering}
          />
          <p className="text-[11px] text-muted-foreground">A prévia consulta a Meta sem criar leads. A recuperação usa o ID original retornado pela Meta e evita entradas já recebidas.</p>
        </div>
        {preview && (
          <div className="space-y-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
            <p className="text-[12px] font-medium">{preview.items.length} entrada{preview.items.length === 1 ? "" : "s"} encontrada{preview.items.length === 1 ? "" : "s"}; {eligible.length} para processar</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {preview.items.map((item, index) => (
                <div key={`${item.leadgenId}-${index}`} className="flex items-center justify-between gap-3 text-[11px]">
                  <span>{saoPauloTime(item.occurredAt)}</span>
                  <span className="ml-auto text-right">{statusLabel(item.status)}</span>
                  {(item.status === "ready" || item.status === "possible_reentry") && (
                    <Button type="button" variant="outline" size="sm" onClick={() => recover([item])} disabled={loading || recovering}>
                      Recuperar este
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {eligible.length > 25 && <p className="text-[11px] text-destructive">Mais de 25 entradas pendentes. Faça a recuperação em lotes menores com suporte técnico.</p>}
          </div>
        )}
        {summary && <p className="text-[12px]" role="status">{summary}</p>}
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={loading || recovering}>Fechar</Button>
          <Button type="button" variant="outline" onClick={loadPreview} disabled={!date || loading || recovering}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Conferir na Meta
          </Button>
          <Button type="button" onClick={() => recover(eligible)} disabled={!preview || eligible.length === 0 || eligible.length > 25 || loading || recovering}>
            {recovering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Recuperar {eligible.length} lead{eligible.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
