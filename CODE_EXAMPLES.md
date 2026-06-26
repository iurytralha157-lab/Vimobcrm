# 💻 EXEMPLOS DE CÓDIGO - Padrões Reais Vimob CRM

## 1️⃣ Exemplo Completo: Feature "Leads"

### lib/validation/schemas.ts (adicionar)
```tsx
export const leadSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  email: z.string().email('Email inválido'),
  phone: z.string().regex(/^\d{10,}$/, 'Telefone inválido'),
  status: z.enum(['new', 'contacted', 'qualified', 'lost', 'closed']),
  source: z.enum(['direct', 'website', 'referral', 'whatsapp', 'call']),
  organization_id: z.string().uuid(),
  assigned_to: z.string().uuid().optional(),
  notes: z.string().optional(),
  next_follow_up: z.string().datetime().optional(),
})

export type Lead = z.infer<typeof leadSchema>
export type LeadInput = z.infer<typeof leadSchema>
```

### lib/api/leads.ts
```tsx
import { createClient } from '@/lib/supabase/client'
import { leadSchema, type LeadInput } from '@/lib/validation'

const supabase = createClient()

export const leadsAPI = {
  // READ - Get all leads for organization
  async getLeads(orgId: string, options?: { status?: string; limit?: number }) {
    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (options?.status) {
      query = query.eq('status', options.status)
    }

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    const { data, count, error } = await query
    if (error) throw error

    return { leads: data || [], total: count || 0 }
  },

  // READ - Get single lead
  async getLead(leadId: string) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (error) throw error
    return data
  },

  // CREATE
  async createLead(orgId: string, input: unknown) {
    const validated = leadSchema.parse({
      ...input,
      organization_id: orgId,
    })

    const { data, error } = await supabase
      .from('leads')
      .insert([validated])
      .select()
      .single()

    if (error) throw error
    return data
  },

  // UPDATE
  async updateLead(leadId: string, input: Partial<LeadInput>) {
    const { data, error } = await supabase
      .from('leads')
      .update(input)
      .eq('id', leadId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // DELETE
  async deleteLead(leadId: string) {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId)

    if (error) throw error
  },

  // SEARCH
  async searchLeads(orgId: string, query: string) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('organization_id', orgId)
      .or(
        `name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`
      )

    if (error) throw error
    return data || []
  },
}
```

### hooks/leads/use-leads.ts
```tsx
'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { leadsAPI } from '@/lib/api'
import { useAuth } from '@/components/providers'

export function useLeads(options?: { status?: string; limit?: number }) {
  const { organization } = useAuth()

  return useQuery({
    queryKey: ['leads', organization?.id, options],
    queryFn: () => {
      if (!organization?.id) throw new Error('No organization selected')
      return leadsAPI.getLeads(organization.id, options)
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useLead(leadId: string) {
  return useQuery({
    queryKey: ['leads', leadId],
    queryFn: () => leadsAPI.getLead(leadId),
    enabled: !!leadId,
  })
}
```

### hooks/leads/use-lead-mutations.ts
```tsx
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsAPI } from '@/lib/api'
import { useAuth } from '@/components/providers'
import { toast } from 'sonner'

export function useCreateLead() {
  const queryClient = useQueryClient()
  const { organization } = useAuth()

  return useMutation({
    mutationFn: (input: any) => {
      if (!organization?.id) throw new Error('No organization')
      return leadsAPI.createLead(organization.id, input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Lead criado com sucesso')
    },
    onError: (error: any) => {
      toast.error(`Erro: ${error.message}`)
    },
  })
}

export function useUpdateLead(leadId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: any) => leadsAPI.updateLead(leadId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['leads', leadId] })
      toast.success('Lead atualizado')
    },
  })
}

export function useDeleteLead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (leadId: string) => leadsAPI.deleteLead(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Lead removido')
    },
  })
}
```

### components/features/leads/LeadsScreen.tsx
```tsx
'use client'

import { useState } from 'react'
import { useLeads } from '@/hooks/leads'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'
import { LeadsList } from './LeadsList'
import { CreateLeadDialog } from './CreateLeadDialog'

export function LeadsScreen() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const { leads, total, isLoading, error } = useLeads({ status: statusFilter })

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-800 rounded">
        Erro ao carregar leads: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Leads</h1>
          <p className="text-gray-600">Total: {total}</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>+ Novo Lead</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {(['new', 'contacted', 'qualified', 'lost'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? undefined : status)}
            className={`px-3 py-1 rounded ${
              statusFilter === status
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-800'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : leads.length === 0 ? (
        <div className="text-center py-8">Nenhum lead encontrado</div>
      ) : (
        <LeadsList leads={leads} />
      )}

      {/* Dialog */}
      <CreateLeadDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  )
}

export default LeadsScreen
```

### components/features/leads/LeadsList.tsx
```tsx
'use client'

import { Lead } from '@/lib/validation'
import { LeadCard } from './LeadCard'

interface LeadsListProps {
  leads: Lead[]
}

export function LeadsList({ leads }: LeadsListProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {leads.map((lead) => (
        <LeadCard key={lead.id} lead={lead} />
      ))}
    </div>
  )
}
```

### components/features/leads/LeadCard.tsx
```tsx
'use client'

import { Lead } from '@/lib/validation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

interface LeadCardProps {
  lead: Lead
}

export function LeadCard({ lead }: LeadCardProps) {
  const statusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    contacted: 'bg-yellow-100 text-yellow-800',
    qualified: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
    closed: 'bg-gray-100 text-gray-800',
  }

  return (
    <Link href={`/protected/leads/${lead.id}`}>
      <Card className="hover:shadow-lg transition-shadow cursor-pointer">
        <CardHeader>
          <div className="flex justify-between items-start">
            <CardTitle className="text-lg">{lead.name}</CardTitle>
            <Badge className={statusColors[lead.status] || ''}>
              {lead.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-gray-600">{lead.email}</p>
          <p className="text-sm text-gray-600">{lead.phone}</p>
          <p className="text-sm text-gray-600">Fonte: {lead.source}</p>
          {lead.notes && (
            <p className="text-sm text-gray-700 line-clamp-2">{lead.notes}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
```

### components/features/leads/CreateLeadDialog.tsx
```tsx
'use client'

import { useState } from 'react'
import { useCreateLead } from '@/hooks/leads'
import { leadSchema, type LeadInput } from '@/lib/validation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface CreateLeadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateLeadDialog({ open, onOpenChange }: CreateLeadDialogProps) {
  const [formData, setFormData] = useState<Partial<LeadInput>>({
    status: 'new',
    source: 'direct',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const createLead = useCreateLead()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Validação com Zod
      const validated = leadSchema.parse(formData)
      await createLead.mutateAsync(validated)

      // Reset
      setFormData({ status: 'new', source: 'direct' })
      setErrors({})
      onOpenChange(false)
    } catch (err: any) {
      if (err.issues) {
        // Zod errors
        const newErrors: Record<string, string> = {}
        err.issues.forEach((issue: any) => {
          newErrors[issue.path.join('.')] = issue.message
        })
        setErrors(newErrors)
      } else {
        setErrors({ submit: err.message })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Lead</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Nome *</label>
            <Input
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="João Silva"
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-red-500 text-sm">{errors.name}</p>}
          </div>

          <div>
            <label className="text-sm font-medium">Email *</label>
            <Input
              type="email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="joao@example.com"
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && <p className="text-red-500 text-sm">{errors.email}</p>}
          </div>

          <div>
            <label className="text-sm font-medium">Telefone *</label>
            <Input
              value={formData.phone || ''}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="11999999999"
              className={errors.phone ? 'border-red-500' : ''}
            />
            {errors.phone && <p className="text-red-500 text-sm">{errors.phone}</p>}
          </div>

          <div>
            <label className="text-sm font-medium">Status</label>
            <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Novo</SelectItem>
                <SelectItem value="contacted">Contatado</SelectItem>
                <SelectItem value="qualified">Qualificado</SelectItem>
                <SelectItem value="lost">Perdido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Fonte</label>
            <Select value={formData.source} onValueChange={(value) => setFormData({ ...formData, source: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direto</SelectItem>
                <SelectItem value="website">Website</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="referral">Referência</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Notas</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Anotações..."
              className="w-full p-2 border rounded"
              rows={3}
            />
          </div>

          {errors.submit && <p className="text-red-500">{errors.submit}</p>}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createLead.isPending}>
              {createLead.isPending ? 'Criando...' : 'Criar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

### components/features/leads/index.ts (barrel export)
```tsx
export { LeadsScreen as default } from './LeadsScreen'
export { LeadsList } from './LeadsList'
export { LeadCard } from './LeadCard'
export { CreateLeadDialog } from './CreateLeadDialog'
```

### app/(protected)/leads/page.tsx
```tsx
import LeadsScreen from '@/components/features/leads'

export const metadata = {
  title: 'Leads - Vimob CRM',
  description: 'Gerenciamento de leads',
}

export default function LeadsPage() {
  return <LeadsScreen />
}
```

---

## 2️⃣ Exemplo: Usando Zustand Store

### stores/filter.store.ts (NOVO - exemplo)
```tsx
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FilterStore {
  // State
  selectedStatus: string | null
  selectedSource: string | null
  sortBy: 'name' | 'date' | 'status'

  // Actions
  setSelectedStatus: (status: string | null) => void
  setSelectedSource: (source: string | null) => void
  setSortBy: (sortBy: 'name' | 'date' | 'status') => void
  reset: () => void
}

export const useFilterStore = create<FilterStore>()(
  persist(
    (set) => ({
      selectedStatus: null,
      selectedSource: null,
      sortBy: 'date',

      setSelectedStatus: (selectedStatus) => set({ selectedStatus }),
      setSelectedSource: (selectedSource) => set({ selectedSource }),
      setSortBy: (sortBy) => set({ sortBy }),
      reset: () => set({
        selectedStatus: null,
        selectedSource: null,
        sortBy: 'date',
      }),
    }),
    {
      name: 'leads-filter-store',
    }
  )
)
```

Uso em componentes:
```tsx
export function LeadsScreen() {
  const { selectedStatus, setSelectedStatus } = useFilterStore()
  const { leads } = useLeads({ status: selectedStatus })

  return (
    <div>
      <button onClick={() => setSelectedStatus('new')}>Filtrar: Novo</button>
      <LeadsList leads={leads} />
    </div>
  )
}
```

---

## 3️⃣ Exemplo: Error Handling

### app/(protected)/error.tsx
```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Algo deu errado</h1>
        <p className="text-gray-600">{error.message}</p>
        <Button onClick={() => reset()}>Tentar novamente</Button>
      </div>
    </div>
  )
}
```

---

## 4️⃣ Exemplo: Server Action (para operações sensíveis)

### app/actions.ts
```tsx
'use server'

import { createClient } from '@/lib/supabase/server'
import { leadSchema } from '@/lib/validation'

export async function createLeadAction(formData: FormData) {
  const supabase = await createClient()

  // Validate input
  const input = {
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    organization_id: formData.get('organizationId'),
  }

  const validated = leadSchema.parse(input)

  // Server-side insert (more secure)
  const { data, error } = await supabase
    .from('leads')
    .insert([validated])
    .select()
    .single()

  if (error) throw error
  return data
}
```

Uso:
```tsx
'use client'

export function Form() {
  async function handleSubmit(formData: FormData) {
    try {
      const result = await createLeadAction(formData)
      // success
    } catch (error) {
      // error handling
    }
  }

  return <form action={handleSubmit}>{/* form */}</form>
}
```

---

**Estes são exemplos reais que seguem EXATAMENTE os padrões do projeto.**

Usar como template para novos domínios!
