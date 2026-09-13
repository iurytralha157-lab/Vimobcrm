# Exemplos de código atuais

Os exemplos mostram fronteiras, não uma API abstrata obrigatória. Antes de
copiar, confirme nomes e contratos no domínio existente.

## Schema Zod como fonte de tipo

```ts
// lib/validation/example.ts
import { z } from 'zod'

export const exampleCreateInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  enabled: z.boolean().default(true),
})

export type ExampleCreateInput = z.infer<typeof exampleCreateInputSchema>
```

Valide também respostas externas relevantes; tipar um `vimobAPIRequest<T>` não
valida o JSON recebido em runtime.

## Cliente da API Go

```ts
// lib/api/examples.ts
import { vimobAPIRequest } from '@/lib/api/vimob-client'
import {
  exampleCreateInputSchema,
  exampleResponseSchema,
  type ExampleCreateInput,
} from '@/lib/validation/example'

export const examplesAPI = {
  async create(organizationId: string, input: ExampleCreateInput) {
    const body = exampleCreateInputSchema.parse(input)
    const response = await vimobAPIRequest('/v1/examples', {
      method: 'POST',
      organizationId,
      body,
    })
    return exampleResponseSchema.parse(response).data
  },
}
```

O token e `X-Organization-ID` são responsabilidade do cliente HTTP canônico.
Não espalhe `fetch` autenticado nem acesso Supabase privilegiado em componentes.

## Hook com organização ativa

```ts
'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { examplesAPI } from '@/lib/api/examples'
import type { ExampleCreateInput } from '@/lib/validation/example'

export function useCreateExample() {
  const queryClient = useQueryClient()
  const activeOrganization = useActiveOrganization()

  return useMutation({
    mutationFn: async (input: ExampleCreateInput) => {
      if (activeOrganization.status !== 'ready') {
        throw new Error('Organização ativa indisponível.')
      }
      return examplesAPI.create(activeOrganization.organizationId, input)
    },
    onSuccess: async () => {
      if (activeOrganization.status === 'ready') {
        await queryClient.invalidateQueries({
          queryKey: ['examples', activeOrganization.organizationId],
        })
      }
    },
  })
}
```

## Tela de domínio

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { useExamples } from '@/hooks/examples/use-examples'

export function ExamplesScreen() {
  const query = useExamples()

  if (query.isPending) return <ExamplesSkeleton />
  if (query.isError) return <ExamplesError error={query.error} />
  if (query.data.length === 0) return <ExamplesEmptyState />

  return (
    <section>
      <ExamplesList items={query.data} />
      <Button type="button">Novo exemplo</Button>
    </section>
  )
}
```

Mantenha loading, erro, vazio e permissão explícitos. Componentes extraídos não
devem iniciar uma segunda query para os mesmos dados sem motivo.

## Handler Go multi-tenant

```go
func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.RequireOrganizationContext(w, r)
	if !ok {
		return
	}

	request, ok := httpserver.DecodeJSONValue[CreateRequest](
		w,
		r,
		httpserver.DefaultJSONBodyLimit,
	)
	if !ok {
		return
	}

	item, err := handler.repo.Create(r.Context(), tenantContext, request)
	if err != nil {
		writeExampleError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Example]{Data: item})
}
```

O decoder é estrito, limita o body, rejeita campos desconhecidos e rejeita um
segundo valor JSON. Preserve um limite menor/maior quando o endpoint já tem uma
necessidade documentada.

## JSON e valores Postgres

```go
normalizedID, ok := pgvalue.NormalizeUUID(input.ID)
title := pgvalue.TextPointer(rowTitle)             // preserva vazio
notes := pgvalue.TextPointerNonBlank(rowNotes)     // branco vira nil
label := pgvalue.TextPointerTrimmed(rowLabel)      // retorna trimado
```

Escolha a política pelo contrato existente. Não troque todas as variantes por
uma única sem comparar os callers.

## Server Component com Supabase

```tsx
import { createClient } from '@/lib/supabase/server'

export default async function AuthAwarePage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return <AccountIdentity user={data.user} />
}
```

Esse cliente usa a chave pública e cookies da request. Operações de domínio,
service role, Vault e provedores externos permanecem na API/infraestrutura.
