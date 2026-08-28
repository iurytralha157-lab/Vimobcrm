'use client'

import {
  useId,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  ImageIcon,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  HOME_PAGE_SECTIONS,
  HOME_PUBLICATION_CTA_OPTIONS,
} from '@/components/features/home/home-catalog'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  useAdminHomePublications,
  useCreateHomePublication,
  useDeleteHomePublication,
  useDeleteHomePublicationImage,
  useHomePublicationOrganizations,
  useHomePublicationUsers,
  useReorderHomePublications,
  useUpdateHomePublication,
  useUploadHomePublicationImage,
  type HomeAudienceOption,
} from '@/hooks/home'
import type {
  CreateHomePublicationInput,
  HomePublication,
  HomePublicationAccent,
  HomePublicationCardSize,
  HomePublicationTargetRole,
  HomePublicationTargetType,
} from '@/lib/api/home'
import { createHomePublicationInputSchema } from '@/lib/validation/home'
import { cn } from '@/lib/utils'

const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const CARD_SIZE_OPTIONS: Array<{
  value: HomePublicationCardSize
  label: string
  description: string
}> = [
  { value: 'wide', label: 'Destaque', description: 'Ocupa toda a largura' },
  { value: 'half', label: 'Médio', description: 'Duas colunas no desktop' },
  { value: 'compact', label: 'Compacto', description: 'Três colunas no desktop' },
]

const ACCENT_OPTIONS: Array<{
  value: HomePublicationAccent
  label: string
  color: string
  textColor: string
}> = [
  { value: 'orange', label: 'Laranja', color: 'bg-primary', textColor: 'text-primary' },
  { value: 'violet', label: 'Violeta', color: 'bg-violet-500', textColor: 'text-violet-500' },
  { value: 'blue', label: 'Azul', color: 'bg-blue-500', textColor: 'text-blue-500' },
  { value: 'emerald', label: 'Verde', color: 'bg-emerald-500', textColor: 'text-emerald-500' },
  { value: 'amber', label: 'Âmbar', color: 'bg-amber-500', textColor: 'text-amber-500' },
  { value: 'slate', label: 'Cinza', color: 'bg-slate-500', textColor: 'text-slate-500' },
]

const TARGET_TYPE_OPTIONS: Array<{
  value: HomePublicationTargetType
  label: string
  description: string
}> = [
  { value: 'all', label: 'Todos', description: 'Todos os usuários autenticados' },
  { value: 'organizations', label: 'Organizações', description: 'Somente empresas escolhidas' },
  { value: 'users', label: 'Usuários', description: 'Pessoas específicas' },
  { value: 'roles', label: 'Perfis', description: 'Por função na organização' },
]

const ROLE_OPTIONS: Array<{
  value: HomePublicationTargetRole
  label: string
}> = [
  { value: 'admin', label: 'Administrador' },
  { value: 'user', label: 'Usuário' },
]

type PublicationForm = {
  title: string
  body: string
  ctaLabel: string
  ctaHref: CreateHomePublicationInput['ctaHref']
  cardSize: HomePublicationCardSize
  accent: HomePublicationAccent
  displayOrder: number
  isActive: boolean
  startsAt: string
  endsAt: string
  targetType: HomePublicationTargetType
  targetOrganizationIds: string[]
  targetUserIds: string[]
  targetRoles: HomePublicationTargetRole[]
}

function createEmptyForm(displayOrder: number): PublicationForm {
  return {
    title: '',
    body: '',
    ctaLabel: 'Abrir pipeline',
    ctaHref: '/crm/pipelines',
    cardSize: 'half',
    accent: 'orange',
    displayOrder,
    isActive: true,
    startsAt: '',
    endsAt: '',
    targetType: 'all',
    targetOrganizationIds: [],
    targetUserIds: [],
    targetRoles: [],
  }
}

function toLocalDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function toPublicationForm(publication: HomePublication): PublicationForm {
  return {
    title: publication.title,
    body: publication.body,
    ctaLabel: publication.ctaLabel,
    ctaHref: publication.ctaHref,
    cardSize: publication.cardSize,
    accent: publication.accent,
    displayOrder: publication.displayOrder,
    isActive: publication.isActive,
    startsAt: toLocalDateTime(publication.startsAt),
    endsAt: toLocalDateTime(publication.endsAt),
    targetType: publication.targetType,
    targetOrganizationIds: publication.targetOrganizationIds,
    targetUserIds: publication.targetUserIds,
    targetRoles: publication.targetRoles,
  }
}

function localDateTimeToISO(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function getPublicationStatus(publication: HomePublication) {
  const now = Date.now()
  const channelDisabled = !HOME_PAGE_SECTIONS.publications

  if (!publication.isActive) {
    return {
      label: channelDisabled ? 'Rascunho pausado' : 'Pausada',
      className: 'bg-slate-500/10 text-slate-500',
    }
  }
  if (publication.startsAt && new Date(publication.startsAt).getTime() > now) {
    return {
      label: channelDisabled ? 'Rascunho agendado' : 'Agendada',
      className: 'bg-blue-500/10 text-blue-500',
    }
  }
  if (publication.endsAt && new Date(publication.endsAt).getTime() <= now) {
    return {
      label: channelDisabled ? 'Rascunho encerrado' : 'Encerrada',
      className: 'bg-amber-500/10 text-amber-600',
    }
  }
  return {
    label: channelDisabled ? 'Rascunho pronto' : 'Publicada',
    className: channelDisabled
      ? 'bg-slate-500/10 text-slate-600'
      : 'bg-emerald-500/10 text-emerald-500',
  }
}

function getAudienceLabel(publication: HomePublication) {
  if (publication.targetType === 'all') return 'Todos os usuários'
  if (publication.targetType === 'organizations') {
    return `${publication.targetOrganizationIds.length} organização(ões)`
  }
  if (publication.targetType === 'users') {
    return `${publication.targetUserIds.length} usuário(s)`
  }
  return `${publication.targetRoles.length} perfil(is)`
}

function formatSchedule(publication: HomePublication) {
  if (!publication.startsAt && !publication.endsAt) return 'Sem período definido'
  const format = (value: string) => new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  if (publication.startsAt && publication.endsAt) {
    return `${format(publication.startsAt)} → ${format(publication.endsAt)}`
  }
  if (publication.startsAt) return `A partir de ${format(publication.startsAt)}`
  return `Até ${format(publication.endsAt || '')}`
}

function AudiencePicker({
  label,
  options,
  selectedIds,
  isLoading,
  error,
  isRetrying = false,
  onRetry,
  onChange,
}: {
  label: string
  options: HomeAudienceOption[]
  selectedIds: string[]
  isLoading: boolean
  error?: unknown
  isRetrying?: boolean
  onRetry?: () => void
  onChange: (ids: string[]) => void
}) {
  const searchInputId = useId()
  const [search, setSearch] = useState('')
  const selected = new Set(selectedIds)
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR')
  const filteredOptions = options
    .filter((option) => {
      if (!normalizedSearch) return true
      return `${option.name} ${option.detail || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
    })
    .slice(0, 100)

  const toggle = (id: string) => {
    onChange(selected.has(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={searchInputId}>{label}</Label>
        <span className="text-xs text-muted-foreground">{selectedIds.length} selecionado(s)</span>
      </div>
      <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-2">
        <div className="flex items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            id={searchInputId}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpar busca"
              className="rounded-[4px] p-1 text-muted-foreground hover:bg-[var(--app-surface-hover)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <ScrollArea className="mt-2 h-44">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando público...
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center" role="alert">
              <p className="text-sm text-[var(--app-text-primary)]">Não foi possível carregar este público.</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 bg-[var(--app-surface-solid)]"
                disabled={isRetrying}
                onClick={onRetry}
              >
                {isRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Tentar novamente
              </Button>
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              Nenhum resultado encontrado.
            </div>
          ) : (
            <div className="space-y-1 pr-3">
              {filteredOptions.map((option) => {
                const checked = selected.has(option.id)
                return (
                  <button
                      key={option.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggle(option.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left transition',
                      checked
                        ? 'bg-primary/10 text-[var(--app-text-primary)]'
                        : 'hover:bg-[var(--app-surface-hover)]',
                    )}
                  >
                    <span className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-[var(--app-border)] bg-[var(--app-surface-solid)]',
                    )}>
                      {checked ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{option.name}</span>
                      {option.detail ? (
                        <span className="block truncate text-xs text-muted-foreground">{option.detail}</span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}

function PublicationListItem({
  publication,
  index,
  total,
  isReordering,
  onEdit,
  onDelete,
  onMove,
}: {
  publication: HomePublication
  index: number
  total: number
  isReordering: boolean
  onEdit: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const status = getPublicationStatus(publication)
  const accent = ACCENT_OPTIONS.find((option) => option.value === publication.accent)

  return (
    <article className="app-card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        <div
          className={cn(
            'relative h-28 shrink-0 overflow-hidden rounded-[8px] bg-gradient-to-br lg:h-24 lg:w-40',
            publication.accent === 'orange' && 'from-primary/25 to-primary/5',
            publication.accent === 'violet' && 'from-violet-500/25 to-violet-500/5',
            publication.accent === 'blue' && 'from-blue-500/25 to-blue-500/5',
            publication.accent === 'emerald' && 'from-emerald-500/25 to-emerald-500/5',
            publication.accent === 'amber' && 'from-amber-500/25 to-amber-500/5',
            publication.accent === 'slate' && 'from-slate-500/25 to-slate-500/5',
          )}
          style={publication.imageUrl
            ? {
                backgroundImage: `linear-gradient(135deg, rgba(15,23,42,.12), rgba(15,23,42,.5)), url(${JSON.stringify(publication.imageUrl)})`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
              }
            : undefined}
        >
          {!publication.imageUrl ? (
            <div className="flex h-full items-center justify-center">
              <Sparkles className={cn('h-8 w-8', accent?.textColor)} />
            </div>
          ) : null}
          <span className="absolute bottom-2 left-2 rounded-[4px] bg-[var(--app-overlay-strong)] px-2 py-1 text-[10px] font-normal text-[var(--app-on-media)]">
            {CARD_SIZE_OPTIONS.find((option) => option.value === publication.cardSize)?.label}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-normal">{publication.title}</h2>
            <Badge className={cn('border-0', status.className)}>{status.label}</Badge>
            {publication.imageUrl ? (
              <Badge className="border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
                <ImageIcon className="mr-1 h-3 w-3" />
                Com imagem
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{publication.body}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <UsersRound className="h-3.5 w-3.5" />
              {getAudienceLabel(publication)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatSchedule(publication)}
            </span>
            <span>Botão: {publication.ctaLabel}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 lg:justify-end">
          <div className="flex items-center rounded-[8px] bg-[var(--app-surface-soft)] p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={index === 0 || isReordering}
              onClick={() => onMove(-1)}
              aria-label={`Subir ${publication.title}`}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-7 text-center text-xs text-muted-foreground">{index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={index === total - 1 || isReordering}
              onClick={() => onMove(1)}
              aria-label={`Descer ${publication.title}`}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="border-0 bg-[var(--app-surface-soft)]" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-red-500 hover:bg-red-500/10 hover:text-red-500"
            onClick={onDelete}
            aria-label={`Excluir ${publication.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  )
}

export function HomePublicationsContent() {
  const publicationsQuery = useAdminHomePublications()
  const createPublication = useCreateHomePublication()
  const updatePublication = useUpdateHomePublication()
  const deletePublication = useDeleteHomePublication()
  const reorderPublications = useReorderHomePublications()
  const uploadImage = useUploadHomePublicationImage()
  const deleteImage = useDeleteHomePublicationImage()

  const publications = useMemo(
    () => (publicationsQuery.data || []).slice().sort((left, right) => (
      left.displayOrder - right.displayOrder
    )),
    [publicationsQuery.data],
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPublication, setEditingPublication] = useState<HomePublication | null>(null)
  const [publicationToDelete, setPublicationToDelete] = useState<HomePublication | null>(null)
  const [imageDeleteOpen, setImageDeleteOpen] = useState(false)
  const [form, setForm] = useState<PublicationForm>(() => createEmptyForm(10))

  const organizationsQuery = useHomePublicationOrganizations(
    dialogOpen && form.targetType === 'organizations',
  )
  const usersQuery = useHomePublicationUsers(
    dialogOpen && form.targetType === 'users',
  )

  const isSaving = createPublication.isPending || updatePublication.isPending
  const isImageSaving = uploadImage.isPending || deleteImage.isPending
  const readyCount = publications.filter((publication) => publication.isActive).length
  const scheduledCount = publications.filter((publication) => (
    Boolean(publication.startsAt || publication.endsAt)
  )).length

  const updateForm = <Key extends keyof PublicationForm>(
    key: Key,
    value: PublicationForm[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleDialogOpenChange = (open: boolean) => {
    if (!open && (isSaving || isImageSaving)) return
    setDialogOpen(open)
    if (!open) setImageDeleteOpen(false)
  }

  const openCreate = () => {
    const nextOrder = publications.length > 0
      ? Math.max(...publications.map((publication) => publication.displayOrder)) + 10
      : 10
    setEditingPublication(null)
    setForm(createEmptyForm(nextOrder))
    setDialogOpen(true)
  }

  const openEdit = (publication: HomePublication) => {
    setEditingPublication(publication)
    setForm(toPublicationForm(publication))
    setDialogOpen(true)
  }

  const changeTargetType = (targetType: HomePublicationTargetType) => {
    setForm((current) => ({
      ...current,
      targetType,
      targetOrganizationIds: [],
      targetUserIds: [],
      targetRoles: [],
    }))
  }

  const buildInput = (): CreateHomePublicationInput => ({
    title: form.title,
    body: form.body,
    ctaLabel: form.ctaLabel,
    ctaHref: form.ctaHref,
    cardSize: form.cardSize,
    accent: form.accent,
    displayOrder: form.displayOrder,
    isActive: form.isActive,
    startsAt: localDateTimeToISO(form.startsAt),
    endsAt: localDateTimeToISO(form.endsAt),
    targetType: form.targetType,
    targetOrganizationIds: form.targetType === 'organizations' ? form.targetOrganizationIds : [],
    targetUserIds: form.targetType === 'users' ? form.targetUserIds : [],
    targetRoles: form.targetType === 'roles' ? form.targetRoles : [],
  })

  const handleSave = async () => {
    if (isSaving || isImageSaving) return
    const input = buildInput()
    const result = createHomePublicationInputSchema.safeParse(input)
    if (!result.success) {
      toast.error(result.error.issues[0]?.message || 'Revise os campos do rascunho.')
      return
    }

    try {
      if (editingPublication) {
        const updated = await updatePublication.mutateAsync({
          id: editingPublication.id,
          input: result.data,
        })
        setEditingPublication(updated)
      } else {
        await createPublication.mutateAsync(result.data)
      }
      setDialogOpen(false)
    } catch {
      // Os hooks exibem a mensagem de erro.
    }
  }

  const movePublication = async (index: number, direction: -1 | 1) => {
    if (reorderPublications.isPending) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= publications.length) return
    const reordered = [...publications]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)

    try {
      await reorderPublications.mutateAsync({
        items: reordered.map((publication, publicationIndex) => ({
          id: publication.id,
          displayOrder: (publicationIndex + 1) * 10,
        })),
      })
    } catch {
      // Os hooks exibem a mensagem de erro.
    }
  }

  const handleDelete = async () => {
    if (!publicationToDelete || deletePublication.isPending) return
    const publicationId = publicationToDelete.id
    try {
      await deletePublication.mutateAsync(publicationId)
      setPublicationToDelete(null)
    } catch {
      // Os hooks exibem a mensagem de erro.
    }
  }

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !editingPublication) return
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      toast.error('Use uma imagem JPEG, PNG ou WebP.')
      return
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('A imagem deve ter no máximo 5 MB.')
      return
    }

    try {
      const updated = await uploadImage.mutateAsync({ id: editingPublication.id, file })
      setEditingPublication(updated)
    } catch {
      // Os hooks exibem a mensagem de erro.
    }
  }

  const handleImageDelete = async () => {
    if (!editingPublication?.imageUrl || isImageSaving) return
    const publicationId = editingPublication.id
    try {
      const result = await deleteImage.mutateAsync(publicationId)
      setEditingPublication(result.publication)
      setImageDeleteOpen(false)
    } catch {
      // Os hooks exibem a mensagem de erro.
    }
  }

  return (
    <div className="space-y-4">
      <section className="app-toolbar overflow-hidden">
        <div className="p-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <Badge className="border-0 bg-primary/10 text-primary">
                Canal da Home desativado
              </Badge>
              <h1 className="app-section-title mt-3">
                Rascunhos da Home
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Prepare blocos, público, ordem, botão e imagem. Enquanto o canal estiver
                desativado, nenhum destes itens aparece para os usuários.
              </p>
            </div>
            <Button
              onClick={openCreate}
              className="h-9 shrink-0 rounded-[6px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Novo rascunho
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-[var(--app-border)] bg-[var(--app-surface-soft)]">
          {[
            { label: 'Total', value: publications.length },
            { label: 'Prontos', value: readyCount },
            { label: 'Com período', value: scheduledCount },
          ].map((item) => (
            <div key={item.label} className="px-4 py-3 text-center">
              <p className="text-lg font-normal">{item.value}</p>
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {publicationsQuery.isLoading ? (
        <div className="app-card flex min-h-64 items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Carregando rascunhos...</span>
        </div>
      ) : publicationsQuery.error ? (
        <div className="app-card p-6 text-center" role="alert">
          <p className="text-sm font-normal">Não foi possível carregar os rascunhos.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {publicationsQuery.error instanceof Error ? publicationsQuery.error.message : 'Tente novamente.'}
          </p>
          <Button
            variant="outline"
            className="mt-4 border-0 bg-[var(--app-surface-soft)] shadow-none"
            disabled={publicationsQuery.isFetching}
            onClick={() => void publicationsQuery.refetch()}
          >
            {publicationsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {publicationsQuery.isFetching ? 'Tentando...' : 'Tentar novamente'}
          </Button>
        </div>
      ) : publications.length === 0 ? (
        <div className="app-card flex min-h-64 flex-col items-center justify-center p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-base font-normal">Nenhum rascunho criado</h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            Crie o primeiro bloco para apresentar um recurso, uma orientação ou uma novidade na página inicial.
          </p>
          <Button className="mt-4 bg-primary text-primary-foreground shadow-none hover:bg-primary/90" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Criar rascunho
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {publications.map((publication, index) => (
            <PublicationListItem
              key={publication.id}
              publication={publication}
              index={index}
              total={publications.length}
              isReordering={reorderPublications.isPending}
              onEdit={() => openEdit(publication)}
              onDelete={() => setPublicationToDelete(publication)}
              onMove={(direction) => movePublication(index, direction)}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="max-h-[94dvh] max-w-4xl overflow-y-auto rounded-[8px] p-0 shadow-none"
          aria-busy={isSaving || isImageSaving}
        >
          <DialogHeader className="sticky top-0 z-20 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-5 py-4">
            <DialogTitle className="text-base font-normal">
              {editingPublication ? 'Editar rascunho' : 'Novo rascunho'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Configure conteúdo, destino, período, público e imagem do bloco da Página Inicial.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="contents" disabled={isSaving || isImageSaving}>
            <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="home-publication-title">Título</Label>
                  <span className="text-[11px] text-muted-foreground">{form.title.length}/120</span>
                </div>
                <Input
                  id="home-publication-title"
                  value={form.title}
                  maxLength={120}
                  onChange={(event) => updateForm('title', event.target.value)}
                  placeholder="Ex.: Organize seus próximos contatos"
                  className="bg-[var(--app-surface-soft)]"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="home-publication-body">Texto</Label>
                  <span className="text-[11px] text-muted-foreground">{form.body.length}/1000</span>
                </div>
                <textarea
                  id="home-publication-body"
                  value={form.body}
                  maxLength={1000}
                  rows={5}
                  onChange={(event) => updateForm('body', event.target.value)}
                  placeholder="Explique de forma curta por que este conteúdo é útil."
                  className="w-full resize-y rounded-[8px] border-0 bg-[var(--app-surface-soft)] px-3 py-3 text-sm leading-6 outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="home-publication-cta-href">Destino do botão</Label>
                  <select
                    id="home-publication-cta-href"
                    value={form.ctaHref}
                    onChange={(event) => updateForm(
                      'ctaHref',
                      event.target.value as CreateHomePublicationInput['ctaHref'],
                    )}
                    className="h-10 w-full rounded-[8px] border-0 bg-[var(--app-surface-soft)] px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    {HOME_PUBLICATION_CTA_OPTIONS.map((option) => (
                      <option key={option.href} value={option.href}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="home-publication-cta-label">Texto do botão</Label>
                  <Input
                    id="home-publication-cta-label"
                    value={form.ctaLabel}
                    maxLength={40}
                    onChange={(event) => updateForm('ctaLabel', event.target.value)}
                    placeholder="Ex.: Abrir agenda"
                    className="bg-[var(--app-surface-soft)]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tamanho do bloco</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CARD_SIZE_OPTIONS.map((option) => {
                    const selected = form.cardSize === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => updateForm('cardSize', option.value)}
                        className={cn(
                          'rounded-[8px] border p-3 text-left transition-colors',
                          selected
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-[var(--app-border)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]',
                        )}
                      >
                        <span className="block text-sm font-normal">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Cor de destaque</Label>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_OPTIONS.map((option) => {
                    const selected = form.accent === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => updateForm('accent', option.value)}
                        className={cn(
                          'inline-flex h-9 items-center gap-2 rounded-[6px] border px-3 text-xs font-normal transition-colors',
                          selected
                            ? 'border-[var(--app-text-primary)] bg-[var(--app-surface-hover)]'
                            : 'border-[var(--app-border)] bg-[var(--app-surface-soft)]',
                        )}
                      >
                        <span className={cn('h-3 w-3 rounded-full', option.color)} aria-hidden="true" />
                        {option.label}
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Período de exibição</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-2 text-xs text-muted-foreground">
                    Início opcional
                    <Input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(event) => updateForm('startsAt', event.target.value)}
                      className="mt-2 bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]"
                    />
                  </label>
                  <label className="space-y-2 text-xs text-muted-foreground">
                    Encerramento opcional
                    <Input
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(event) => updateForm('endsAt', event.target.value)}
                      className="mt-2 bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Público</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TARGET_TYPE_OPTIONS.map((option) => {
                    const selected = form.targetType === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => changeTargetType(option.value)}
                        className={cn(
                          'rounded-[8px] border p-3 text-left transition-colors',
                          selected
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-[var(--app-border)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]',
                        )}
                      >
                        <span className="text-sm font-normal">{option.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
                      </button>
                    )
                  })}
                </div>

                {form.targetType === 'organizations' ? (
                  <AudiencePicker
                    label="Organizações autorizadas"
                    options={organizationsQuery.data || []}
                    selectedIds={form.targetOrganizationIds}
                    isLoading={organizationsQuery.isLoading}
                    error={organizationsQuery.error}
                    isRetrying={organizationsQuery.isFetching}
                    onRetry={() => void organizationsQuery.refetch()}
                    onChange={(ids) => updateForm('targetOrganizationIds', ids)}
                  />
                ) : null}

                {form.targetType === 'users' ? (
                  <AudiencePicker
                    label="Usuários autorizados"
                    options={usersQuery.data || []}
                    selectedIds={form.targetUserIds}
                    isLoading={usersQuery.isLoading}
                    error={usersQuery.error}
                    isRetrying={usersQuery.isFetching}
                    onRetry={() => void usersQuery.refetch()}
                    onChange={(ids) => updateForm('targetUserIds', ids)}
                  />
                ) : null}

                {form.targetType === 'roles' ? (
                  <div className="flex flex-wrap gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                    {ROLE_OPTIONS.map((option) => {
                      const selected = form.targetRoles.includes(option.value)
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => updateForm(
                            'targetRoles',
                            selected
                              ? form.targetRoles.filter((role) => role !== option.value)
                              : [...form.targetRoles, option.value],
                          )}
                          className={cn(
                            'inline-flex h-9 items-center gap-2 rounded-[6px] px-3 text-xs font-normal transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-[var(--app-surface-solid)] text-muted-foreground hover:text-[var(--app-text-primary)]',
                          )}
                        >
                          {selected ? <Check className="h-3.5 w-3.5" /> : null}
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-normal">Pronto para publicação</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Mantém o item preparado, mas o canal da Home continua desativado.
                    </p>
                  </div>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(checked) => updateForm('isActive', checked)}
                    aria-label="Marcar rascunho como pronto para publicação"
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-soft)]">
                <div
                  className="relative flex min-h-44 items-center justify-center bg-gradient-to-br p-4"
                  style={editingPublication?.imageUrl
                    ? {
                        backgroundImage: `linear-gradient(135deg, rgba(15,23,42,.08), rgba(15,23,42,.55)), url(${JSON.stringify(editingPublication.imageUrl)})`,
                        backgroundPosition: 'center',
                        backgroundSize: 'cover',
                      }
                    : undefined}
                >
                  {!editingPublication?.imageUrl ? (
                    <div className="text-center text-muted-foreground">
                      <ImageIcon className="mx-auto h-8 w-8" strokeWidth={1.5} />
                      <p className="mt-2 text-xs">Sem imagem</p>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2 border-t border-[var(--app-border)] p-3">
                  {editingPublication ? (
                    <>
                      <label className={cn(
                        'flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] text-xs font-normal transition-colors hover:bg-[var(--app-surface-hover)]',
                        isImageSaving && 'pointer-events-none opacity-50',
                      )}>
                        {uploadImage.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="h-3.5 w-3.5" />
                        )}
                        {editingPublication.imageUrl ? 'Trocar imagem' : 'Enviar imagem'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={handleImageUpload}
                          disabled={isImageSaving}
                        />
                      </label>
                      {editingPublication.imageUrl ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setImageDeleteOpen(true)}
                          disabled={isImageSaving}
                          className="w-full text-red-500 hover:bg-red-500/10 hover:text-red-500"
                        >
                          {deleteImage.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Remover imagem
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-center text-xs leading-5 text-muted-foreground">
                      Salve o rascunho primeiro para enviar uma imagem JPEG, PNG ou WebP de até 5 MB.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-xs leading-5 text-muted-foreground">
                <p className="font-normal text-[var(--app-text-primary)]">Dica de composição</p>
                <p className="mt-1">
                  Use títulos curtos, uma única ideia por bloco e imagens horizontais com o assunto principal mais à direita.
                </p>
              </div>
            </aside>
            </div>
          </fieldset>

          <DialogFooter className="sticky bottom-0 z-20 border-t border-[var(--app-border)] bg-[var(--app-surface-solid)] px-5 py-4">
            <Button
              variant="outline"
              className="border-0 bg-[var(--app-surface-soft)]"
              onClick={() => handleDialogOpenChange(false)}
              disabled={isSaving || isImageSaving}
            >
              Cancelar
            </Button>
            <Button
              className="bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
              onClick={handleSave}
              disabled={isSaving || isImageSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingPublication ? 'Salvar alterações' : 'Criar rascunho'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={imageDeleteOpen} onOpenChange={(open) => {
        if (!open && deleteImage.isPending) return
        setImageDeleteOpen(open)
      }}>
        <AlertDialogContent className="rounded-[8px] shadow-none" aria-busy={deleteImage.isPending}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover imagem?</AlertDialogTitle>
            <AlertDialogDescription>
              A imagem de “{editingPublication?.title}” será removida do rascunho e do armazenamento quando possível. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteImage.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleImageDelete()
              }}
              disabled={deleteImage.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteImage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Remover imagem
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(publicationToDelete)} onOpenChange={(open) => {
        if (!open && deletePublication.isPending) return
        if (!open) setPublicationToDelete(null)
      }}>
        <AlertDialogContent className="rounded-[8px] shadow-none" aria-busy={deletePublication.isPending}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              “{publicationToDelete?.title}” será removida dos rascunhos da Home. O canal
              está desativado, portanto este item não está visível aos usuários. A imagem
              vinculada também será removida quando possível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePublication.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              disabled={deletePublication.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePublication.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Excluir rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
