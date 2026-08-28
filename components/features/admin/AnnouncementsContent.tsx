"use client";

import { useMemo, useState, type MouseEvent } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  Users,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAnnouncements,
  type Announcement,
  type AnnouncementTargetType,
} from "@/hooks/use-announcements";
import { adminAPI } from "@/lib/api/admin";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type UserOption = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
};

type AnnouncementForm = {
  message: string;
  buttonText: string;
  buttonUrl: string;
  targetType: AnnouncementTargetType;
  targetUserId: string;
  startsAt: string;
  endsAt: string;
  displayDurationSeconds: string;
  showBanner: boolean;
  sendNotification: boolean;
};

const EMPTY_FORM: AnnouncementForm = {
  message: "",
  buttonText: "",
  buttonUrl: "",
  targetType: "all",
  targetUserId: "",
  startsAt: "",
  endsAt: "",
  displayDurationSeconds: "0",
  showBanner: true,
  sendNotification: false,
};

const TARGET_LABELS: Record<string, string> = {
  all: "Todos",
  brokers: "Corretores",
  specific: "Usuário específico",
  organizations: "Organizações",
  admins: "Admins",
};

function toIsoFromLocalInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isSafeAnnouncementURL(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getUserLabel(user?: UserOption) {
  if (!user) return "Usuário não encontrado";
  return `${user.name || "Sem nome"} · ${user.email || "sem e-mail"}`;
}

function getAnnouncementState(announcement: Announcement) {
  const now = new Date();
  const startsAt = announcement.starts_at
    ? new Date(announcement.starts_at)
    : null;
  const endsAt = announcement.ends_at ? new Date(announcement.ends_at) : null;

  if (
    (startsAt && Number.isNaN(startsAt.getTime())) ||
    (endsAt && Number.isNaN(endsAt.getTime()))
  ) {
    return { label: "Data inválida", tone: "warning" };
  }

  if (!announcement.is_active) return { label: "Inativo", tone: "muted" };
  if (startsAt && startsAt > now) return { label: "Agendado", tone: "warning" };
  if (endsAt && endsAt < now) return { label: "Expirado", tone: "muted" };
  return { label: "No ar", tone: "active" };
}

function StateBadge({ announcement }: { announcement: Announcement }) {
  const state = getAnnouncementState(announcement);

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-[4px] border-0 px-2.5 py-1 text-[11px] font-light",
        state.tone === "active" && "bg-primary/50 text-primary-foreground",
        state.tone === "warning" && "bg-amber-500/15 text-amber-600 dark:text-amber-300",
        state.tone === "muted" &&
          "bg-[var(--app-surface-soft)] text-muted-foreground",
      )}
    >
      {state.label}
    </Badge>
  );
}

function DurationLabel({ seconds }: { seconds: number | null }) {
  if (!seconds) return <>Fica até o fim do período</>;
  if (seconds < 60) return <>{seconds}s na tela</>;
  return <>{Math.round(seconds / 60)} min na tela</>;
}

export function AnnouncementsContent() {
  const {
    allAnnouncements = [],
    publish,
    deactivate,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useAnnouncements();
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_FORM);
  const [announcementToDeactivate, setAnnouncementToDeactivate] =
    useState<Announcement | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-announcement-users"],
    queryFn: async () => {
      const users = await adminAPI.listUsers();
      return users
        .filter((user) => user.is_active === true)
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        ) as UserOption[];
    },
    staleTime: 60_000,
  });

  const usersById = useMemo(() => {
    const map = new Map<string, UserOption>();
    (usersQuery.data || []).forEach((user) => map.set(user.id, user));
    return map;
  }, [usersQuery.data]);

  const updateForm = <K extends keyof AnnouncementForm>(
    key: K,
    value: AnnouncementForm[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handlePublish = async () => {
    const message = form.message.trim();
    const startsAt = toIsoFromLocalInput(form.startsAt);
    const endsAt = toIsoFromLocalInput(form.endsAt);
    const displayDurationSeconds = Number(form.displayDurationSeconds || 0);

    if (startsAt === undefined || endsAt === undefined) {
      toast.error("Informe datas e horários válidos.");
      return;
    }

    if (!message) {
      toast.error("Escreva o comunicado antes de publicar.");
      return;
    }

    if (message.length > 500) {
      toast.error("O comunicado pode ter no máximo 500 caracteres.");
      return;
    }

    if (form.targetType === "specific" && !form.targetUserId) {
      toast.error("Escolha o usuário que deve receber o comunicado.");
      return;
    }

    const buttonText = form.buttonText.trim();
    const buttonUrl = form.buttonUrl.trim();
    if (Boolean(buttonText) !== Boolean(buttonUrl)) {
      toast.error("Preencha o texto e a URL do botão, ou deixe os dois vazios.");
      return;
    }
    if (buttonUrl && !isSafeAnnouncementURL(buttonUrl)) {
      toast.error("Use uma URL HTTP(S) válida ou um caminho interno iniciado por /.");
      return;
    }

    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      toast.error("O término precisa ser depois do início.");
      return;
    }

    if (startsAt && form.sendNotification) {
      toast.error(
        "Para enviar também como notificação, publique o comunicado imediatamente.",
      );
      return;
    }

    try {
      await publish.mutateAsync({
        message,
        buttonText: buttonText || undefined,
        buttonUrl: buttonUrl || undefined,
        showBanner: form.showBanner,
        sendNotification: form.sendNotification,
        targetType: form.targetType,
        targetUserIds: form.targetType === "specific" ? [form.targetUserId] : [],
        startsAt,
        endsAt,
        displayDurationSeconds:
          displayDurationSeconds > 0 ? displayDurationSeconds : null,
      });

      setForm(EMPTY_FORM);
    } catch {
      // The mutation owns the toast. Keep the draft so publishing can be retried.
    }
  };

  const handleDeactivate = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!announcementToDeactivate) return;

    try {
      await deactivate.mutateAsync(announcementToDeactivate.id);
      setAnnouncementToDeactivate(null);
    } catch {
      // The mutation owns the toast. Keep confirmation open so it can be retried.
    }
  };

  return (
    <div className="space-y-4">
      <section className="app-card overflow-hidden">
        <div className="bg-primary/50 px-4 py-3 text-primary-foreground">
          <div className="flex items-center gap-3">
            <Megaphone className="h-5 w-5 shrink-0" strokeWidth={1.8} />
            <div className="min-w-0">
              <h2 className="text-[14px] font-normal">
                Faixa superior rotativa
              </h2>
              <p className="truncate text-[12px] font-light text-primary-foreground/80">
                Comunicados exibidos apenas para usuários logados.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Texto do comunicado</Label>
              <Textarea
                value={form.message}
                onChange={(event) => updateForm("message", event.target.value)}
                maxLength={500}
                placeholder="Ex: Hoje teremos manutenção programada às 22h."
                className="min-h-24 border-0 bg-[var(--app-surface-soft)]"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Destino</Label>
                <Select
                  value={form.targetType}
                  onValueChange={(value) =>
                    updateForm("targetType", value as AnnouncementTargetType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="specific">Usuário específico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label className="app-card-soft flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm">Faixa no topo</span>
                <Switch
                  checked={form.showBanner}
                  onCheckedChange={(checked) =>
                    updateForm("showBanner", checked)
                  }
                />
              </label>
            </div>

            {form.targetType === "specific" ? (
              <div className="space-y-2">
                <Label>Usuário</Label>
                <Select
                  value={form.targetUserId || "none"}
                  onValueChange={(value) =>
                    updateForm("targetUserId", value === "none" ? "" : value)
                  }
                  disabled={usersQuery.isLoading || usersQuery.isError}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha um usuário" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Escolha um usuário</SelectItem>
                    {(usersQuery.data || []).map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {getUserLabel(user)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {usersQuery.isError && (
                  <div className="flex items-center justify-between gap-2 rounded-[6px] bg-destructive/10 px-3 py-2 text-[12px] font-light text-destructive">
                    <span>Não foi possível carregar os usuários.</span>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 shrink-0 rounded-[6px] px-2 text-[12px] font-light"
                      disabled={usersQuery.isFetching}
                      onClick={() => void usersQuery.refetch()}
                    >
                      Tentar novamente
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Começa em</Label>
                <Input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) =>
                    updateForm("startsAt", event.target.value)
                  }
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2">
                <Label>Termina em</Label>
                <Input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => updateForm("endsAt", event.target.value)}
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2">
                <Label>Tempo na tela</Label>
                <Select
                  value={form.displayDurationSeconds}
                  onValueChange={(value) =>
                    updateForm("displayDurationSeconds", value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Até fechar ou expirar</SelectItem>
                    <SelectItem value="15">15 segundos</SelectItem>
                    <SelectItem value="30">30 segundos</SelectItem>
                    <SelectItem value="60">1 minuto</SelectItem>
                    <SelectItem value="300">5 minutos</SelectItem>
                    <SelectItem value="900">15 minutos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Texto do botão</Label>
                <Input
                  value={form.buttonText}
                  onChange={(event) =>
                    updateForm("buttonText", event.target.value)
                  }
                  maxLength={48}
                  placeholder="Ver detalhes"
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>URL do botão</Label>
                <Input
                  value={form.buttonUrl}
                  onChange={(event) =>
                    updateForm("buttonUrl", event.target.value)
                  }
                  maxLength={2048}
                  placeholder="https://..."
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--app-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-3 text-sm text-muted-foreground">
                <Switch
                  checked={form.sendNotification}
                  onCheckedChange={(checked) =>
                    updateForm("sendNotification", checked)
                  }
                />
                Enviar também como notificação
              </label>
              <Button
                className="h-9 rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                onClick={handlePublish}
                disabled={publish.isPending}
              >
                {publish.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Publicar comunicado
              </Button>
            </div>
          </div>

          <aside className="rounded-[6px] bg-[var(--app-surface-soft)] p-4">
            <p className="text-[12px] font-light text-muted-foreground">
              Prévia
            </p>
            <div className="mt-3 overflow-hidden rounded-[6px] bg-primary/50 text-primary-foreground shadow-none">
              <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-sm">
                <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                <p className="min-w-0 flex-1 truncate font-light">
                  {form.message.trim() ||
                    "Seu comunicado aparece aqui em uma linha rotativa."}
                </p>
                <X className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" strokeWidth={1.7} />
                <span>{TARGET_LABELS[form.targetType]}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarClock className="h-4 w-4" strokeWidth={1.7} />
                <span>{form.startsAt ? "Agendado" : "Imediato"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
                <DurationLabel
                  seconds={Number(form.displayDurationSeconds) || null}
                />
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
          <div>
            <h2 className="text-[14px] font-normal">Comunicados programados</h2>
            <p className="text-[12px] font-light text-muted-foreground">
              {allAnnouncements.length} registros exibidos
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError && allAnnouncements.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="mt-3 text-[14px] font-normal">Não foi possível carregar os comunicados</p>
            <Button
              type="button"
              className="mt-3 h-8 rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden="true" />
              Tentar novamente
            </Button>
          </div>
        ) : allAnnouncements.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            Nenhum comunicado criado ainda.
          </div>
        ) : (
          <div className="divide-y divide-[var(--app-border)]">
            {allAnnouncements.map((announcement) => {
              const targetUsers = (announcement.target_user_ids || [])
                .map((id) => usersById.get(id))
                .filter((user): user is UserOption => Boolean(user));

              return (
                <div
                  key={announcement.id}
                  className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_180px_220px_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StateBadge announcement={announcement} />
                      <Badge
                        variant="outline"
                        className="border-0 bg-[var(--app-surface-soft)] text-muted-foreground"
                      >
                        {TARGET_LABELS[announcement.target_type] ||
                          announcement.target_type}
                      </Badge>
                    </div>
                    <p className="mt-2 truncate text-[14px] font-normal">
                      {announcement.message}
                    </p>
                    {targetUsers.length > 0 ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {targetUsers.map(getUserLabel).join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p>
                      {formatDateTime(announcement.starts_at) === "--"
                        ? "Imediato"
                        : formatDateTime(announcement.starts_at)}
                    </p>
                    <p>
                      {formatDateTime(announcement.ends_at) === "--"
                        ? "Sem término"
                        : formatDateTime(announcement.ends_at)}
                    </p>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <DurationLabel
                      seconds={announcement.display_duration_seconds}
                    />
                  </div>

                  <Button
                    variant="outline"
                    className="border-0 bg-[var(--app-surface-soft)]"
                    onClick={() => setAnnouncementToDeactivate(announcement)}
                    disabled={!announcement.is_active || deactivate.isPending}
                  >
                    Desativar
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AlertDialog
        open={Boolean(announcementToDeactivate)}
        onOpenChange={(open) => {
          if (!open && !deactivate.isPending) setAnnouncementToDeactivate(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100vw-24px)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[14px] font-normal">
              Desativar comunicado?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
              O comunicado deixa de aparecer imediatamente, mas permanece no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-9 rounded-[6px] text-[12px] font-light"
              disabled={deactivate.isPending}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
              disabled={deactivate.isPending}
              onClick={(event) => void handleDeactivate(event)}
            >
              {deactivate.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
