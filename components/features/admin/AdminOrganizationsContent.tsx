"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, Power, Trash2 } from "lucide-react";

import { VimobLoader } from "@/components/shared/loading";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAdminOrganizationActions,
  useAdminOrganizationsList,
  type AdminOrganization,
} from "@/hooks/use-admin-organizations";
import { normalizeSearchText } from "@/lib/search-text";
import { AdminWarning, EmptyState } from "@/components/features/admin/AdminPrimitives";
import { AdminToolbar } from "@/components/features/admin/AdminToolbar";
import { AdminUserActions, UsersRowsPreview } from "@/components/features/admin/AdminUsersContent";
import {
  formatDate,
  formatFieldValue,
  formatNumber,
  getErrorMessage,
  getOrganizationStatus,
  getString,
  MiniInfo,
  normalizeText,
  StatusBadge,
  type AdminRecord,
} from "@/components/features/admin/admin-display";
import { useAdminRows } from "@/components/features/admin/admin-queries";

function OrganizationListActions({ organization }: { organization: AdminOrganization }) {
  const { toggleStatus } = useAdminOrganizationActions();
  const nextActiveStatus = !organization.is_active;
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
            aria-label={`Ações de ${organization.name}`}
            title="Ações da organização"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52 rounded-[8px] border-0">
          <DropdownMenuItem
            className="cursor-pointer rounded-[4px]"
            disabled={toggleStatus.isPending}
            onSelect={() => toggleStatus.mutate({ id: organization.id, isActive: nextActiveStatus })}
          >
            {toggleStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            {nextActiveStatus ? "Reativar organização" : "Desativar organização"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer rounded-[4px] text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Excluir permanentemente
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <OrganizationDeleteDialog
        organizationId={organization.id}
        organizationName={organization.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}

export function OrganizationDeleteDialog({
  organizationId,
  organizationName,
  open,
  onOpenChange,
  onDeleted,
}: {
  organizationId: string;
  organizationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const [confirmationName, setConfirmationName] = useState("");
  const queryClient = useQueryClient();
  const { deleteOrganization } = useAdminOrganizationActions();
  const confirmed = confirmationName.trim() === organizationName.trim();

  const handleOpenChange = (nextOpen: boolean) => {
    if (deleteOrganization.isPending) return;
    if (!nextOpen) setConfirmationName("");
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    if (!confirmed) return;
    try {
      await deleteOrganization.mutateAsync({
        id: organizationId,
        confirmationName: confirmationName.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
      setConfirmationName("");
      onOpenChange(false);
      onDeleted?.();
    } catch {
      // Toast is handled by the mutation hook; keep the dialog open for retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg rounded-[8px] border-0"
        onEscapeKeyDown={(event) => {
          if (deleteOrganization.isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (deleteOrganization.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Excluir organização permanentemente
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-[8px] bg-destructive/10 p-4 text-sm text-destructive">
            <p className="font-medium">Esta ação é irreversível.</p>
            <p className="mt-1 text-foreground/75">
              Leads, imóveis, site, arquivos, agendas, WhatsApp, integrações, requisições e usuários exclusivos
              desta organização serão removidos.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`delete-organization-${organizationId}`}>
              Digite <span className="font-medium">{organizationName}</span> para confirmar
            </Label>
            <Input
              id={`delete-organization-${organizationId}`}
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              disabled={deleteOrganization.isPending}
              autoComplete="off"
              className="rounded-[6px] border-0 bg-[var(--app-surface-soft)]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={deleteOrganization.isPending}
            className="rounded-[6px] border-0"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleDelete}
            disabled={!confirmed || deleteOrganization.isPending}
            className="rounded-[6px] border-0 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteOrganization.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Excluir todos os dados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminOrganizationsContent() {
  const [search, setSearch] = useState("");
  const organizations = useAdminOrganizationsList();
  const rows = organizations.data || [];
  const organizationErrorMessage = organizations.error ? getErrorMessage(organizations.error) : null;
  const filteredRows = rows.filter((org) => {
    const haystack = [org.name, org.email, org.cnpj, org.plan_name, org.subscription_status].map(normalizeText).join(" ");
    return haystack.includes(normalizeSearchText(search));
  });

  return (
    <div className="space-y-4">
      <AdminWarning message={organizationErrorMessage} />
      <AdminToolbar search={search} onSearch={setSearch} placeholder="Buscar organização, plano, CNPJ ou status..." />
      {organizations.isLoading ? (
        <div className="flex min-h-[280px] items-center justify-center">
          <VimobLoader label="Carregando organizações..." />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map((org) => (
            <div key={org.id} className="app-card card-hover p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/admin/organizations/${org.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{org.name || "Organização sem nome"}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{org.email || "E-mail não informado"}</p>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge
                    value={org.is_active === false ? "inactive" : org.subscription_status || "active"}
                    activeLabel="Ativa"
                  />
                  <OrganizationListActions organization={org} />
                </div>
              </div>
              <Link href={`/admin/organizations/${org.id}`} className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <MiniInfo label="Plano" value={org.plan_name || "Sem plano"} />
                <MiniInfo label="Usuários cadastrados" value={formatNumber(org.user_count)} />
                <MiniInfo label="CNPJ" value={org.cnpj || "--"} />
                <MiniInfo label="Criada em" value={formatDate(org.created_at)} />
              </Link>
            </div>
          ))}
        </div>
      )}
      {!organizations.isLoading && !organizationErrorMessage && filteredRows.length === 0 && (
        <EmptyState
          title="Nenhuma organização na listagem"
          description="Nenhuma organização corresponde aos filtros informados."
        />
      )}
    </div>
  );
}

export function OrganizationDetailContent({ organizationId }: { organizationId?: string }) {
  const organizations = useAdminRows("organizations", 200);
  const users = useAdminRows("users", 200);
  const organizationRows = useMemo(() => organizations.data?.data || [], [organizations.data?.data]);
  const organization = organizationRows.find((org) => getString(org, "id") === organizationId);
  const orgUsers = (users.data?.data || []).filter((user) => getString(user, "organization_id") === organizationId);
  const organizationsById = useMemo(() => {
    return new Map(organizationRows.map((org) => [getString(org, "id"), org]));
  }, [organizationRows]);

  if (!organization && organizations.isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <VimobLoader label="Carregando organização..." />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="space-y-4">
        <AdminWarning message={organizations.data?.errorMessage} />
        <EmptyState
          title="Organização não encontrada"
          description="A rota existe, mas a organização não foi retornada pelo Supabase conectado."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="app-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-light text-muted-foreground">Organização</p>
            <h2 className="mt-2 text-sm font-normal">{getString(organization, "name")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{getString(organization, "email", "E-mail não informado")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={getOrganizationStatus(organization)} activeLabel="Ativa" />
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MiniInfo label="CNPJ" value={getString(organization, "cnpj", "--")} />
          <MiniInfo label="Segmento" value={formatFieldValue(organization, "segment")} />
          <MiniInfo label="WhatsApp" value={getString(organization, "whatsapp", "--")} />
          <MiniInfo label="Criada em" value={formatDate(organization.created_at)} />
        </div>
      </div>

      <UsersRowsPreview
        title="Usuários vinculados"
        rows={orgUsers}
        organizationsById={organizationsById}
        createOrganizationId={organizationId}
        renderActions={(user) => <AdminUserActions user={user} />}
        empty="Nenhum usuário retornado para esta organização."
      />
    </div>
  );
}
