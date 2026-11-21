import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GoogleTasksConnectionPanel({
  authorized,
  routingEnabled,
  canAuthorize,
  isPending,
  onAuthorize,
}: {
  authorized: boolean;
  routingEnabled: boolean;
  canAuthorize: boolean;
  isPending: boolean;
  onAuthorize: () => void;
}) {
  if (authorized && routingEnabled) return null;

  return (
    <div className="space-y-2 text-[12px] font-light leading-[18px]">
      <p className="text-[var(--app-text-primary)]">
        {authorized ? "Google Tasks autorizado" : "Autorize o Google Tasks"}
      </p>
      <p className="text-[var(--app-text-secondary)]">
        {authorized
          ? "O envio separado das atividades ainda não foi ativado."
          : routingEnabled
            ? "O envio ao Google Tasks aguarda sua autorização. Visitas e reuniões continuam no Google Agenda."
            : "Adicione o Tasks à conexão existente, mantendo o Google Agenda conectado."}
      </p>
      {!authorized && (
        <Button
          variant="ghost"
          className="h-9 w-full rounded-[6px] bg-[var(--app-surface-soft)] text-[12px] font-light"
          onClick={onAuthorize}
          disabled={!canAuthorize || isPending}
        >
          <Link2 aria-hidden="true" className="mr-2 h-4 w-4" />
          {isPending ? "Abrindo autorização..." : "Autorizar Google Tasks"}
        </Button>
      )}
      {!authorized && !canAuthorize && (
        <p className="text-[var(--app-text-tertiary)]">A autorização não está disponível para seu acesso neste momento.</p>
      )}
    </div>
  );
}
