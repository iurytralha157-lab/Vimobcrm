"use client";

import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDisconnectMarketingConnection,
  useMarketingConnections,
  useStartMarketingMetaLogin,
  useSyncMarketingConnection,
  useUpdateMarketingConnectionAssets,
} from "@/hooks/marketing";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import type { MarketingConnection, MarketingConnectionAsset } from "@/lib/api/marketing-connections";

const GROUPS: Array<{ type: MarketingConnectionAsset["type"]; title: string; hint: string }> = [
  { type: "ad_account", title: "Contas de anúncios", hint: "Campanhas, criativos e resultados." },
  { type: "instagram_account", title: "Instagram", hint: "Seguidores, alcance e publicações." },
];

const STATUS_LABEL: Record<string, string> = {
  active: "Conectada",
  expired: "Login expirado",
  error: "Com erro",
};

const LOGIN_ERRORS: Record<string, string> = {
  meta_login_cancelled: "O login foi cancelado na Meta.",
  meta_code_exchange_failed: "A Meta recusou o login. Confira o endereço de retorno no app.",
};

function ConnectionCard({ connection, onReconnect, reconnecting }: { connection: MarketingConnection; onReconnect: () => void; reconnecting: boolean }) {
  const saved = useMemo(() => connection.assets.filter((asset) => asset.is_selected).map((asset) => asset.id), [connection.assets]);
  const [selected, setSelected] = useState<string[]>(saved);
  const update = useUpdateMarketingConnectionAssets();
  const sync = useSyncMarketingConnection();
  const disconnect = useDisconnectMarketingConnection();
  const dirty = selected.length !== saved.length || selected.some((id) => !saved.includes(id));
  const syncable = connection.assets.some((asset) => asset.is_selected && asset.type !== "page");

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));

  const runSync = () => {
    const today = new Date();
    sync.mutate({
      connectionId: connection.id,
      dateStart: format(subDays(today, 30), "yyyy-MM-dd"),
      dateStop: format(today, "yyyy-MM-dd"),
    });
  };

  return (
    <section className="rounded-[12px] bg-[var(--app-surface-solid)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-normal text-[var(--app-text-primary)]">{connection.external_user_name || "Login da Meta"}</h2>
          <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{STATUS_LABEL[connection.status] ?? connection.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {connection.status !== "active" ? (
            <Button type="button" onClick={onReconnect} disabled={reconnecting} className="h-8 rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-primary-foreground hover:bg-primary">
              Entrar de novo
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={runSync} disabled={!syncable || dirty || sync.isPending} className="h-8 rounded-[6px] px-3 text-[12px] font-light">
            <RefreshCw className={sync.isPending ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} aria-hidden="true" />
            {sync.isPending ? "Sincronizando" : "Sincronizar 30 dias"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => disconnect.mutate(connection.id)}
            disabled={disconnect.isPending}
            className="h-8 rounded-[6px] px-3 text-[12px] font-light text-[var(--app-text-secondary)]"
          >
            Desconectar
          </Button>
        </div>
      </header>
      {connection.missing_scopes.length > 0 ? (
        <p className="mt-3 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[12px] font-light text-[var(--app-text-primary)]">
          Permissões não concedidas: {connection.missing_scopes.join(", ")}. Alguns dados podem não aparecer.
        </p>
      ) : null}
      {connection.last_error ? (
        <p className="mt-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-[12px] font-light text-[var(--app-text-primary)]">
          Último erro: {connection.last_error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {GROUPS.map((group) => {
          const assets = connection.assets.filter((asset) => asset.type === group.type);
          return (
            <div key={group.type} className="min-w-0">
              <h3 className="text-[12px] font-normal text-[var(--app-text-primary)]">{group.title}</h3>
              <p className="mb-2 text-[11px] font-light text-[var(--app-text-tertiary)]">{group.hint}</p>
              {assets.length === 0 ? (
                <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">Nada encontrado neste login.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]">
                        <Checkbox checked={selected.includes(asset.id)} onCheckedChange={(value) => toggle(asset.id, value === true)} />
                        <span className="min-w-0 truncate">{asset.name || asset.external_id}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-[var(--app-text-tertiary)]">{asset.external_id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {dirty ? (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            onClick={() => update.mutate({ connectionId: connection.id, assetIds: selected })}
            disabled={update.isPending}
            className="h-8 rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-primary-foreground hover:bg-primary"
          >
            Salvar seleção
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export default function MarketingConnectionsScreen() {
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canManage = !permissionsLoading && hasPermission("settings_integrations");
  const query = useMarketingConnections({ enabled: canManage });
  const start = useStartMarketingMetaLogin();
  const data = query.data;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("marketing_connection");
    if (!status) return;
    if (status === "success") {
      toast.success("Login concluído. Escolha as contas e sincronize.");
    } else {
      const code = params.get("marketing_error") ?? "";
      toast.error(LOGIN_ERRORS[code] ?? `A conexão falhou (${code || "erro desconhecido"}).`);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const connect = () => start.mutate(`${window.location.origin}${window.location.pathname}`);

  return (
    <AppLayout title="Meta Marketing" borderless>
      <div className="mx-auto w-full max-w-4xl space-y-3 pb-8 sm:pt-1">
        <section className="rounded-[12px] bg-[var(--app-surface-solid)] p-4">
          <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">Dados de campanhas, criativos e Instagram</h2>
          <p className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
            Este login só lê dados para a dashboard de Marketing. Ele é separado da integração Meta que recebe os leads, que continua como está.
          </p>
          {!permissionsLoading && !canManage ? (
            <p className="mt-3 text-[12px] font-light text-[var(--app-text-tertiary)]">Você não tem permissão para gerenciar integrações.</p>
          ) : query.isLoading || permissionsLoading ? (
            <Skeleton className="mt-3 h-8 w-40 rounded-[6px]" />
          ) : query.isError ? (
            <p className="mt-3 text-[12px] font-light text-[var(--app-text-tertiary)]">Não foi possível carregar as conexões.</p>
          ) : !data?.enabled ? (
            <p className="mt-3 text-[12px] font-light text-[var(--app-text-tertiary)]">Ainda não liberado para esta organização.</p>
          ) : !data.meta_configured ? (
            <p className="mt-3 text-[12px] font-light text-[var(--app-text-tertiary)]">O app da Meta para Marketing ainda não foi configurado neste ambiente.</p>
          ) : (
            <Button type="button" onClick={connect} disabled={start.isPending} className="mt-3 h-9 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground hover:bg-primary">
              {data.connections.length > 0 ? "Conectar outro login" : "Conectar com a Meta"}
            </Button>
          )}
        </section>
        {data?.connections.map((connection) => (
          <ConnectionCard key={`${connection.id}:${connection.assets.filter((asset) => asset.is_selected).map((asset) => asset.id).join(",")}`} connection={connection} onReconnect={connect} reconnecting={start.isPending} />
        ))}
      </div>
    </AppLayout>
  );
}
