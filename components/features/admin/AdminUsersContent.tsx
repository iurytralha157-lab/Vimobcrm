"use client";

import { useMemo, useState, type ReactNode } from "react";
import { KeyRound, Loader2, Power, ShieldCheck, UserPlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { VimobLoader } from "@/components/shared/loading";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAdminOrganizationsList } from "@/hooks/use-admin-organizations";
import { adminAPI } from "@/lib/api/admin";
import { normalizeSearchText } from "@/lib/search-text";
import { cn } from "@/lib/utils";
import { adminInvitationInputSchema } from "@/lib/validation";
import { AdminWarning, EmptyState } from "@/components/features/admin/AdminPrimitives";
import { AdminToolbar } from "@/components/features/admin/AdminToolbar";
import {
  formatDate,
  formatFieldValue,
  formatRecordsCount,
  getErrorMessage,
  getInitials,
  getOptionalString,
  getString,
  normalizeText,
  StatusBadge,
  type AdminRecord,
} from "@/components/features/admin/admin-display";
import { useAdminUsersList } from "@/components/features/admin/admin-queries";

function getOrganizationName(user: AdminRecord, organizationsById: Map<string, AdminRecord>) {
  const organizationId = getOptionalString(user, "organization_id");
  if (!organizationId) return "Plataforma";
  const organization = organizationsById.get(organizationId);
  return getString(organization, "name", "Organização não encontrada");
}

function UserMetaTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2", className)}>
      <p className="text-[9px] font-light text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs font-normal">{value}</p>
    </div>
  );
}

export function UsersRowsPreview({
  title,
  rows,
  organizationsById,
  empty,
  createOrganizationId,
  isLoading = false,
  errorMessage,
  renderActions = (user) => <AdminUserActions user={user} />,
}: {
  title: string;
  rows: AdminRecord[];
  organizationsById: Map<string, AdminRecord>;
  empty: string;
  createOrganizationId?: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  renderActions?: (user: AdminRecord) => ReactNode;
}) {
  const headerAction = createOrganizationId ? (
    <CreateOrganizationUserDialog organizationId={createOrganizationId} />
  ) : null;

  if (isLoading) {
    return (
      <div className="app-card flex min-h-[220px] items-center justify-center p-4">
        <VimobLoader label="Carregando usuários..." />
      </div>
    );
  }

  if (errorMessage) return null;

  if (rows.length === 0) {
    if (!headerAction) {
      return <EmptyState title={title} description={empty} />;
    }

    return (
      <div className="app-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] p-4">
          <div>
            <h2 className="text-base font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{formatRecordsCount(0)}</p>
          </div>
          {headerAction}
        </div>
        <div className="flex min-h-[220px] flex-col items-center justify-center p-8 text-center">
          <ShieldCheck className="mb-4 h-10 w-10 text-muted-foreground/50" />
          <h3 className="text-base font-medium">{title}</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{empty}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] p-4">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">{formatRecordsCount(rows.length)}</p>
        </div>
        {headerAction}
      </div>

      <div className={cn(
        "hidden gap-4 border-b border-[var(--app-border)] px-4 py-3 text-[10px] font-light text-muted-foreground lg:grid",
        "grid-cols-[minmax(240px,1.5fr)_120px_100px_minmax(160px,1fr)_130px_150px]",
      )}>
        <span>Usuário</span>
        <span>Perfil</span>
        <span>Status</span>
        <span>Organização</span>
        <span>Criado em</span>
        <span>Ações</span>
      </div>

      <div className="divide-y divide-[var(--app-border)]">
        {rows.map((user, index) => {
          const id = getString(user, "id", String(index));
          const name = getString(user, "name", "Usuário sem nome");
          const email = getString(user, "email", "E-mail não informado");
          const avatarUrl = getOptionalString(user, "avatar_url");
          const organizationName = getOrganizationName(user, organizationsById);
          const roleLabel = formatFieldValue(user, "role");
          const createdAt = formatDate(user.created_at);

          return (
            <div
              key={id}
              className="transition-colors hover:bg-[var(--app-surface-hover)]"
            >
              <div className="p-4 lg:hidden">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0 border border-[var(--app-border)]">
                    {avatarUrl ? <AvatarImage src={avatarUrl} className="object-cover" /> : <AvatarImage src={undefined} />}
                    <AvatarFallback className="bg-primary/12 text-xs font-medium text-primary">
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>
                  </div>
                  <StatusBadge value={user.is_active !== false} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <UserMetaTile label="Perfil" value={roleLabel} />
                  <UserMetaTile label="Criado em" value={createdAt} />
                  <UserMetaTile label="Organização" value={organizationName} className="col-span-2" />
                </div>
                <div className="mt-3 flex justify-end">
                  {renderActions(user)}
                </div>
              </div>

              <div className={cn(
                "hidden gap-4 px-4 py-3 lg:grid lg:items-center",
                "lg:grid-cols-[minmax(240px,1.5fr)_120px_100px_minmax(160px,1fr)_130px_150px]",
              )}>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9 shrink-0 border border-[var(--app-border)]">
                    {avatarUrl ? <AvatarImage src={avatarUrl} className="object-cover" /> : <AvatarImage src={undefined} />}
                    <AvatarFallback className="bg-primary/12 text-xs font-medium text-primary">
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{email}</p>
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm">{roleLabel}</p>
                </div>

                <div className="min-w-0">
                  <StatusBadge value={user.is_active !== false} />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm">{organizationName}</p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm text-muted-foreground">{createdAt}</p>
                </div>

                <div className="flex justify-end">
                  {renderActions(user)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminUserActions({ user }: { user: AdminRecord }) {
  const queryClient = useQueryClient();
  const userId = getOptionalString(user, "id") || "";
  const isActive = user.is_active !== false;

  const invalidateUsers = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-rows", "users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-users-list"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-organizations-list"] }),
    ]);
  };

  const toggleStatus = useMutation({
    mutationFn: async () => adminAPI.updateUser({ userId, is_active: !isActive }),
    onSuccess: async () => {
      toast.success(isActive ? "Usuário inativado." : "Usuário reativado.");
      await invalidateUsers();
    },
    onError: (error) => {
      toast.error(`Erro ao alterar usuário: ${getErrorMessage(error)}`);
    },
  });

  const resetPassword = useMutation({
    mutationFn: async () => adminAPI.resetUserPassword(userId),
    onSuccess: (result) => {
      const email = getString(result, "email", getString(user, "email", ""));
      toast.success(email
        ? `Enviamos o link de recuperação para ${email}.`
        : "Enviamos o link de recuperação por e-mail.");
    },
    onError: (error) => {
      toast.error(`Erro ao resetar senha: ${getErrorMessage(error)}`);
    },
  });

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] shadow-none"
          onClick={() => resetPassword.mutate()}
          disabled={!userId || resetPassword.isPending || toggleStatus.isPending}
          aria-label="Resetar senha"
          title="Resetar senha"
        >
          {resetPassword.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] shadow-none"
          onClick={() => toggleStatus.mutate()}
          disabled={!userId || resetPassword.isPending || toggleStatus.isPending}
          aria-label={isActive ? "Inativar usuário" : "Reativar usuário"}
          title={isActive ? "Inativar usuário" : "Reativar usuário"}
        >
          {toggleStatus.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className={cn("h-3.5 w-3.5", isActive ? "text-amber-400" : "text-emerald-400")} />}
        </Button>
      </div>

    </>
  );
}

function CreateOrganizationUserDialog({ organizationId }: { organizationId?: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    role: "user" as "admin" | "user",
  });
  const invitationInput = {
    email: form.email.trim(),
    role: form.role,
    organizationId,
  };
  const invitationValidation = adminInvitationInputSchema.safeParse(invitationInput);
  const emailInvalid = Boolean(form.email.trim()) && !invitationValidation.success;

  const resetForm = () => {
    setForm({ email: "", role: "user" });
  };

  const createUser = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("Organização não informada.");
      const validated = adminInvitationInputSchema.parse(invitationInput);
      return adminAPI.createInvitation(validated);
    },
    onSuccess: async (result) => {
      toast.success(result.email_sent === false
        ? "Convite criado, mas o e-mail não foi enviado. Use Reenviar quando o serviço normalizar."
        : "Convite enviado por e-mail.");
      setOpen(false);
      resetForm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-rows", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-list"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organizations-list"] }),
        queryClient.invalidateQueries({ queryKey: ["invitations"] }),
      ]);
    },
    onError: (error) => {
      toast.error(`Erro ao criar usuário: ${getErrorMessage(error)}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (createUser.isPending) return;
      setOpen(nextOpen);
      if (!nextOpen) resetForm();
    }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          className="h-9 shrink-0 gap-2 rounded-[6px] bg-primary px-3 font-light text-primary-foreground shadow-none hover:bg-primary/90"
          aria-label="Adicionar novo usuário"
        >
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo usuário</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-[8px] border-0 p-0">
        <DialogHeader className="border-b border-[var(--app-border)] px-4 py-3">
        <DialogTitle>Convidar usuário</DialogTitle>
      </DialogHeader>

        <div className="grid gap-3 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            O usuário receberá um link seguro, confirmará o e-mail e definirá a própria senha.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-light">E-mail</span>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  disabled={createUser.isPending}
                  aria-invalid={emailInvalid}
                  className="border-0 bg-[var(--app-surface-soft)]"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-light">Perfil</span>
                <select
                  value={form.role}
                  onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "admin" | "user" }))}
                  disabled={createUser.isPending}
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none"
                >
                  <option value="user">Usuário</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
          </div>
        </div>

        <DialogFooter className="border-t border-[var(--app-border)] px-4 py-3">
          <Button
            variant="outline"
            className="rounded-[6px] border-0 bg-[var(--app-surface-soft)] shadow-none"
            onClick={() => setOpen(false)}
            disabled={createUser.isPending}
          >
            Fechar
          </Button>
          <Button
            className="rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
            onClick={() => createUser.mutate()}
            disabled={createUser.isPending || !organizationId || !invitationValidation.success}
          >
            {createUser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Enviar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminUsersContent() {
  const [search, setSearch] = useState("");
  const users = useAdminUsersList();
  const organizations = useAdminOrganizationsList();
  const rows = users.data?.data || [];
  const organizationRows = useMemo(
    () => (organizations.data || []) as unknown as AdminRecord[],
    [organizations.data],
  );
  const organizationsErrorMessage = organizations.error ? getErrorMessage(organizations.error) : null;
  const organizationsById = useMemo(() => {
    return new Map(organizationRows.map((org) => [getString(org, "id"), org]));
  }, [organizationRows]);
  const filteredRows = rows.filter((user) => {
    const organizationName = getOrganizationName(user, organizationsById);
    const haystack = [user.name, user.email, user.role, user.organization_id, organizationName].map(normalizeText).join(" ");
    return haystack.includes(normalizeSearchText(search));
  });

  return (
    <div className="space-y-4">
      <AdminWarning message={users.data?.errorMessage || organizationsErrorMessage} />
      <AdminToolbar search={search} onSearch={setSearch} placeholder="Buscar usuário, e-mail, papel ou organização..." />
      <UsersRowsPreview
        title="Usuários da plataforma"
        rows={filteredRows}
        organizationsById={organizationsById}
        isLoading={users.isPending || organizations.isLoading}
        errorMessage={users.data?.errorMessage || organizationsErrorMessage}
        empty="Nenhum usuário retornado pelo Supabase conectado."
      />
    </div>
  );
}
