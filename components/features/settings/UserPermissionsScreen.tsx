'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/shared/layout/AppLayout'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
import { useOrganizationUsers } from '@/hooks/use-users'
import {
  useReplaceUserPermissions,
  useResetUserPermissions,
  useUserPermissionsAdmin,
} from '@/hooks/use-user-permissions-admin'

const domainLabels: Record<string, string> = {
  dashboard: 'Dashboards',
  leads: 'Leads e contatos',
  crm: 'CRM',
  conversations: 'Conversas e WhatsApp',
  management: 'Gestão',
  properties: 'Imóveis',
  schedule: 'Agenda',
  automations: 'Automações',
  financial: 'Financeiro',
  gamification: 'Gamificação',
  settings: 'Configurações',
}

const profileLabels: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  manager: 'Gerente',
  leader: 'Líder',
  user: 'Usuário padrão',
}

function userInitials(name?: string) {
  return (name ?? 'Usuário')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default function UserPermissionsScreen({ userId }: { userId: string }) {
  const { data: users = [] } = useOrganizationUsers()
  const { data, isLoading, error } = useUserPermissionsAdmin(userId)
  const replacePermissions = useReplaceUserPermissions(userId)
  const resetPermissions = useResetUserPermissions(userId)
  const [editedValues, setEditedValues] = useState<Record<string, boolean> | null>(null)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const user = users.find((candidate) => candidate.id === userId)
  const values = editedValues ?? Object.fromEntries(
    (data?.permissions ?? []).map((permission) => [permission.key, permission.allowed]),
  )

  const groups = useMemo(() => {
    if (!data) return []
    const grouped = new Map<string, typeof data.permissions>()
    for (const permission of data.permissions) {
      grouped.set(permission.domain, [...(grouped.get(permission.domain) ?? []), permission])
    }
    return Array.from(grouped.entries())
  }, [data])

  const handleSave = async () => {
    try {
      await replacePermissions.mutateAsync(values)
      setEditedValues(null)
      toast.success('Permissões atualizadas.')
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Não foi possível atualizar as permissões.')
    }
  }

  const handleReset = async () => {
    try {
      await resetPermissions.mutateAsync()
      setEditedValues(null)
      setResetDialogOpen(false)
      toast.success('Permissões restauradas para o padrão.')
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Não foi possível restaurar as permissões.')
    }
  }

  return (
    <AppLayout title="Permissões do usuário">
      <div className="mx-auto w-full max-w-6xl space-y-4 px-0 py-4 sm:px-4 md:space-y-5 md:px-6 md:py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted/45 px-4 py-4 md:px-5">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Voltar para usuários">
              <Link href="/settings?tab=team"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <Avatar className="h-11 w-11 shrink-0 md:h-12 md:w-12">
              <AvatarImage src={user?.avatar_url ?? undefined} alt={user?.name ?? 'Usuário'} />
              <AvatarFallback className="bg-primary/50 text-sm font-light text-primary-foreground">
                {userInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-normal">{user?.name ?? 'Usuário'}</h1>
              <p className="truncate text-sm text-foreground/60">{user?.email ?? 'E-mail não informado'}</p>
            </div>
          </div>
          {data && (
            <Badge className="rounded-md border-0 bg-primary px-3 py-1 text-primary-foreground hover:bg-primary">
              {profileLabels[data.profile] ?? data.profile}
            </Badge>
          )}
        </div>

        {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {error && <p className="py-12 text-center text-sm text-destructive">Não foi possível carregar as permissões.</p>}

        {data?.locked && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/45 px-4 py-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <p className="text-sm">Administradores possuem acesso total e não podem ter permissões individuais removidas.</p>
          </div>
        )}

        {!data?.locked && (
          <div className="columns-1 gap-4 lg:columns-2">
            {groups.map(([domain, permissions]) => (
              <section key={domain} className="mb-3 break-inside-avoid rounded-[8px] bg-muted/40 p-3 md:mb-4 md:p-4">
                <h2 className="px-2 pb-2 text-[14px] font-normal text-foreground/80">{domainLabels[domain] ?? domain}</h2>
                <div className="space-y-1">
                  {permissions.map((permission) => (
                    <div key={permission.key} className="flex min-h-16 items-center justify-between gap-4 rounded-md px-2 py-2.5 transition-colors hover:bg-background/60">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{permission.label}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{permission.description}</p>
                      </div>
                      <Switch
                        className="shrink-0"
                        checked={values[permission.key] ?? false}
                        onCheckedChange={(checked) => setEditedValues({ ...values, [permission.key]: checked })}
                        aria-label={permission.label}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {data && !data.locked && (
          <div className="flex flex-col-reverse justify-end gap-2 pb-2 pt-1 sm:flex-row">
            <Button variant="ghost" className="bg-muted/50 hover:bg-muted" onClick={() => setResetDialogOpen(true)} disabled={resetPermissions.isPending || replacePermissions.isPending}>
              <RotateCcw className="mr-2 h-4 w-4" />Restaurar padrão
            </Button>
            <Button onClick={handleSave} disabled={editedValues === null || replacePermissions.isPending || resetPermissions.isPending}>
              {replacePermissions.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar
            </Button>
          </div>
        )}

        <AlertDialog
          open={resetDialogOpen}
          onOpenChange={(open) => {
            if (!open && resetPermissions.isPending) return
            setResetDialogOpen(open)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Restaurar permissões padrão?</AlertDialogTitle>
              <AlertDialogDescription>
                Todas as exceções individuais deste usuário serão removidas e o acesso voltará a seguir o perfil atual.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetPermissions.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault()
                  void handleReset()
                }}
                disabled={resetPermissions.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {resetPermissions.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Restaurar padrão
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  )
}
