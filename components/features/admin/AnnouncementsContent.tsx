"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Megaphone, Send, Users, X } from "lucide-react";
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
import { useAnnouncements, type Announcement, type AnnouncementTargetType } from "@/hooks/use-announcements";
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
  return new Date(value).toISOString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getUserLabel(user?: UserOption) {
  if (!user) return "Usuário não encontrado";
  return `${user.name || "Sem nome"} · ${user.email || "sem e-mail"}`;
}

function getAnnouncementState(announcement: Announcement) {
  const now = new Date();
  const startsAt = announcement.starts_at ? new Date(announcement.starts_at) : null;
  const endsAt = announcement.ends_at ? new Date(announcement.ends_at) : null;

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
        "border-0 px-2.5 py-1 font-medium",
        state.tone === "active" && "bg-[#FF4529] text-white",
        state.tone === "warning" && "bg-amber-500 text-white",
        state.tone === "muted" && "bg-[var(--app-surface-soft)] text-muted-foreground",
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
  const { allAnnouncements = [], publish, deactivate, isLoading } = useAnnouncements();
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_FORM);

  const usersQuery = useQuery({
    queryKey: ["admin-announcement-users"],
    queryFn: async () => {
      const users = await adminAPI.listUsers();
      return users
        .filter((user) => user.is_active === true)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))) as UserOption[];
    },
    staleTime: 60_000,
  });

  const usersById = useMemo(() => {
    const map = new Map<string, UserOption>();
    (usersQuery.data || []).forEach((user) => map.set(user.id, user));
    return map;
  }, [usersQuery.data]);

  const updateForm = <K extends keyof AnnouncementForm>(key: K, value: AnnouncementForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handlePublish = async () => {
    const message = form.message.trim();
    const startsAt = toIsoFromLocalInput(form.startsAt);
    const endsAt = toIsoFromLocalInput(form.endsAt);
    const displayDurationSeconds = Number(form.displayDurationSeconds || 0);

    if (!message) {
      toast.error("Escreva o comunicado antes de publicar.");
      return;
    }

    if (form.targetType === "specific" && !form.targetUserId) {
      toast.error("Escolha o usuário que deve receber o comunicado.");
      return;
    }

    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      toast.error("O término precisa ser depois do início.");
      return;
    }

    await publish.mutateAsync({
      message,
      buttonText: form.buttonText.trim() || undefined,
      buttonUrl: form.buttonUrl.trim() || undefined,
      showBanner: form.showBanner,
      sendNotification: form.sendNotification,
      targetType: form.targetType,
      targetUserIds: form.targetType === "specific" ? [form.targetUserId] : [],
      startsAt,
      endsAt,
      displayDurationSeconds: displayDurationSeconds > 0 ? displayDurationSeconds : null,
    });

    setForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-4">
      <section className="app-card overflow-hidden">
        <div className="bg-[#FF4529] px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <Megaphone className="h-5 w-5 shrink-0" strokeWidth={1.8} />
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Faixa superior rotativa</h2>
              <p className="truncate text-sm text-white/80">Comunicados exibidos apenas para usuários logados.</p>
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
                placeholder="Ex: Hoje teremos manutenção programada às 22h."
                className="min-h-24 border-0 bg-[var(--app-surface-soft)]"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Destino</Label>
                <Select
                  value={form.targetType}
                  onValueChange={(value) => updateForm("targetType", value as AnnouncementTargetType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="brokers">Corretores</SelectItem>
                    <SelectItem value="specific">Usuário específico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label className="app-card-soft flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm">Faixa no topo</span>
                <Switch checked={form.showBanner} onCheckedChange={(checked) => updateForm("showBanner", checked)} />
              </label>
            </div>

            {form.targetType === "specific" ? (
              <div className="space-y-2">
                <Label>Usuário</Label>
                <Select
                  value={form.targetUserId || "none"}
                  onValueChange={(value) => updateForm("targetUserId", value === "none" ? "" : value)}
                  disabled={usersQuery.isLoading}
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
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Começa em</Label>
                <Input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => updateForm("startsAt", event.target.value)}
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
                  onValueChange={(value) => updateForm("displayDurationSeconds", value)}
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
                  onChange={(event) => updateForm("buttonText", event.target.value)}
                  placeholder="Ver detalhes"
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>URL do botão</Label>
                <Input
                  value={form.buttonUrl}
                  onChange={(event) => updateForm("buttonUrl", event.target.value)}
                  placeholder="https://..."
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-white/[0.045] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-3 text-sm text-muted-foreground">
                <Switch
                  checked={form.sendNotification}
                  onCheckedChange={(checked) => updateForm("sendNotification", checked)}
                />
                Enviar também como notificação
              </label>
              <Button
                className="bg-[#FF4529] text-white hover:bg-[#FF4529]/90"
                onClick={handlePublish}
                disabled={publish.isPending}
              >
                {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publicar comunicado
              </Button>
            </div>
          </div>

          <aside className="rounded-[6px] bg-[var(--app-surface-soft)] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Prévia</p>
            <div className="mt-3 overflow-hidden rounded-[6px] bg-[#FF4529] text-white shadow-sm">
              <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-sm">
                <Megaphone className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                <p className="min-w-0 flex-1 truncate font-medium">
                  {form.message.trim() || "Seu comunicado aparece aqui em uma linha rotativa."}
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
                <DurationLabel seconds={Number(form.displayDurationSeconds) || null} />
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Comunicados programados</h2>
            <p className="text-sm text-muted-foreground">{allAnnouncements.length} registros exibidos</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : allAnnouncements.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Nenhum comunicado criado ainda.</div>
        ) : (
          <div className="divide-y divide-white/[0.045]">
            {allAnnouncements.map((announcement) => {
              const targetUsers = (announcement.target_user_ids || [])
                .map((id) => usersById.get(id))
                .filter((user): user is UserOption => Boolean(user));

              return (
                <div key={announcement.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_180px_220px_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StateBadge announcement={announcement} />
                      <Badge variant="outline" className="border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                        {TARGET_LABELS[announcement.target_type] || announcement.target_type}
                      </Badge>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium">{announcement.message}</p>
                    {targetUsers.length > 0 ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {targetUsers.map(getUserLabel).join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p>{formatDateTime(announcement.starts_at) === "--" ? "Imediato" : formatDateTime(announcement.starts_at)}</p>
                    <p>{formatDateTime(announcement.ends_at) === "--" ? "Sem término" : formatDateTime(announcement.ends_at)}</p>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <DurationLabel seconds={announcement.display_duration_seconds} />
                  </div>

                  <Button
                    variant="outline"
                    className="border-0 bg-[var(--app-surface-soft)]"
                    onClick={() => deactivate.mutate(announcement.id)}
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
    </div>
  );
}
