# ⚡ QUICK REFERENCE - Vimob CRM Architecture

## 🎯 Decisão Rápida: Onde colocar meu código?

```
Pergunta: Novo componente UI?
├─ Específico de um domínio (leads, properties, automation)?
│  └─ → components/features/{domain}/
├─ Usado por 2+ domínios?
│  └─ → components/shared/
└─ De design (botão, input, modal)?
   └─ → components/ui/ (Radix/shadcn)

Pergunta: Lógica com hooks/state?
├─ Específica de domínio?
│  └─ → hooks/{domain}/use-{feature}.ts
├─ Global (user, theme)?
│  └─ → stores/{feature}.store.ts (Zustand)
└─ Compartilhada?
   └─ → hooks/shared/use-{feature}.ts

Pergunta: Chamada de API/banco de dados?
├─ Supabase?
│  └─ → lib/api/{domain}.ts
├─ Externas (Google, WhatsApp)?
│  └─ → integrations/{service}/
└─ Validação de dados?
   └─ → lib/validation/schemas.ts (Zod)

Pergunta: Constante/config?
├─ Variáveis de env?
│  └─ → config/env.ts
├─ Rotas, features flags?
│  └─ → config/constants.ts
└─ Proteção de rota?
   └─ → middleware.ts
```

---

## 📁 Estrutura por Domínio (Template)

Adicionar novo domínio? Copy-paste e preencha:

```
components/features/{DOMAIN}/
├── {Feature}Screen.tsx        ← Componente principal
├── {Feature}List.tsx          ← Lista de items
├── {Feature}Form.tsx          ← Formulário
├── {Feature}Dialog.tsx        ← Modal
├── index.ts                   ← Barrel export
└── (opcional) sub-componentes/

hooks/{DOMAIN}/
├── use-{feature}.ts           ← Read data (useQuery)
├── use-{feature}-mutations.ts ← Write data (useMutation)
└── index.ts                   ← Barrel export

lib/api/{domain}.ts            ← API functions
lib/validation/{domain}.ts     ← Zod schemas (adicionar a schemas.ts)

app/(protected)/{domain}/
└── page.tsx                   ← Rota (import do componente principal)
```

---

## 🔗 Import Patterns

```tsx
// ✅ CORRETO
import { LeadCard } from '@/components/features/leads'
import { useLeads } from '@/hooks/leads'
import { leadsAPI } from '@/lib/api'
import { leadSchema } from '@/lib/validation'
import { ROUTES } from '@/config/constants'
import { useUIStore } from '@/stores'
import { useAuth } from '@/components/providers'

// ❌ ERRADO
import { LeadCard } from '../../../../components/features/leads'
import { LeadCard } from '../components/leads'
import LeadCard from '../../components/leads/LeadCard'
```

---

## 🔐 Segurança (Critical)

```tsx
// ❌ NÃO FAZER
'use client'
import { createClient } from '@supabase/supabase-js'

// ✅ FAZER (browser)
'use client'
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()

// ✅ FAZER (server)
'use server'
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// ✅ FAZER (validar)
import { leadSchema } from '@/lib/validation'
const validated = leadSchema.parse(userInput)
```

---

## 🧩 Código Boilerplate

### Novo Hook
```tsx
// hooks/{domain}/use-{feature}.ts
'use client'
import { useQuery } from '@tanstack/react-query'
import { leadsAPI } from '@/lib/api'

export function useLeads(orgId: string) {
  return useQuery({
    queryKey: ['leads', orgId],
    queryFn: () => leadsAPI.getLeads(orgId),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
  })
}
```

### Novo Componente
```tsx
// components/features/{domain}/{Feature}.tsx
'use client'

import { use{Feature} } from '@/hooks/{domain}'
import { Button } from '@/components/ui/button'

export function {Feature}Screen() {
  const { data, isLoading, error } = use{Feature}()

  if (error) return <div>Erro: {error.message}</div>
  if (isLoading) return <div>Carregando...</div>

  return (
    <div className="space-y-4">
      {/* content */}
    </div>
  )
}
```

### Nova API Function
```tsx
// lib/api/{domain}.ts
import { createClient } from '@/lib/supabase/client'
import { {feature}Schema } from '@/lib/validation'

const supabase = createClient()

export const {domain}API = {
  async get{Feature}s(orgId: string) {
    return supabase
      .from('{table}')
      .select('*')
      .eq('organization_id', orgId)
  },

  async create{Feature}(orgId: string, input: unknown) {
    const data = {feature}Schema.parse(input)
    return supabase
      .from('{table}')
      .insert([{ ...data, organization_id: orgId }])
      .select()
      .single()
  }
}
```

### Nova Validation Schema
```tsx
// lib/validation/schemas.ts (adicionar)
export const {feature}Schema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  // ...
})

export type {Feature} = z.infer<typeof {feature}Schema>
```

---

## 🚦 State Management Decision Tree

```
Preciso de estado?
├─ Local do componente?
│  └─ → useState() [SÓ AQUI]
├─ Múltiplos componentes?
│  ├─ Mesma árvore?
│  │  └─ → useContext (ou props)
│  └─ Diferentes árvores?
│     └─ → Zustand (stores/)
├─ Dados de servidor?
│  └─ → React Query (useQuery/useMutation)
└─ Autenticação?
   └─ → useAuth() + useAuthStore()
```

---

## 📊 Performance Checklist

```
✅ Antes de commitar:

[ ] Imports são absolutos (@/)?
[ ] Componentes estão no lugar certo?
[ ] Dados são validados com Zod?
[ ] State é gerenciado corretamente?
[ ] Sem props drilling profundo (max 3 níveis)?
[ ] Sem Supabase calls direto em componentes?
[ ] Sem hardcoded values?
[ ] Error handling implementado?
[ ] Loading states implementados?
[ ] TypeScript sem 'any'?
```

---

## 🐛 Debugging Tips

```bash
# Ver estrutura
ls -R components/features/

# Encontrar Supabase calls incorretos
grep -r "supabase.from" components/ hooks/

# Encontrar imports relativos
grep -r "from '\.\.\/" app/ components/

# Buscar hardcoded strings
grep -r "'/protected" app/ components/

# Ver todos os types
grep -r "z.infer" lib/validation/
```

---

## 📚 Files at a Glance

| File | Purpose | Edit? |
|------|---------|-------|
| `app/layout.tsx` | RootProvider setup | ✅ |
| `app/(protected)/` | Feature routes | ✅ |
| `components/features/` | Feature UI | ✅ |
| `components/shared/` | Reusable UI | ✅ |
| `components/ui/` | Radix/shadcn | ❌ |
| `lib/api/` | API functions | ✅ |
| `lib/validation/` | Zod schemas | ✅ |
| `hooks/` | Custom hooks | ✅ |
| `stores/` | Zustand stores | ✅ |
| `config/` | Constants | ✅ |
| `middleware.ts` | Route protection | ✅ |
| `.env` | Environment vars | ✅ |

---

## 🎯 Most Common Tasks

### Adicionar novo campo em formulário
1. Adicionar em schema Zod (`lib/validation/schemas.ts`)
2. Adicionar em componente form (`components/features/{domain}/`)
3. Adicionar em API function (`lib/api/{domain}.ts`)

### Adicionar nova rota
1. Criar componente em `components/features/{domain}/`
2. Criar arquivo em `app/(protected)/{domain}/page.tsx`
3. Importar componente
4. Adicionar ao `ROUTES` em `config/constants.ts`

### Adicionar integração externa
1. Criar folder em `integrations/{service}/`
2. Criar functions wrapper
3. Chamar via API route (`app/api/...`)
4. Integrar em hooks

---

## ⚠️ Red Flags (Nunca fazer)

```tsx
// 🚨 SUPABASE NO COMPONENTE
'use client'
const [data, setData] = useState([])
useEffect(() => {
  supabase.from('table').select('*').then(...)
}, [])

// 🚨 PROPS DRILLING
<Parent> → <Child> → <GrandChild> → <GreatGrandChild>
passando 10+ props

// 🚨 SEM VALIDAÇÃO
const user = await api.createUser(formData)

// 🚨 HARDCODED
const adminUsers = ['andre@company.com', 'joao@company.com']

// 🚨 ESTADO ALEATÓRIO
const [isDarkMode, setIsDarkMode] = useState(false)
// Deveria ser um Store Zustand

// 🚨 IMPORTS RELATIVOS
from '../../../components/features/leads'

// 🚨 ANY TYPE
function processData(data: any) {
  return data.map(...)
}
```

---

**Printable**: Yes | **Share with IAs**: Yes | **Update frequency**: After each phase
